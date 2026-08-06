import { useState } from 'react';
import { T } from '../../tokens';
import type { Column } from '../../types';
import { autoValue } from '../../lib/autoValue';
import { useSettingsStore } from '../../stores/settingsStore';
import { withExclusion, withoutExclusion } from '../../lib/optionExclusions';

/**
 * v0.46.0 WP-C (제보 F12 · 민구 R4 확정) — **선택값 목록은 「상시 2줄」이다.**
 *
 * 민구 원문: *"카드 갯수를 늘린다는게 아니라, **카드 사이즈**를 늘린다는 의미.
 * 1 무제한 스크롤, **상시 표현은 2줄**."* → 08-06 재확인: **2줄 제한 + 내부 스크롤**.
 *
 * 🔴 **높이를 px로 박지 않고 「칩 한 줄 × 2 + 간격」으로 유도한다.** 종전 `maxHeight: 200`은
 *    칩 높이와 무관한 마법수라 폰트·패딩이 바뀌면 「2줄」이 3줄도 1.5줄도 됐다.
 * 🔑 **`CHIP_H`를 선택/비선택 양쪽에 `minHeight`로 강제하는 것이 이 계약의 핵심이다.**
 *    선택 칩은 22px 순번 뱃지 때문에 비선택보다 높았고, 그러면 「2줄」의 실제 높이가
 *    **목록 구성에 따라 달라진다**(선택이 섞이면 잘리는 위치가 바뀐다).
 * ⚠️ 개수·이름 가정 없음(§시트 불특정) — 1줄이면 1줄로 줄고, 넘치면 그 안에서 스크롤한다.
 */
const CHIP_H = 36;
const CHIP_GAP = 6;
const VISIBLE_ROWS = 2;
const LIST_MAX_H = CHIP_H * VISIBLE_ROWS + CHIP_GAP * (VISIBLE_ROWS - 1);

export function OptionsPanel({ col, onChange }: { col: Column; onChange: (c: Column) => void }) {
  const [newOption, setNewOption] = useState('');
  // v0.46.0 WP-J J-5 — 제외 목록은 스토어 최상위 맵(colId → 지운 값들). 컬럼 안에 두면 시트
  // 자동 갱신이 컬럼을 통째로 갈아끼울 때 함께 날아가 R11("한 번 지우면 계속 유지")이 깨진다.
  const setSettings = useSettingsStore((st) => st.set);
  const optionExclusions = useSettingsStore((st) => st.optionExclusions);
  if (col.auto.kind !== 'options') return null;
  const { available, selected } = col.auto;

  /**
   * 🔴 v0.46.0 콜드 리뷰 L4-② — **마지막 선택값은 해제할 수 없다.**
   * 민구 계약(08-06): *"전체행은 **자동 입력 설정된 항목들이 미리 테이블을 만들고**, 수동이나
   * 음성입력이 만들어진 테이블을 채우는 형태야."* → 자동입력 컬럼은 **골격을 만드는 주체**이므로
   * 값이 없어선 안 된다. `selected`가 비면 `autoValue`가 `''`를 돌려(`autoValue.ts:33`)
   * **그 컬럼이 전 행 빈칸으로 시트에 기록되고, `input:'auto'`라 사용자가 손으로 채울 수도 없다.**
   * 👉 그 칸을 안 쓸 거라면 선택지를 비우는 게 아니라 **입력방식을 「수동」으로** 바꾼다
   *    (그러면 `ColumnCard`가 목록을 떼고 사람이 채우는 칸이 된다 — 같은 계약의 다른 쪽).
   */
  const isLastSelected = (v: string) => selected.length === 1 && selected[0] === v;

  const toggle = (v: string) => {
    if (isLastSelected(v)) return;
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
      const nextAvailable = available.filter((x) => x !== draft);
      let nextSelected = selected.filter((x) => x !== draft);
      // 🔴 v0.46.0 콜드 리뷰 L4-② — **선택값이 비면 남은 값 중 첫 번째를 자동으로 선택한다.**
      //    자동입력 컬럼은 테이블 골격을 만드는 주체라 값이 없어선 안 된다(민구 계약 08-06).
      //    비면 `autoValue`가 `''`를 돌려 그 컬럼이 전 행 빈칸으로 기록되고, `input:'auto'`라
      //    사용자가 손으로 채울 수도 없다.
      //    🔑 **삭제 자체를 막지는 않는다** — 그건 J-4·J-5(민구 R8·R11 "한 번 지우면 계속 유지")의
      //    핵심 기능이다. 처음 이 가드를 「삭제 금지」로 넣었더니 `v0460-wp-j-sheet-range`의
      //    J-5 끝단 오라클이 red로 잡아냈다. **막을 것은 빈 상태이고 삭제가 아니다.**
      //    ⚠️ `available`까지 비는 것은 사용자가 명시적으로 만든 상태다(UI가 "추가하세요"로 안내).
      if (nextSelected.length === 0 && nextAvailable.length > 0) {
        nextSelected = nextAvailable.slice(0, 1);
      }
      onChange({
        ...col,
        auto: { kind: 'options', available: nextAvailable, selected: nextSelected },
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

      <div
        data-testid={`opt-list-${col.id}`}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: CHIP_GAP,
          // WP-C: 1줄이면 1줄(내용만큼), 2줄까지 보이고, 넘으면 여기서 스크롤한다.
          maxHeight: LIST_MAX_H,
          overflowY: 'auto',
          // 스크롤이 칩 중간에서 멈춰 「반 줄」이 보이지 않게 — 줄 단위로 붙는다.
          scrollSnapType: 'y proximity',
        }}
      >
        {available.length === 0 && (
          <span style={{ fontSize: 12, color: T.textMute, fontStyle: 'italic' }}>
            등록된 값이 없습니다. 아래에서 추가하세요.
          </span>
        )}
        {available.map((v) => {
          const sel = selected.includes(v);
          // 선택 순번(1부터) = 터치 순서 = 행별 자동입력 순서(auto.selected 순서를 autoValue가 소비).
          const order = sel ? selected.indexOf(v) + 1 : 0;
          // 🔴 L4-② — 마지막 하나는 해제 불가(위 toggle 주석이 계약의 SSOT).
          //    누르면 아무 일도 안 일어나므로 **왜 안 되는지 화면과 스크린리더 양쪽에 남긴다.**
          const locked = isLastSelected(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              aria-pressed={sel}
              aria-disabled={locked || undefined}
              title={locked ? '마지막 선택값입니다. 이 칸을 안 쓰려면 입력방식을 「수동」으로 바꾸세요.' : undefined}
              aria-label={
                locked
                  ? `${v}, 선택됨 · 마지막 선택값이라 해제할 수 없습니다. 이 칸을 안 쓰려면 입력방식을 수동으로 바꾸세요`
                  : sel
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
                cursor: locked ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
                // 🔴 WP-C — 선택/비선택의 높이를 같게 만든다. 22px 순번 뱃지 때문에 선택 칩이
                //    더 높으면 「2줄」의 실제 높이가 목록 구성에 따라 흔들린다(위 CHIP_H 주석).
                minHeight: CHIP_H,
                boxSizing: 'border-box',
                scrollSnapAlign: 'start',
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
                ? isLastSelected(draft)
                  ? `${draft}, 선택지에서 삭제. 마지막 선택값이라 다음 값이 자동으로 선택됩니다`
                  : `${draft}, 선택지에 있음. 누르면 선택지에서 삭제`
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
