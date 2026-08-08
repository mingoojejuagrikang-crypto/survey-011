/**
 * v0.33.0 항목11 — 개선요청(feedback) 파이프라인.
 *
 * 흐름(민구 확정: 화면 전환 없는 팝업 방식):
 *   탭바 '개선요청' 탭 → App.tsx가 setTab 없이 인터셉트 → captureScreenshot(항목10 유틸 재사용)
 *   → FeedbackModal(썸네일 + 자유텍스트) → submitFeedback():
 *     ① buildFeedbackZip — feedback.json(텍스트·컨텍스트 메타) + screenshot.jpg +
 *        **경량 로그(events.json + sessions.json — 클립·스크린샷 제외, 민구 확정)**.
 *     ② 온라인+로그인 → uploadFeedbackToBothDrives(사용자 survey-011/feedback/ + 관리자
 *        FEEDBACK_FOLDER_ID/<email>/). 관리자 레그 실패는 non-fatal — 사용자 레그 성공이면
 *        성공 처리하고 관리자 레그만 재시도 큐에 남긴다.
 *     ③ 오프라인/미로그인/사용자 레그 실패 → IDB feedbackQueue(DB v6)에 zip 통째 보관 →
 *        온라인·로그인 복귀/부팅 시 flushFeedbackQueue가 자동 재전송.
 *
 * 텔레메트리(기존 type:'app'+extra 컨벤션, 신규 LogEntry type 없음):
 *   feedback_open / feedback_submit:len=..,shot=.. / feedback_queued:<reason> /
 *   feedback_uploaded:user=..,admin=.. / feedback_failed:<err> / feedback_flush:...
 */
import JSZip from 'jszip';
import { logger } from './logger';
import { feedbackUploadMic, withErr } from './logEvents';
import {
  enqueueFeedback,
  loadFeedbackQueue,
  updateFeedbackQueueItem,
  deleteFeedbackQueueItem,
  loadLogEvents,
  loadAllSessions,
  type FeedbackQueueItem,
} from './db';
import { getAccessToken, getCurrentEmail, onTokenSettled } from './googleAuth';
import {
  uploadFeedbackToUserDrive,
  uploadFeedbackToAdminFolder,
  uploadFeedbackToBothDrives,
  FEEDBACK_FOLDER_ID,
} from './driveUpload';
import { buildSessionsSnapshot } from './sessionSnapshot';
import { captureScreenshot } from './screenshot';

/** 캡처 상한 — html2canvas가 느린 기기/거대 DOM에서 hang하면 모달이 영영 안 뜨므로 캡처를
 *  포기(null)하고 텍스트만으로 진행한다(캡처는 언제나 best-effort). */
export const CAPTURE_TIMEOUT_MS = 4_000;

/** 개선요청 zip 파일명: feedback_<date>_<ts>.zip (수확 컨벤션과 동형). */
export function feedbackFilename(now: number = Date.now()): string {
  const date = new Date(now).toISOString().slice(0, 10);
  return `feedback_${date}_${now}.zip`;
}

/** 🔴 v0.47.0 W5ⓐ′(민구 FB-F · 08-08) — **개선요청이 어느 빌드에서 왔는지를 zip이 스스로 말한다.**
 *
 *  08-08 새벽 제보 7건 전수 triage에서 *"어느 빌드였나"* 가 끝까지 UNCLEAR로 남았다. 그게
 *  치명적인 이유: 같은 증상이 **처방 전 번들**에서 온 것이면 재현이고, **처방 후 번들**에서
 *  온 것이면 처방이 틀린 것이다 — 두 결론의 다음 행동이 정반대인데 가를 근거가 없었다.
 *
 *  `device.appVersion`(logger)은 `package.json` 버전 + `-preview` 접미까지만 말한다. 같은
 *  버전에서 여러 번 빌드해 배포하는 프리뷰 흐름([[survey011-preview-first-flow]])에서는
 *  **그 문자열이 완전히 같다**(`vite.config.ts:16` 주석이 같은 사건을 기록해 뒀다).
 *  실제로 빌드를 가르는 유일한 것은 **번들 자산 해시**다.
 *
 *  취득: 로드된 `<script src>` 중 vite가 낸 `assets/index-<hash>.js`를 읽는다. 해시는 내용
 *  기반이라 같은 소스면 같은 값이고, 한 글자만 달라도 갈린다.
 *  🟡 dev(`vite`)에는 그 자산이 없다 — `'dev'`를 낸다. 실패는 삼키고 `'unknown'`을 낸다:
 *  캡처와 마찬가지로 **best-effort**이고, 이것 때문에 개선요청 자체가 실패하면 본말전도다. */
export function readBundleId(): string {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
    for (const s of scripts) {
      const m = /\/assets\/(index-[A-Za-z0-9_.-]+\.js)/.exec(s.getAttribute('src') ?? '');
      if (m) return m[1];
    }
    return 'dev';
  } catch {
    return 'unknown';
  }
}

/** 화면 캡처(타임아웃 가드). 실패/초과 시 null — throw 안 함. */
export async function captureForFeedback(): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    const t = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
    captureScreenshot()
      .then((b) => { clearTimeout(t); resolve(b); })
      .catch(() => { clearTimeout(t); resolve(null); });
  });
}

export interface FeedbackContext {
  /** 인터셉트 당시 활성 탭(사용자가 무엇을 보다 요청했는지). */
  tab: string;
  /** 음성 세션 phase(ready/active/paused/...) — 세션 중 요청인지 판별. */
  sessionPhase: string;
}

/**
 * 개선요청 zip 빌드(경량 — 민구 확정: 클립·스크린샷 폴더 제외).
 *  - feedback.json: 텍스트 + 컨텍스트 메타(탭/phase/디바이스/이메일/시각).
 *  - screenshot.jpg: 캡처 성공 시에만.
 *  - events.json / sessions.json: exportLog.ts와 동일 소스(IDB 전체) — 전후 맥락 분석용.
 *    clips/·screens/는 담지 않는다(용량 지배 방지 — 상세 로그는 기존 growth-log zip 경로가 담당).
 */
export async function buildFeedbackZip(input: {
  text: string;
  screenshot: Blob | null;
  context: FeedbackContext;
}): Promise<Blob> {
  const zip = new JSZip();
  const device = await logger.deviceAsync();
  zip.file(
    'feedback.json',
    JSON.stringify(
      {
        schema: 1,
        createdAt: Date.now(),
        text: input.text,
        context: input.context,
        hasScreenshot: !!input.screenshot,
        userEmail: getCurrentEmail(),
        device,
        // v0.47.0 W5ⓐ′ — 로드된 번들 자산 해시(`readBundleId` 주석이 근거). `device.appVersion`은
        //   같은 버전의 여러 빌드를 구분하지 못한다 — 프리뷰 우선 배포 흐름에서 그게 공백이었다.
        bundle: readBundleId(),
      },
      null,
      2,
    ),
  );
  if (input.screenshot) zip.file('screenshot.jpg', input.screenshot);

  // 경량 로그 — 실패해도 zip 자체는 유효([REVIEW-1] 빈 catch 금지, 실패는 로깅).
  try {
    const events = await loadLogEvents();
    zip.file('events.json', JSON.stringify(events, null, 2));
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('feedback_events_failed', e) });
  }
  try {
    const sessions = await loadAllSessions();
    zip.file('sessions.json', buildSessionsSnapshot(sessions, device.appVersion));
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('feedback_sessions_failed', e) });
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export type FeedbackSubmitStatus = 'uploaded' | 'queued';
type FeedbackMicTrackState = 'none' | 'ended' | 'muted' | 'live' | 'unknown';

function readFeedbackMicTrack(getTrackState?: () => FeedbackMicTrackState): FeedbackMicTrackState {
  try {
    return getTrackState?.() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function enqueueZip(
  zipBlob: Blob,
  filename: string,
  legs: { pendingUser: boolean; pendingAdmin: boolean },
  reason: string,
): Promise<void> {
  const zipBuf = await zipBlob.arrayBuffer();
  await enqueueFeedback({
    createdAt: Date.now(),
    filename,
    zipBuf,
    pendingUser: legs.pendingUser,
    pendingAdmin: legs.pendingAdmin,
    attempts: 0,
  });
  logger.log({ type: 'app', extra: `feedback_queued:${reason}` });
}

/**
 * 제출 진입점(FeedbackModal '보내기'). 항상 resolve — 실패도 큐로 수렴시켜 사용자에겐
 * '보냈음(대기 포함)'으로 끝난다. 반환값은 모달 문구 분기용.
 */
export async function submitFeedback(input: {
  text: string;
  screenshot: Blob | null;
  context: FeedbackContext;
  getTrackState?: () => FeedbackMicTrackState;
}): Promise<FeedbackSubmitStatus> {
  logger.log({
    type: 'app',
    extra: `feedback_submit:len=${input.text.length},shot=${input.screenshot ? 1 : 0}`,
  });
  const filename = feedbackFilename();
  const zipBlob = await buildFeedbackZip(input);
  const bytes = zipBlob.size;
  const uploadStartedAt = Date.now();
  const emitUploadMic = (phase: 'start' | 'uploaded' | 'queued' | 'failed') => {
    try {
      logger.log({
        type: 'app',
        extra: feedbackUploadMic({
          phase,
          track: readFeedbackMicTrack(input.getTrackState),
          bytes,
          elapsedMs: phase === 'start' ? 0 : Math.max(0, Date.now() - uploadStartedAt),
        }),
      });
    } catch {
      /* best-effort 계측 — 제출 경로의 기존 성공/실패 의미를 바꾸지 않는다 */
    }
  };
  emitUploadMic('start');

  try {
    // 오프라인/미로그인 — 업로드 시도 없이 곧장 큐(온라인·토큰 복귀 훅이 flush).
    if (!navigator.onLine) {
      await enqueueZip(zipBlob, filename, { pendingUser: true, pendingAdmin: !!FEEDBACK_FOLDER_ID }, 'offline');
      emitUploadMic('queued');
      return 'queued';
    }
    if (!getAccessToken()) {
      await enqueueZip(zipBlob, filename, { pendingUser: true, pendingAdmin: !!FEEDBACK_FOLDER_ID }, 'not_signed_in');
      emitUploadMic('queued');
      return 'queued';
    }

    const r = await uploadFeedbackToBothDrives(zipBlob, filename);
    const userOk = !!r.userDriveId;
    const adminOk = !!r.adminDriveId;
    logger.log({
      type: 'app',
      extra:
        `feedback_uploaded:user=${userOk ? 'ok' : 'fail'},` +
        `admin=${!r.adminConfigured ? 'skip' : adminOk ? 'ok' : 'fail'}` +
        (r.errors.length ? `:${r.errors.join('|').slice(0, 160)}` : ''),
    });

    if (userOk && (!r.adminConfigured || adminOk)) {
      emitUploadMic('uploaded');
      return 'uploaded';
    }

    // 부분/전체 실패 → 남은 레그만 큐에. 사용자 레그 성공이면 성공 처리(관리자 레그는 non-fatal 재시도).
    await enqueueZip(
      zipBlob,
      filename,
      { pendingUser: !userOk, pendingAdmin: r.adminConfigured && !adminOk },
      userOk ? 'admin_retry' : 'upload_failed',
    );
    const status = userOk ? 'uploaded' : 'queued';
    emitUploadMic(status);
    return status;
  } catch (error) {
    emitUploadMic('failed');
    throw error;
  }
}

// ─── 큐 재전송 (온라인/로그인 복귀 + 부팅) ─────────────────────────────────

let flushInFlight = false;

/** 큐를 1패스 재전송. 레그별 성공은 즉시 반영(부분 성공 보존), 두 레그 완료 시 삭제.
 *  반복 호출에 안전(in-flight 가드) — 실패 항목은 다음 트리거(온라인/토큰/부팅)까지 대기. */
export async function flushFeedbackQueue(): Promise<void> {
  if (flushInFlight) return;
  if (!navigator.onLine || !getAccessToken()) return;
  flushInFlight = true;
  try {
    const items = await loadFeedbackQueue();
    if (items.length === 0) return;
    for (const item of items) {
      const updated: FeedbackQueueItem = { ...item, attempts: item.attempts + 1 };
      const zipBlob = new Blob([item.zipBuf], { type: 'application/zip' });
      if (updated.pendingUser) {
        try {
          await uploadFeedbackToUserDrive(zipBlob, item.filename);
          updated.pendingUser = false;
        } catch (e) {
          updated.lastError = `user_drive: ${String((e as Error)?.message ?? e)}`.slice(0, 200);
        }
      }
      if (updated.pendingAdmin) {
        if (!FEEDBACK_FOLDER_ID) {
          updated.pendingAdmin = false; // env가 사라졌으면 레그 자체가 무의미 — 정리
        } else {
          try {
            await uploadFeedbackToAdminFolder(zipBlob, item.filename);
            updated.pendingAdmin = false;
          } catch (e) {
            updated.lastError = `admin_drive: ${String((e as Error)?.message ?? e)}`.slice(0, 200);
          }
        }
      }
      if (!updated.pendingUser && !updated.pendingAdmin) {
        if (item.id != null) await deleteFeedbackQueueItem(item.id);
        logger.log({ type: 'app', extra: `feedback_flush:uploaded:${item.filename}` });
      } else {
        await updateFeedbackQueueItem(updated);
        logger.log({
          type: 'app',
          extra: `feedback_flush:retry_later:${item.filename}:attempts=${updated.attempts}`,
        });
      }
    }
  } catch (e) {
    logger.log({ type: 'app', extra: withErr('feedback_failed:flush', e) });
  } finally {
    flushInFlight = false;
  }
}

let flushWired = false;

/** App 부팅 시 1회 — 큐 자동 재전송 배선(idempotent): 즉시 1회 + online 복귀 + 토큰 settle. */
export function initFeedbackQueueFlush(): void {
  if (flushWired) return;
  flushWired = true;
  void flushFeedbackQueue();
  window.addEventListener('online', () => void flushFeedbackQueue());
  onTokenSettled(() => void flushFeedbackQueue());
}
