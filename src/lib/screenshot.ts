/** v0.33.0 항목10-B(Vance) — 입력화면 자동 캡처(+ 범용 캡처 유틸, 항목11 개선요청 탭 재사용 예정).
 *
 *  설계:
 *   - 캡처 엔진: html2canvas **dynamic import**(첫 트리거 때만 로드 — 부팅 비용 0).
 *     `foreignObjectRendering: false` 고정 — iOS Safari에서 foreignObject 계열은 taint/렌더 불안정
 *     이력이 있어 캔버스 재구성 엔진만 쓴다. JPEG 저화질(quality 0.45, scale 1) — 판독 가능하되
 *     로그 zip 용량을 지배하지 않게.
 *   - 트리거 배선: **logger tap 단일 지점**(logger.subscribe). "음성입력에 대한 앱 반응으로 화면
 *     출력이 변경되는" 순간(민구 확정: 커밋 echo·이상치 알람·재질문·행 이동·micLost·pause/resume·
 *     세션 시작/종료)은 전부 이미 로깅되는 이벤트라, useVoiceSession 내부 N곳을 손대지 않고 이벤트
 *     →트리거 매핑(captureTriggerFor)으로 파생한다. 매핑은 순수 함수 — Node/Playwright 검증 가능.
 *   - 가드(민구 확정): 2초 스로틀 + 세션당 상한 100장. 캡처는 requestIdleCallback 스케줄(렌더
 *     완료 후·유휴 시), 실패는 항상 non-fatal(capture_failed 로깅만 — 앱 흐름 영향 0).
 *   - 저장: IDB 'screenshots' 스토어, 키 `${sessionId}:${ts}:${trigger}` — 세션 삭제 cascade·
 *     로그 zip screens/ 동봉은 각각 db.ts/exportLog.ts가 담당.
 */
import { logger, type LogEntry } from './logger';
import { saveScreenshot } from './db';
import { useSettingsStore } from '../stores/settingsStore';
import { T } from '../tokens';

export const CAPTURE_THROTTLE_MS = 2000;
export const CAPTURE_SESSION_CAP = 100;
export const CAPTURE_JPEG_QUALITY = 0.45;

export type CaptureTrigger =
  | 'commit'        // 값 커밋 echo (type:'value')
  | 'anomaly'       // 이상치 알람 (trend_alert_fired)
  | 'reask'         // 재질문 (파싱 실패/저신뢰/동음이의 거부)
  | 'rowmove'       // 행 이동 (jumpToRow — 음성/터치 공통)
  | 'miclost'       // 마이크 소실 배너
  | 'pause'
  | 'resume'
  | 'session_start'
  | 'session_stop';

/** 로그 이벤트 → 캡처 트리거 매핑(순수). 해당 없으면 null. */
export function captureTriggerFor(
  e: Pick<LogEntry, 'type' | 'extra' | 'parsed'>,
): CaptureTrigger | null {
  switch (e.type) {
    case 'value':
      return 'commit';
    case 'trend':
      return e.extra?.startsWith('trend_alert_fired') ? 'anomaly' : null;
    case 'stt_parse_failed':
    case 'stt_rejected_low_confidence':
    case 'stt_rejected_ambiguous_syllable':
      return 'reask';
    case 'command':
      if (e.parsed === 'jump') return 'rowmove';
      if (e.parsed === 'pause') return 'pause';
      if (e.parsed === 'resume') return 'resume';
      return null;
    case 'clip':
      return e.extra?.startsWith('mic_lost') ? 'miclost' : null;
    case 'session':
      if (e.extra === 'start') return 'session_start';
      if (e.extra === 'stop') return 'session_stop';
      return null;
    default:
      return null;
  }
}

// ── 범용 캡처(항목11 개선요청 탭에서 재사용) ────────────────────────────────
let html2canvasPromise: Promise<typeof import('html2canvas')['default']> | null = null;
function loadHtml2canvas() {
  html2canvasPromise ??= import('html2canvas').then((m) => m.default);
  return html2canvasPromise;
}

/** 현재 화면을 JPEG Blob으로 캡처. 실패 시 null(throw 안 함 — 호출자 로깅 책임). */
export async function captureScreenshot(quality: number = CAPTURE_JPEG_QUALITY): Promise<Blob | null> {
  try {
    const html2canvas = await loadHtml2canvas();
    const canvas = await html2canvas(document.body, {
      scale: 1,
      logging: false,
      backgroundColor: T.bg,
      // iOS Safari 안정 방식 — foreignObject 렌더링 배제(캔버스 재구성 엔진 고정).
      foreignObjectRendering: false,
      removeContainer: true,
    });
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
  } catch {
    return null;
  }
}

// ── 자동 캡처 컨트롤러(가드 로직 — 의존성 주입으로 순수 테스트 가능) ─────────────
export interface AutoCaptureDeps {
  isEnabled: () => boolean;
  capture: () => Promise<Blob | null>;
  save: (key: string, blob: Blob) => Promise<void>;
  now: () => number;
  /** 캡처 실행 스케줄러(실배선: requestIdleCallback). 테스트에선 동기 실행 주입. */
  schedule: (fn: () => void) => void;
  log: (entry: Omit<LogEntry, 'ts'>) => void;
}

export function createAutoCapture(deps: AutoCaptureDeps) {
  let lastCaptureAt = -Infinity;
  const perSession = new Map<string, number>();
  const capReachedLogged = new Set<string>();
  let inFlight = false;

  return {
    /** logger tap에서 이벤트마다 호출. 가드를 전부 통과한 경우에만 캡처를 스케줄한다. */
    onLogEntry(entry: LogEntry): void {
      const trigger = captureTriggerFor(entry);
      if (!trigger) return;
      const sessionId = entry.sessionId;
      if (!sessionId || sessionId === '__app__') return; // 세션 문맥 없는 이벤트는 캡처 없음
      if (!deps.isEnabled()) return;
      if (inFlight) return;
      const now = deps.now();
      if (now - lastCaptureAt < CAPTURE_THROTTLE_MS) return; // 2초 스로틀(조용히 스킵 — 링버퍼 보호)
      const count = perSession.get(sessionId) ?? 0;
      if (count >= CAPTURE_SESSION_CAP) {
        if (!capReachedLogged.has(sessionId)) {
          capReachedLogged.add(sessionId);
          deps.log({ type: 'app', extra: `capture_cap_reached:${CAPTURE_SESSION_CAP}`, sessionId });
        }
        return;
      }
      // 가드 통과 — 스로틀 창·카운트를 즉시 선점(스케줄 지연 중 후속 트리거 폭주 방지).
      lastCaptureAt = now;
      perSession.set(sessionId, count + 1);
      inFlight = true;
      deps.schedule(() => {
        void (async () => {
          const t0 = deps.now();
          try {
            const blob = await deps.capture();
            if (!blob) {
              deps.log({ type: 'app', extra: `capture_failed:${trigger}:null_blob`, sessionId });
              return;
            }
            const key = `${sessionId}:${deps.now()}:${trigger}`;
            await deps.save(key, blob);
            deps.log({
              type: 'app',
              extra: `capture_saved:${trigger}:${blob.size}`,
              durationMs: deps.now() - t0, // 캡처+저장 소요 ms — 실기기 성능 판정용
              sessionId,
              clipKey: key,
            });
          } catch (e) {
            deps.log({
              type: 'app',
              extra: `capture_failed:${trigger}:${String((e as Error)?.message ?? e)}`,
              sessionId,
            });
          } finally {
            inFlight = false;
          }
        })();
      });
    },
    /** 테스트 관측용 — 세션별 캡처 시도 수. */
    countFor(sessionId: string): number {
      return perSession.get(sessionId) ?? 0;
    },
  };
}

// ── 실배선(앱 부팅 시 1회) ──────────────────────────────────────────────
function idleSchedule(fn: () => void): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => fn(), { timeout: 1500 });
  } else {
    setTimeout(fn, 250); // iOS Safari 폴백 — 렌더 커밋 이후 실행이면 충분
  }
}

let initialized = false;

/** App 부팅 시 1회 호출 — logger tap에 자동 캡처를 배선한다(idempotent). */
export function initAutoCapture(): void {
  if (initialized) return;
  initialized = true;
  const controller = createAutoCapture({
    isEnabled: () => useSettingsStore.getState().autoScreenCapture,
    capture: captureScreenshot,
    save: saveScreenshot,
    now: () => Date.now(),
    schedule: idleSchedule,
    log: (e) => logger.log(e),
  });
  logger.subscribe((entry) => controller.onLogEntry(entry));
}
