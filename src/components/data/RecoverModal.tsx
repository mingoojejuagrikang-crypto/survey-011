import { useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import {
  listRecoverableSessionsFromDrive,
  type ZipCache,
  type ZipSessionMeta,
} from '../../lib/recoverFromDrive';
import { Backdrop } from './Backdrop';
import { Checkbox } from './Checkbox';

// ─── recover modal ───────────────────────────────────────────
// v0.6.0 W8 — "세션 복구" 2단계: 기간 칩으로 Drive 로그 목록을 조회한 뒤, 복구할 세션을 골라
// IDB로 복원한다. ExportModal/Checkbox/Backdrop 패턴 재사용. 이미 로컬에 있는 세션은 회색·선택 불가.
type RecoverStage = 'idle' | 'listing' | 'list' | 'restoring' | 'done';
const RANGE_CHIPS: { key: '7' | '30' | 'all'; label: string; days: number | null }[] = [
  { key: '7', label: '최근 7일', days: 7 },
  { key: '30', label: '최근 30일', days: 30 },
  { key: 'all', label: '전체', days: null },
];

export function RecoverModal({
  localIds, onClose, onRestore,
}: {
  localIds: Set<string>;
  onClose: () => void;
  onRestore: (
    selectedIds: Set<string>,
    cache: ZipCache,
    onProgress: (msg: string) => void,
  ) => Promise<{ sessions: number; clips: number; skipped: number }>;
}) {
  const [rangeKey, setRangeKey] = useState<'7' | '30' | 'all'>('30'); // 기본 30일
  const [stage, setStage] = useState<RecoverStage>('idle');
  const [progress, setProgress] = useState('');
  const [list, setList] = useState<ZipSessionMeta[]>([]);
  const [cache, setCache] = useState<ZipCache>(new Map());
  const [legacyZips, setLegacyZips] = useState(0);
  const [failedZips, setFailedZips] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const runList = async () => {
    setStage('listing');
    setError(null);
    setResultMsg(null);
    const chip = RANGE_CHIPS.find((c) => c.key === rangeKey)!;
    const since = chip.days === null ? null : new Date(Date.now() - chip.days * 86400_000);
    const { result, cache: c } = await listRecoverableSessionsFromDrive(since, (p) => setProgress(p));
    if (result.status === 'no_folder') {
      setError('Drive에 백업된 로그가 없습니다.');
      setStage('idle');
      return;
    }
    if (result.status === 'not_signed_in') {
      setError('설정 탭에서 로그인 후 다시 시도하세요.');
      setStage('idle');
      return;
    }
    if (result.status === 'failed') {
      setError(`Drive 목록 조회 실패: ${result.error ?? '알 수 없는 오류'}`);
      setStage('idle');
      return;
    }
    setList(result.sessions);
    setCache(c);
    setLegacyZips(result.legacyZips);
    setFailedZips(result.failedZips);
    // 로컬에 없는 세션만 기본 선택.
    setSelected(new Set(result.sessions.filter((s) => !localIds.has(s.id)).map((s) => s.id)));
    setStage('list');
  };

  const toggle = (id: string) => {
    if (localIds.has(id)) return; // 이미 있는 세션은 선택 불가
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runRestore = async () => {
    setStage('restoring');
    setProgress('복구 중...');
    const r = await onRestore(selected, cache, (p) => setProgress(p));
    setResultMsg(`✓ 세션 ${r.sessions}개(클립 ${r.clips}개) 복구됨`);
    // F10: drop the cached zip blobs (each is a full downloaded log zip held in memory) once
    // restore is done — they're no longer needed and would otherwise pin Blob memory until the
    // modal unmounts. A fresh "목록 조회" rebuilds the cache.
    setCache(new Map());
    setStage('done');
  };

  const restorableCount = list.filter((s) => !localIds.has(s.id)).length;

  return (
    <Backdrop onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 380, maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Drive에서 세션 복구</div>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              width: 36, height: 36, borderRadius: 18,
              border: 'none', background: 'rgba(255,255,255,0.06)',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>

        {/* 기간 칩 */}
        <div style={{ padding: '12px 16px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: T.textMute }}>조회 기간 (Drive 업로드 날짜 기준)</div>
          <div role="radiogroup" aria-label="조회 기간" style={{ display: 'flex', gap: 8 }}>
            {RANGE_CHIPS.map((c) => {
              const active = rangeKey === c.key;
              return (
                <button
                  key={c.key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setRangeKey(c.key)}
                  disabled={stage === 'listing' || stage === 'restoring'}
                  style={{
                    flex: 1, height: 40, borderRadius: 10,
                    border: `1px solid ${active ? T.blue : T.lineStrong}`,
                    background: active ? 'rgba(41,121,255,0.14)' : 'transparent',
                    color: active ? T.text : T.textDim,
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 본문: idle/list 상태별 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 60 }}>
          {error && (
            <div style={{ padding: 14, fontSize: 13, color: T.amber, lineHeight: 1.5 }}>{error}</div>
          )}
          {(stage === 'listing' || stage === 'restoring') && (
            <div style={{ padding: 20, textAlign: 'center', color: T.textDim, fontSize: 13 }} aria-live="polite">
              {progress || (stage === 'listing' ? 'Drive 로그 목록 조회 중...' : '복구 중...')}
            </div>
          )}
          {stage === 'done' && (
            <div style={{ padding: 20, textAlign: 'center', color: T.green, fontSize: 15, fontWeight: 700 }} aria-live="polite">
              {resultMsg}
            </div>
          )}
          {stage === 'list' && (
            <>
              {(legacyZips > 0 || failedZips > 0) && (
                <div style={{ padding: '4px 8px 8px', fontSize: 11, color: T.textMute, lineHeight: 1.5 }}>
                  {legacyZips > 0 && `구버전 로그 ${legacyZips}개 제외`}
                  {legacyZips > 0 && failedZips > 0 && ' · '}
                  {failedZips > 0 && `⚠️ 로그 ${failedZips}개 읽기 실패`}
                </div>
              )}
              {list.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: T.textMute, fontSize: 13 }}>
                  이 기간에 복구할 세션이 없습니다.
                </div>
              ) : (
                list.map((s) => {
                  const already = localIds.has(s.id);
                  const checked = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      disabled={already}
                      style={{
                        width: '100%',
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 10px',
                        background: 'transparent', border: 'none',
                        color: 'inherit',
                        borderBottom: `1px solid ${T.line}`,
                        cursor: already ? 'not-allowed' : 'pointer',
                        textAlign: 'left', opacity: already ? 0.5 : 1,
                      }}
                    >
                      <Checkbox checked={checked && !already} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 15, fontWeight: 700, color: T.text,
                            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          }}
                        >
                          {s.date}
                          {s.label && (
                            <span style={{ marginLeft: 8, fontSize: 12, color: T.textMute, fontFamily: 'inherit' }}>
                              {s.label}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: T.textMute, marginTop: 2 }}>
                          {s.rowCount}행
                          {/* v0.7.0 B0 — 같은 날짜 세션 구분용 시작 시각(hh:mm).
                              레거시 zip은 startedAt이 없거나 0 → 표시 생략. */}
                          {Number.isFinite(s.startedAt) && s.startedAt > 0 &&
                            ` · ${new Date(s.startedAt).toLocaleTimeString('ko-KR', {
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })}`}
                          {already && ' · 이미 있음'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: `1px solid ${T.line}`,
            display: 'flex', gap: 10,
          }}
        >
          {stage === 'list' ? (
            <>
              <button
                onClick={onClose}
                style={{
                  flex: 1, height: 48, borderRadius: 14,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                닫기
              </button>
              <button
                onClick={runRestore}
                disabled={selected.size === 0}
                style={{
                  flex: 1, height: 48, borderRadius: 14, border: 'none',
                  background: selected.size === 0 ? '#2A2D32' : T.blue,
                  color: selected.size === 0 ? T.textMute : '#fff',
                  fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                  cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: selected.size === 0 ? 'none' : `0 4px 14px ${T.blueGlow}`,
                }}
              >
                선택 복구 ({selected.size})
              </button>
            </>
          ) : stage === 'done' ? (
            <button
              onClick={onClose}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 15, fontWeight: 800, cursor: 'pointer',
                boxShadow: `0 4px 14px ${T.blueGlow}`,
              }}
            >
              완료
            </button>
          ) : (
            <button
              onClick={runList}
              disabled={stage === 'listing' || stage === 'restoring'}
              aria-busy={stage === 'listing'}
              style={{
                flex: 1, height: 48, borderRadius: 14, border: 'none',
                background: stage === 'listing' ? '#2A2D32' : T.blue,
                color: stage === 'listing' ? T.textMute : '#fff',
                fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                cursor: stage === 'listing' ? 'wait' : 'pointer',
                boxShadow: stage === 'listing' ? 'none' : `0 4px 14px ${T.blueGlow}`,
              }}
            >
              {stage === 'listing' ? '조회 중…' : '목록 조회'}
            </button>
          )}
        </div>
        {stage === 'list' && restorableCount === 0 && list.length > 0 && (
          <div style={{ padding: '0 16px 10px', fontSize: 11, color: T.textMute, textAlign: 'center' }}>
            조회된 세션이 모두 이미 기기에 있습니다.
          </div>
        )}
      </div>
    </Backdrop>
  );
}
