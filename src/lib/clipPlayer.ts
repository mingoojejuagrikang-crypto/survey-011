import { loadAudioClip } from './db';
import { logger } from './logger';

/**
 * 모듈 레벨 단일 오디오 재생 매니저 (v0.11.2).
 * 데이터탭의 여러 음성 클립을 동시에 누르면 동시 재생되던 문제를 해결 —
 * 한 번에 하나만 재생하고 나머지는 큐에 대기, 끝나면 순서대로 재생한다.
 * - 재생 중인 클립을 다시 탭 → 정지 + 대기 큐 전체 취소 (사용자 "그만" 의도)
 * - 대기 중인 클립을 탭 → 해당 클립만 큐에서 취소
 */
export type ClipPlayState = 'idle' | 'playing' | 'queued';
export const clipPlayer = (() => {
  let current: string | null = null;
  let queue: string[] = [];
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const cleanup = () => {
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  };

  const stop = () => {
    cleanup();
    current = null;
    queue = [];
    notify();
  };

  const playNext = async () => {
    if (current) return; // 이미 재생 중
    const key = queue.shift();
    if (!key) { notify(); return; }
    current = key;
    notify();
    let blob: Blob | null = null;
    try { blob = await loadAudioClip(key); } catch { blob = null; }
    // await 사이에 정지(stop/toggle)되었으면 이 continuation은 폐기 — stale 재생 방지 (Codex HIGH)
    if (current !== key) return;
    if (!blob) { current = null; notify(); void playNext(); return; }
    cleanup();
    objectUrl = URL.createObjectURL(blob);
    const a = new Audio(objectUrl);
    audio = a;
    const advance = () => {
      if (audio !== a) return; // stale audio의 이벤트는 무시
      cleanup(); current = null; notify(); void playNext();
    };
    a.onended = advance;
    a.onerror = advance;
    try {
      await a.play();
    } catch {
      if (audio === a) { cleanup(); current = null; notify(); void playNext(); }
      return;
    }
    if (audio === a) notify();
  };

  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    stateOf(key: string): ClipPlayState {
      if (current === key) return 'playing';
      if (queue.includes(key)) return 'queued';
      return 'idle';
    },
    toggle(key: string) {
      if (current === key) {
        // 재생 중인 클립 탭 → 정지 + 큐 전체 취소
        stop();
        return;
      }
      if (queue.includes(key)) {
        // 대기 중인 클립 탭 → 취소
        queue = queue.filter((k) => k !== key); notify();
        return;
      }
      // v0.33.0 B-9 — 클립 재생 계측(이전엔 무로깅 → 클립버튼 오터치 제보를 검증할 수 없었다).
      // 실제 재생 의도(enqueue)만 기록 — 정지/취소 탭은 로깅하지 않아 링버퍼를 아낀다. 키에서
      // 세션 id를 파생해 clipsManifest 조인이 가능하게 한다(clipKey 동봉).
      // v0.34.0 계측 갭②(B-9 원안 완성, Trace) — row/colId 동봉: 클립 키는
      // `sess_<ts>:<row>:<colId>[:cmd<n>]` 규약이므로 여기서 파생한다. "클립 재생 중 발화
      // 오인식" 체크리스트가 재생된 셀과 직후 STT 이벤트를 로그만으로 조인하는 판정 근거.
      const parts = key.split(':');
      const rowNum = Number(parts[1]);
      logger.log({
        type: 'clip',
        extra: 'clip_play',
        clipKey: key,
        sessionId: parts[0],
        row: Number.isFinite(rowNum) ? rowNum : undefined,
        colId: parts[2],
      });
      queue.push(key); notify();
      void playNext();
    },
    // 데이터탭 언마운트·세션 삭제 시 호출 — 전역 재생이 화면 밖에서 지속되지 않도록 (Codex HIGH)
    stop,
  };
})();
