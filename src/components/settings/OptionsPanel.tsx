import { useState } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';
import { autoValue } from '../../lib/autoValue';
import { useSettingsStore } from '../../stores/settingsStore';
import { withExclusion, withoutExclusion } from '../../lib/optionExclusions';

export function OptionsPanel({ col, onChange }: { col: Column; onChange: (c: Column) => void }) {
  const [newOption, setNewOption] = useState('');
  // v0.46.0 WP-J J-5 — 제외 목록은 스토어 최상위 맵(colId → 지운 값들). 컬럼 안에 두면 시트
  // 자동 갱신이 컬럼을 통째로 갈아끼울 때 함께 날아가 R11("한 번 지우면 계속 유지")이 깨진다.
  const setSettings = useSettingsStore((st) => st.set);
  const optionExclusions = useSettingsStore((st) => st.optionExclusions);
  if (col.auto.kind !== 'options') return null;
  const { available, selected } = col.auto;

  const toggle = (v: string) => {
    const isSel = selected.includes(v);
    const next = isSel ? selected.filter((x) => x !== v) : [...selected, v];
    onChange({ ...col, auto: { kind: 'options', available, selected: next } });
  };

  /**
   * v0.46.0 WP-J J-4 (민구 R8 확정) — **입력창 + 버튼 하나. 있으면 지우고 없으면 넣는다.**
   * 🔑 버튼 글자가 입력 내용에 따라 **미리** 바뀐다(`추가`/`삭제`) — 누르기 전에 무엇이 일어날지
   * 보이는 것이 이 사양의 핵심이다. 빈 입력이면 비활성(아무 일도 일어나지 않는다).
   * ⚠️ 삭제는 **선택지에서만** 빼는 것이다 — 시트의 과거 데이터는 건드리지 않는다.
   */
  const draft = newOption.trim();
  const willRemove = draft.length > 0 && available.includes(draft);
  const canApply = draft.length > 0;

  const applyDraft = () => {
    if (!canApply) return;
    if (willRemove) {
      onChange({
        ...col,
        auto: {
          kind: 'options',
          available: available.filter((x) => x !== draft),
          selected: selected.filter((x) => x !== draft),
        },
      });
      // J-5 — 지운 값을 기억한다. 다음 시트 자동 갱신이 이 값을 다시 넣지 않는다.
      setSettings({ optionExclusions: withExclusion(optionExclusions, col.id, draft) });
    } else {
      // 새 값은 **맨 앞**에 넣는다 — "최근에 쓴 값이 위"라는 J-1 정렬 계약과 같은 방향이고,
      // 목록이 길 때 방금 넣은 값을 찾으러 스크롤하지 않아도 된다.
      onChange({
        ...col,
        auto: { kind: 'options', available: [draft, ...available], selected: [...selected, draft] },
      });
      // 되살린 값은 제외 목록에서 뺀다 — 안 그러면 다음 자동 갱신이 도로 지운다.
      setSettings({ optionExclusions: withoutExclusion(optionExclusions, col.id, draft) });
    }
    setNewOption('');
  };

  return (
    <div
      style={{
        marginTop: 4,
        padding: '10px 12px',
        background: T.inputBg,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, letterSpacing: 0.4 }}>
          선택값 · {selected.length} / {available.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
        {available.length === 0 && (
          <span style={{ fontSize: 12, color: T.textMute, fontStyle: 'italic' }}>
            등록된 값이 없습니다. 아래에서 추가하세요.
          </span>
        )}
        {available.map((v) => {
          const sel = selected.includes(v);
          // 선택 순번(1부터) = 터치 순서 = 행별 자동입력 순서(auto.selected 순서를 autoValue가 소비).
          const order = sel ? selected.indexOf(v) + 1 : 0;
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              aria-pressed={sel}
              aria-label={
                sel
                  ? `${v}, 선택됨 · 자동 입력 ${order}번째. 누르면 해제`
                  : `${v}, 누르면 선택`
              }
              data-testid={`opt-chip-${col.id}-${v}`}
              style={{
                border: `1px solid ${sel ? T.blue : T.line}`,
                background: sel ? T.blueGlow : 'rgba(255,255,255,0.04)',
                color: sel ? T.text : T.textDim,
                fontSize: 14, fontWeight: 700,
                // 선택 시 좌측 뱃지 공간 확보(왼쪽 패딩 축소).
                padding: sel ? '6px 12px 6px 6px' : '8px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {sel ? (
                <span
                  aria-hidden="true"
                  data-testid={`opt-badge-${col.id}-${v}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: '50%',
                    background: T.blue, color: '#fff',
                    fontSize: 13, fontWeight: 800, lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {order}
                </span>
              ) : null}
              {v}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyDraft();
            }
          }}
          data-testid={`opt-input-${col.id}`}
          placeholder="값 입력 — 없으면 추가, 있으면 삭제"
          style={{
            flex: 1, height: 36, borderRadius: 8,
            background: T.bg, border: `1px solid ${T.line}`,
            color: T.text, fontSize: 14, fontWeight: 600,
            outline: 'none', padding: '0 10px', minWidth: 0,
          }}
        />
        <button
          type="button"
          onClick={applyDraft}
          disabled={!canApply}
          data-testid={`opt-apply-${col.id}`}
          aria-label={
            !canApply
              ? '값을 입력하면 추가하거나 삭제할 수 있어요'
              : willRemove
                ? `${draft}, 선택지에 있음. 누르면 선택지에서 삭제`
                : `${draft}, 선택지에 없음. 누르면 선택지에 추가`
          }
          style={{
            height: 36, padding: '0 14px', borderRadius: 8,
            border: 'none',
            background: !canApply ? T.line : willRemove ? T.red : T.blue,
            color: !canApply ? T.textMute : '#fff',
            fontSize: 13, fontWeight: 700,
            cursor: canApply ? 'pointer' : 'default',
            whiteSpace: 'nowrap',
          }}
        >
          {willRemove ? '− 삭제' : '+ 추가'}
        </button>
      </div>
    </div>
  );
}

// ─── column card ───────────────────────────────────────────────
