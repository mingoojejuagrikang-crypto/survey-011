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
  /** 🔴 v0.46.1 WP-7(민구 방향 전환 08-07) — **삭제 모드.**
   *
   *  민구 원문: *"텍스트 입력칸에 입력값이 있고 버튼을 터치시 리스트에 추가되는거고, 텍스트
   *  입력칸이 **비어 있을때** 버튼을 누르면 기존에 등록된 값들의 칩 앞에 「x」 기호가 표시되서
   *  사용자가 해당 칩을 터치하면 해당 항목은 사라지는 형태로 가자. **하나가 삭제되면 다시
   *  버튼은 초기화** 되는거구."*
   *
   *  🔑 **왜 종전 방식을 버렸나** — 종전(J-4)은 *"지울 값을 입력창에 정확히 타이핑하면 버튼이
   *  「삭제」로 바뀐다"* 였다. 이 앱의 현장은 **장갑 낀 손 · 원거리**다. 지우려고 긴 값을 오타 없이
   *  치는 것이 삭제 자체보다 어렵다. 새 방식은 **탭 두 번**(모드 진입 → 칩)으로 끝난다.
   *
   *  ⚠️ **삭제 1건마다 모드가 꺼지는 것은 의도된 안전장치다**(민구 지정). 연속 삭제는 번거롭지만
   *  오탭 1회가 2건을 지우는 일이 없다. 여러 개를 지울 때만 버튼을 다시 누른다. */
  const [deleteMode, setDeleteMode] = useState(false);
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
  /** 이미 있는 값은 **추가하지 않는다** — 중복 항목이 생기면 자동입력 순번(order)이 흐트러진다.
   *  🔑 민구 원 제보(*"기존에 이미 존재하는 값을 넣어도 버튼의 문구 변경은 없음"*)가 지적한
   *  침묵을 여기서 갚는다 — 이제 **「이미 있음」이라고 화면에 말한다.** */
  const isDuplicate = draft.length > 0 && available.includes(draft);
  const canAdd = draft.length > 0 && !isDuplicate;
  /** 입력이 비어 있을 때만 삭제 모드를 켤 수 있다(민구 지정). 지울 것이 없으면 무의미하다. */
  const canEnterDeleteMode = draft.length === 0 && available.length > 0;

  /** 선택지에서 값 하나를 뺀다. 삭제 모드의 칩 탭과 (구)입력창 경로가 공유하는 SSOT. */
  const removeValue = (v: string) => {
      const nextAvailable = available.filter((x) => x !== v);
      let nextSelected = selected.filter((x) => x !== v);
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
      setSettings({ optionExclusions: withExclusion(optionExclusions, col.id, v) });
      // 🔴 민구 지정 — **삭제 1건마다 모드를 끈다.** 오탭 1회가 2건을 지우지 못하게.
      setDeleteMode(false);
  };

  const applyDraft = () => {
    if (!canAdd) return;
    {
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

  /** 버튼 한 개가 두 일을 한다(민구 지정): 입력이 있으면 **추가**, 비어 있으면 **삭제 모드 토글**.
   *  🔑 토글인 것이 중요하다 — 민구 안엔 "하나 삭제되면 초기화"만 있어 **삭제 없이 빠져나올
   *  경로가 없었다.** 실수로 켠 모드를 끄지 못하면 다음 탭이 삭제가 된다. */
  const onPrimaryButton = () => {
    if (draft.length > 0) { applyDraft(); return; }
    if (deleteMode) { setDeleteMode(false); return; }
    if (canEnterDeleteMode) setDeleteMode(true);
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
              onClick={() => (deleteMode ? removeValue(v) : toggle(v))}
              aria-pressed={deleteMode ? undefined : sel}
              aria-disabled={(!deleteMode && locked) || undefined}
              title={!deleteMode && locked ? '마지막 선택값입니다. 이 칸을 안 쓰려면 입력방식을 「수동」으로 바꾸세요.' : undefined}
              aria-label={
                deleteMode
                  ? `${v}, 누르면 선택지에서 삭제`
                  : locked
                    ? `${v}, 선택됨 · 마지막 선택값이라 해제할 수 없습니다. 이 칸을 안 쓰려면 입력방식을 수동으로 바꾸세요`
                    : sel
                      ? `${v}, 선택됨 · 자동 입력 ${order}번째. 누르면 해제`
                      : `${v}, 누르면 선택`
              }
              data-testid={`opt-chip-${col.id}-${v}`}
              style={{
                // 🔴 삭제 모드는 **한눈에 달라야 한다** — 같은 탭이 선택 토글이 아니라 삭제가 된다.
                //    테두리·글자색을 붉게 바꿔 모드를 오인할 여지를 없앤다.
                border: `1px solid ${deleteMode ? T.red : sel ? T.blue : T.line}`,
                background: deleteMode ? 'rgba(255,59,48,0.10)' : sel ? T.blueGlow : 'rgba(255,255,255,0.04)',
                color: deleteMode ? T.text : sel ? T.text : T.textDim,
                fontSize: 14, fontWeight: 700,
                // 선택 시 좌측 뱃지 공간 확보(왼쪽 패딩 축소).
                padding: deleteMode || sel ? '6px 12px 6px 6px' : '8px 12px',
                borderRadius: 999,
                cursor: !deleteMode && locked ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
                // 🔴 WP-C — 선택/비선택의 높이를 같게 만든다. 22px 순번 뱃지 때문에 선택 칩이
                //    더 높으면 「2줄」의 실제 높이가 목록 구성에 따라 흔들린다(위 CHIP_H 주석).
                minHeight: CHIP_H,
                boxSizing: 'border-box',
                scrollSnapAlign: 'start',
              }}
            >
              {/* 🔴 v0.46.1 WP-7(민구 08-07) — 삭제 모드에선 순번 뱃지 자리에 **x**를 놓는다.
                  민구 원문: *"기존에 등록된 값들의 칩 앞에 「x」 기호가 표시되서 사용자가 해당
                  칩을 터치하면 해당 항목은 사라지는 형태"*. 같은 자리를 쓰므로 칩 높이(CHIP_H)
                  계약이 흔들리지 않는다 — 「상시 2줄」이 목록 구성에 따라 달라지면 안 된다. */}
              {deleteMode ? (
                <span
                  aria-hidden="true"
                  data-testid={`opt-del-mark-${col.id}-${v}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: '50%',
                    background: T.red, color: '#fff',
                    fontSize: 14, fontWeight: 900, lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  ×
                </span>
              ) : sel ? (
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

      {/* 🔑 민구 원 제보의 침묵을 갚는 자리 — 이미 있는 값을 넣었을 때 **아무 말도 없던** 것이
          FB-2의 출발점이었다. 이제 왜 추가가 안 되는지 화면이 말한다.
          v0.48.0 P2(SCOUT-1 결정 ⓐ) — 기본 버튼 문구가 「삭제」에서 「추가/삭제」로 바뀌어
          이 안내도 실제 버튼 글자를 그대로 인용하도록 맞춘다. */}
      {isDuplicate && (
        <span data-testid={`opt-dup-${col.id}`} style={{ fontSize: 12, fontWeight: 700, color: T.amber }}>
          「{draft}」는 이미 있습니다 — 지우려면 입력을 비우고 「추가/삭제」를 누르세요
        </span>
      )}

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
          // v0.48.0 P2(NEW-1) — 실사용 흐름대로: 기본 문구는 버튼을 누른 뒤 실제로 벌어지는 일
          // (칩 선택)까지 적는다 — "삭제"가 즉시 지운다는 오해를 막는다(삭제는 버튼→칩 탭 2단계).
          placeholder={deleteMode ? "지울 값을 눌러주세요" : "값 입력 후 「추가」 · 비우고 눌러 지울 칩 선택"}
          style={{
            flex: 1, height: 36, borderRadius: 8,
            background: T.bg, border: `1px solid ${T.line}`,
            color: T.text, fontSize: 14, fontWeight: 600,
            outline: 'none', padding: '0 10px', minWidth: 0,
          }}
        />
        <button
          type="button"
          onClick={onPrimaryButton}
          disabled={isDuplicate || (draft.length === 0 && !deleteMode && !canEnterDeleteMode)}
          data-testid={`opt-apply-${col.id}`}
          aria-label={
            isDuplicate
              ? `${draft}, 이미 선택지에 있습니다. 지우려면 입력을 비우고 삭제를 누르세요`
              : draft.length > 0
                ? `${draft}, 누르면 선택지에 추가`
                : deleteMode
                  ? '삭제 모드입니다. 지울 값을 누르세요. 이 버튼을 다시 누르면 취소됩니다'
                  : available.length === 0
                    ? '지울 값이 없습니다'
                    : '누르면 삭제 모드로 바뀝니다. 그 다음 지울 값을 누르세요'
          }
          style={{
            height: 36, padding: '0 14px', borderRadius: 8,
            border: 'none',
            background: isDuplicate ? T.line
              : draft.length > 0 ? T.blue
              : deleteMode ? T.textDim
              : canEnterDeleteMode ? T.red
              : T.line,
            color: isDuplicate || (draft.length === 0 && !deleteMode && !canEnterDeleteMode)
              ? T.textMute : '#fff',
            fontSize: 13, fontWeight: 700,
            cursor: isDuplicate || (draft.length === 0 && !deleteMode && !canEnterDeleteMode)
              ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {/* v0.48.0 P2(NEW-1, SCOUT-1 결정 ⓐ, 민구 08-10) — **기본 상태만** 「삭제」→「추가/삭제」
              (「추가」 부분 강조)로 바꾼다. 입력 有 상태(`+ 추가`)는 원문 미언급이라 종전 그대로
              — OptionsPanel.tsx:69-70 계약("버튼 글자가 미리 바뀐다")을 두 상태가 똑같은 글자로
              보이게 만들어 흐리지 않는다. ⚠️ **삭제모드 중(`deleteMode`)도 종전 「취소」 그대로**
              — 민구 원문은 "빈 값, 버튼 누를시 '삭제'만 하이라이트"를 적었지만, WP-7 커밋
              (`14b10d6`)이 스스로 기록한 대로 `취소`라는 글자 자체가 "실수로 켠 삭제모드를 빠져
              나올 수 있다"는 유일한 시각 신호다 — 그 신호를 지우면 기능은 살아도 발견성이
              죽는다. 08-10 결정 3(SCOUT-1 ⓐ)이 이 축돌을 명시적으로 취소 유지 쪽으로 정리했다
              (`_ASK-scout-v048.md` SCOUT-1). 하이라이트 전환 자체(눌렀을 때 강조가 넘어가는 감각)는
              전용 UI 없이 기존 삭제모드 시각 신호(칩 테두리·배경이 빨강으로 바뀜, :194 이하)로
              충분하다고 가정한다(🟡 NON-BLOCKING — 아니면 `_ASK-scout-v048.md`에 적어달라). */}
          {draft.length > 0 ? '+ 추가' : deleteMode ? '취소' : (
            <>
              <span style={{ fontWeight: 900 }}>추가</span>
              <span style={{ opacity: 0.55 }}>/삭제</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── column card ───────────────────────────────────────────────
