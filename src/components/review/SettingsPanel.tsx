/**
 * 비교탭 접이식 표시 설정 패널 — 샘플키 컬럼 토글 + 조사시기(회차) 컬럼 select(설정탭에서 이전).
 * 샘플키 0개 데드락 방지를 위해 그 상태에선 defaultOpen으로 펼쳐 노출한다(ReviewScreen 호출).
 *
 * 이 패널은 인덱스 구성(키/회차)을 바꾸므로, 토글 시 ReviewScreen이 캐시를 stale 처리하고
 * 강제 재로드 + 행 선택을 리셋한다(settingsFp 효과). 패널 자체는 표현만 담당.
 */
import { T } from '../../tokens';
import { I } from '../icons';
import { effectiveSampleKey } from '../../lib/columnFlags';
import { FS } from './reviewShared';
import type { Column } from '../../types';

export function SettingsPanel({
  keyCandidates,
  dateCols,
  roundDateColId,
  onToggleKey,
  onRoundDateCol,
  defaultOpen = false,
}: {
  keyCandidates: Column[];
  dateCols: Column[];
  roundDateColId: string | null;
  onToggleKey: (col: Column, on: boolean) => void;
  onRoundDateCol: (id: string | null) => void;
  defaultOpen?: boolean;
}) {
  return (
    <details
      data-testid="review-settings-panel"
      open={defaultOpen}
      style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14 }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '11px 14px',
          fontSize: FS.label,
          fontWeight: 700,
          color: T.textDim,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          boxSizing: 'border-box',
        }}
      >
        <span aria-hidden style={{ color: T.textMute, display: 'flex' }}>
          {I.grip(16, 'currentColor')}
        </span>
        표시 설정 (샘플키 · 조사시기)
      </summary>

      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 샘플키 컬럼 토글 */}
        <div>
          <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, marginBottom: 8 }}>
            샘플키 항목 — 같은 샘플을 식별할 항목을 켜세요
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {keyCandidates.length === 0 ? (
              <span style={{ fontSize: FS.small, color: T.textMute }}>후보 항목 없음</span>
            ) : (
              keyCandidates.map((c) => {
                const on = effectiveSampleKey(c);
                return (
                  <button
                    key={c.id}
                    data-testid={`review-keycol-${c.id}`}
                    aria-pressed={on}
                    onClick={() => onToggleKey(c, !on)}
                    style={{
                      minHeight: 40,
                      padding: '0 14px',
                      borderRadius: 999,
                      border: `1px solid ${on ? T.blue : T.line}`,
                      background: on ? T.blueGlow : T.inputBg,
                      color: on ? '#BBD4FF' : T.textDim,
                      fontSize: FS.small,
                      fontWeight: on ? 700 : 600,
                      cursor: 'pointer',
                      letterSpacing: -0.1,
                    }}
                  >
                    {c.name}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 조사시기(회차) 컬럼 select */}
        <div>
          <label
            htmlFor="round-date-col"
            style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, display: 'block', marginBottom: 8 }}
          >
            조사시기(회차) 항목 — 시간 비교 기준 날짜
          </label>
          <select
            id="round-date-col"
            data-testid="round-date-col"
            value={roundDateColId ?? ''}
            onChange={(e) => onRoundDateCol(e.target.value || null)}
            style={{
              minHeight: 44,
              width: '100%',
              maxWidth: 320,
              borderRadius: 12,
              background: T.inputBg,
              border: `1px solid ${T.line}`,
              color: T.text,
              fontSize: FS.label,
              fontWeight: 600,
              outline: 'none',
              padding: '0 12px',
            }}
          >
            <option value="">자동 (조사일자 우선)</option>
            {dateCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}
