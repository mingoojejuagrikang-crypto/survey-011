/**
 * v0.35.3 Stage 3-3 — 셀 오디오클립 포인터 정리/재연결 (useVoiceSession에서 순수 이동).
 *
 * 캡처가 실패(empty/too small/failed)한 canonical 키(`sess:row:colId`)를 데이터탭이 깨진(404)
 * 재생 버튼으로 그리지 않도록, 메모리(pendingClips)와 영속본(dataStore/IDB) 양쪽의 포인터를
 * 정리한다. 소유권 가드가 계약의 핵심: **포인터가 아직 우리 clipKey를 가리킬 때만** 행동한다
 * (나중의 재시작/수정이 셀을 재소유했으면 건드리지 않는다 — [CLIP-VAL-1]②).
 *
 * ref 공유 없는 명시 인자 인터페이스 — 호출부(useVoiceSession)가 자신의 ref에서 값을 꺼내 넘긴다.
 */
import { useDataStore } from '../stores/dataStore';
import { saveSession } from './db';

interface ClipPointerArgs {
  sessionId: string;
  row: number;
  colId: string;
  /** 실패한 canonical 클립 키 — 이 키를 아직 가리키는 포인터만 정리 대상. */
  clipKey: string;
  /** useVoiceSession의 pendingClipsRef.current — 메모리 쪽 포인터 맵(제자리 수정). */
  pendingClips: Record<number, Record<string, string>>;
}

/** v0.6.0 CLIP-EMPTY — 저장 실패한 클립의 셀 포인터를 메모리·영속본 양쪽에서 제거.
 *  포인터가 이미 다른 키로 재지정됐으면 no-op(소유권 가드). */
export function unlinkClipPointer({ sessionId, row, colId, clipKey, pendingClips }: ClipPointerArgs): void {
  const m = pendingClips[row];
  if (m && m[colId] === clipKey) delete m[colId];
  const sess = useDataStore.getState().sessions.find((s) => s.id === sessionId);
  const prow = sess?.rows.find((r) => r.index === row);
  if (sess && prow?.audioClips?.[colId] === clipKey) {
    const { [colId]: _gone, ...rest } = prow.audioClips;
    const updatedRow = { ...prow, audioClips: Object.keys(rest).length > 0 ? rest : undefined };
    const updatedSession = {
      ...sess,
      rows: sess.rows.map((r) => (r.index === row ? updatedRow : r)),
    };
    useDataStore.getState().upsertSession(updatedSession);
    void saveSession(updatedSession).catch(() => {});
  }
}

/** [CLIP-VAL-1]② — 실패한 canonical 키 대신 건강한 키(수정 명령 클립 `…:cmd<n>`)로 재연결.
 *  메모리 쪽 소유권 가드는 unlink와 동일. 영속본 쪽은 `undefined`도 수용 — [CLIP-VAL-1]③
 *  tombstone strip이 canonical 엔트리를 먼저 지웠을 수 있다. 재연결 수행 여부를 반환. */
export function relinkClipPointer(
  { sessionId, row, colId, clipKey, pendingClips }: ClipPointerArgs,
  newKey: string,
): boolean {
  const m = pendingClips[row];
  if (!m || m[colId] !== clipKey) return false;
  m[colId] = newKey;
  const sess = useDataStore.getState().sessions.find((s) => s.id === sessionId);
  const prow = sess?.rows.find((r) => r.index === row);
  const persisted = prow?.audioClips?.[colId];
  if (sess && prow && (persisted === clipKey || persisted === undefined)) {
    const updatedRow = {
      ...prow,
      audioClips: { ...(prow.audioClips ?? {}), [colId]: newKey },
    };
    const updatedSession = {
      ...sess,
      rows: sess.rows.map((r) => (r.index === row ? updatedRow : r)),
    };
    useDataStore.getState().upsertSession(updatedSession);
    void saveSession(updatedSession).catch(() => {});
  }
  return true;
}
