import JSZip from 'jszip';
import { logger } from './logger';
import { loadAudioClip, loadAllAudioClipKeys, loadLogEvents, loadAllSessions } from './db';
import { getCurrentEmail } from './googleAuth';
import { buildSessionsSnapshot } from './sessionSnapshot';

/** Export logs + audio clips as a ZIP.
 *  - `sessionIds` undefined → include ALL events and clips (used by manual LOG button)
 *  - `sessionIds` provided → restrict to those sessions only (used by auto upload after sync)
 *  - Empty array → still produces a device-only ZIP, no events/clips
 *
 *  v5.2 Codex 4차 MEDIUM: events는 IDB(영속)에서 우선 조회 — reload 후에도 보존됨.
 *  v0.10.1: userEmail은 토큰의 검증된 값 (`getCurrentEmail`) 사용 — settingsStore stale 방지.
 */
export async function exportLogZip(sessionIds?: string[]): Promise<Blob> {
  const zip = new JSZip();
  const deviceInfo = await logger.deviceAsync();
  const userEmail = getCurrentEmail();
  const deviceWithUser = { ...deviceInfo, userEmail: userEmail ?? null };
  zip.file('device.json', JSON.stringify(deviceWithUser, null, 2));

  const filterSet = sessionIds ? new Set(sessionIds) : null;

  let events: unknown[];
  try {
    // v0.5.0 W7(T-19): 세션 필터 ZIP에도 앱 수명주기 이벤트('__app__' sentinel — app_boot,
    // hydration, recover, drive_upload, setting_changed)를 항상 동봉해 계측 공백을 없앤다.
    events = await loadLogEvents(sessionIds ? [...sessionIds, '__app__'] : undefined);
  } catch {
    events = logger.getAll().filter((e) => {
      if (!filterSet) return true;
      return e.sessionId != null && (filterSet.has(e.sessionId) || e.sessionId === '__app__');
    });
  }
  zip.file('events.json', JSON.stringify(events, null, 2));

  // v0.5.0 W8: 복구용 세션 스냅샷 — export 범위 세션의 전체 Session 객체를 sessions.json으로 동봉.
  // "세션 복구" 2단계가 Drive의 이 zip만으로 세션+클립을 복원한다(별도 백업 업로드 없음 —
  // 클립은 아래 clips/를 그대로 공유, 중복 없음). 실패해도 zip 자체는 유효(구버전 zip과 동일 취급)
  // 하지만 [REVIEW-1] "빈 catch 금지" — 실패는 반드시 로깅한다.
  try {
    const allSessions = await loadAllSessions();
    const scoped = filterSet ? allSessions.filter((s) => filterSet.has(s.id)) : allSessions;
    zip.file('sessions.json', buildSessionsSnapshot(scoped, deviceWithUser.appVersion));
  } catch (e) {
    logger.log({ type: 'app', extra: `export_sessions_json_failed:${String((e as Error)?.message ?? e)}` });
  }

  // Include audio clips
  try {
    const keys = await loadAllAudioClipKeys();
    for (const key of keys) {
      if (filterSet) {
        const sid = key.split(':')[0];
        if (!filterSet.has(sid)) continue;
      }
      const blob = await loadAudioClip(key);
      if (blob) {
        const ext = blob.type.includes('wav') ? 'wav' : blob.type.includes('mp4') ? 'mp4' : 'webm';
        zip.file(`clips/${key}.${ext}`, blob);
      }
    }
  } catch { /* IDB unavailable */ }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
