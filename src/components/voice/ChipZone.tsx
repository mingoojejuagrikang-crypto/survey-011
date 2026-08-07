import { useCallback, useEffect, useRef, type MutableRefObject, type Ref } from 'react';
import { T } from '../../tokens';
import { ColumnChip } from './ColumnChip';
import { nestedAutoValue } from '../../lib/autoValue';
import { useSettingsStore } from '../../stores/settingsStore';
import { chipSweepOffset, chipSweepStartFor, shouldChipSweep } from '../../lib/chipSweep';
import type { Column } from '../../types';

/** 칩존 **20%** 트랙(v0.43.0 UI-b, 종전 25%) — **한 행 · 가로 스크롤 · 진행중 칩 우측 끝 정렬**
 *  (민구 확정 2026-07-27). 🔴 20%는 T3 7회차 위험이라 `v037-chip-2row`의 잘림 가드가 지킨다.
 *
 *  ## 무엇이 바뀌었나 (v0.40.0)
 *  종전은 **2줄 + 세로 스크롤**이었고, 2줄에 맞추려고 글자를 배율(`--chip-fit`)로 줄였다.
 *  민구가 실기기에서 보고 뒤집었다 — 칩이 작아 값을 읽기 어려웠고, 25% 트랙에서 세로로 스크롤할
 *  공간이 애초에 없었다("세로 스크롤 영역이 너무 작기에").
 *
 *  ⚠️ **fb-27-2 원문은 "가로가 아닌 세로"였다.** 원문만 보고 되돌리지 마라 — 민구가 화면을 보고
 *  판단을 바꾼 것이고, 그게 최신 결정이다.
 *
 *  이제 한 행이 트랙을 통째로 쓰므로 칩 높이가 약 2배가 되고, 그만큼 항목명·값을 크게 쓸 수 있다.
 *  넘치는 칩은 줄을 늘리는 대신 **가로로** 밀린다.
 *
 *  ## 크기는 전부 컨테이너 비례다
 *  민구 조건: "기기 변경 되어도 일정 비율로 조절되어서 어색하지 않아야 함."
 *  그래서 이 요소가 **컨테이너**(`container-type: size`)이고, 칩의 글자·여백은 `cqh`/`cqw`로
 *  이 트랙에 비례한다. 고정 px은 `clamp()`의 하한/상한(가독 한계·과대 방지)에만 쓴다.
 *
 *  ## 삭제된 것: `--chip-fit` / `useChipFlowFit`
 *  그 훅은 "2줄 안에 우겨넣기" 전용이었다. 한 행 + 가로 스크롤에서는 넘침을 스크롤이 받으므로
 *  글자를 줄일 이유가 사라졌다 — 오히려 민구 요구(비율 사이즈업)와 정반대로 작동한다. */
const CHIP_GAP = 8;
/** 🔴 v0.43.0 UI-b — `6`에서 내렸다. 칩존을 25→20%로 줄이자 390×568에서 칩 내용이 6px 넘쳤고,
 *  처방은 **글자를 줄이는 것이 아니라 빈 공간을 회수하는 것**이다(HANDOFF UI-a 함정 2).
 *  이 패딩은 근거 주석이 없던 값이고, 칩존은 이미 `borderBottom`으로 경계를 그린다.
 *  ⚠️ `v039-active-zones:88`이 `zone.chipHeight - 12`로 이 값을 이중 기록하고 있었다 —
 *  거기도 함께 고쳤다. 다시 갈라지면 한쪽만 고쳐진 채 테스트가 통과한다. */
const CHIP_PAD_Y = 3;

/** 🔴 v0.46.0 WP-D — **칩존 좌우 왕복 스크롤**. 되돌리기 전에 반드시 읽어라.
 *
 *  ## ① 무엇을 대체했나
 *  **「활성 칩을 칩존 우측 끝에 고정」 계약(민구 확정 2026-07-27)** 을 대체한다. 그 산술은
 *  `ActiveState.tsx`의 `alignActiveChip`(:203-241)에 그대로 살아 있고, 그 근거 주석도 그대로다.
 *  **폐기가 아니다** — 왕복이 꺼져 있으면(`chipSweepSeconds === 0`, 그리고 `prefers-reduced-motion`)
 *  07-27 계약이 **종전 그대로** 동작한다. 회귀 테스트도 살아 있다(`v039-active-zones.spec.ts`의
 *  우측끝 6단언 — 공유 픽스처가 `chipSweepSeconds: 0`을 넣어 「왕복 OFF 조건의 계약」으로 명시).
 *
 *  ## ② 왜 대체했나
 *  제보 **F17**: *"항목이 많으면 칩이 화면 밖으로 넘어가 멀리서 진행 상황을 볼 수 없다."*
 *  민구는 나무 사이를 오가며 태블릿을 2~3m 떨어뜨려 놓고 음성으로 입력한다. 우측 끝 고정은
 *  **가까이서 볼 때** 최적이다(왼쪽에 입력 완료 칩이 쌓여 확인 영역이 된다). 멀리서는 화면 밖
 *  칩을 손으로 밀 수가 없어 아예 못 본다. 민구 확정(**R3**): *"입력탭의 진행설정에서 칩 왕복
 *  속도 및 활성화 설정 기능 추가. 기본값은 8초, 0초는 OFF."*
 *  🔴 **왕복은 「보기」 수단이지 「활성 표시」를 대체하지 않는다** — 진행중 칩 하이라이트는
 *  왕복 중에도 그대로 살아 있다(`isActive` prop은 스크롤과 무관하다. 오라클 §③이 이걸 잰다).
 *
 *  ## ③ 되살리려면 무엇을 봐야 하나
 *  - 이 파일의 `useChipSweep` + `src/lib/chipSweep.ts`(산술 SSOT)를 지우면 07-27 상태로 돌아간다.
 *  - `ActiveState.tsx:203-241` — 우측끝 계약의 **근거 원문**(민구: *"한국인들은 글을 읽을때
 *    좌>우로 읽어"*). 세 후보가 전부 물린 이력이 거기 적혀 있다.
 *  - `tests/v039-active-zones.spec.ts` + `tests/fixtures/activeZones.ts`의 `chipSweepSeconds`.
 *  - 이 레포는 **기록이 없어 같은 결정을 세 번 뒤집은 이력**이 있다. 이 주석을 지우지 마라.
 *
 *  ## 두 계약이 만나는 지점 (읽어라 — 버그로 오인하기 쉽다)
 *  왕복이 켜져 있어도 `alignActiveChip`은 **계속 발화한다**(활성 칩 변경·리사이즈). 우리는 그걸
 *  막지 않는다 — `ActiveState.tsx`는 다른 레인 소유이고, 막을 필요도 없다. 대신 **정렬이 옮겨놓은
 *  자리에서 왕복이 위상을 이어받는다**(`chipSweepStartFor`). 그래서 칩이 넘어갈 때 튀지 않고,
 *  왕복을 끄면 정렬만 남는다. */
function useChipSweep(
  elRef: MutableRefObject<HTMLDivElement | null>,
  seconds: number,
  resyncRef: MutableRefObject<boolean>,
  /** 🔴 v0.46.1 WP-4 C3-①(민구 08-07) — *"사람이 칩을 터치하여 수동 입력시에도 스크롤
   *  멈춰야하고"*. 손가락 접촉(`held`)과 **다른 축**이다: 시트/인라인 편집이 열려 있는 동안은
   *  손을 떼고 있어도 멈춰야 한다(값을 보며 입력하는 중이다). */
  paused: boolean,
) {
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // 0 = 끔(민구 확정). rAF를 **아예 켜지 않는다** — 매 프레임 도는 루프를 조건문으로 흘려보내면
    // 배터리를 계속 쓴다(현장에서 하루 종일 켜 두는 앱이다).
    if (seconds <= 0) return;
    // 이 레포 관례 — 모션 민감 설정이면 rAF 루프 자체를 안 켠다(StateDots·useAudioLevelVar·EdgeGlow).
    // 왕복이 꺼져도 07-27 우측끝 정렬이 살아 있으므로 진행 표시는 사라지지 않는다.
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    let raf = 0;
    let start = -1;
    let held = false; // 손이 칩존에 닿아 있는 동안 정지(장갑 낀 손의 오탭·드래그와 싸우지 않는다)
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      // 🔴 왕복 거리는 **매 프레임 실측**한다 — 칩 개수·항목명 길이·기기 폭에 대한 가정이 없다
      //    (§시트 불특정). 칩이 화면에 다 들어오면 `max <= 1`이라 왕복하지 않는다.
      const max = el.scrollWidth - el.clientWidth;
      if (!shouldChipSweep(seconds, max)) {
        resyncRef.current = true; // 다시 넘칠 때 현재 위치에서 이어받는다
        return;
      }
      if (held || paused) {
        // 🔑 **재개는 「지금 보이는 자리」에서다**(민구 C4): *"사람의 터치나 스크롤이 끝나면
        //    그 화면에서 스크롤이 되어야지, 자동 스크롤 되었을 경우의 위치로 한번에
        //    자동 스크롤 되지 않으면 좋겠어."* → `chipSweepStartFor`가 현재 scrollLeft로
        //    위상을 역산하므로 점프가 없다. 이 플래그 한 줄이 그 계약을 만든다.
        resyncRef.current = true;
        return;
      }
      // 🔴 v0.46.1 WP-4 C1(민구 08-07) — *"항목중에 TTS 알람이 설정된 칩들만 자동 스크롤 되면
      //    좋겠어."* 왕복 구간을 **음성안내(ttsAnnounce) 칩들이 차지하는 범위**로 좁힌다.
      //    🔑 매 프레임 실측이다 — 칩 개수·폭·항목명 길이에 대한 가정이 없다(§시트 불특정).
      //    표식이 하나도 없으면(전부 꺼져 있으면) 종전대로 트랙 전체를 왕복한다 — 갑자기
      //    안 움직이면 "고장"으로 보인다.
      let from = 0;
      let to = max;
      const marked = el.querySelectorAll<HTMLElement>('[data-tts-announce="true"]');
      if (marked.length > 0) {
        let minL = Infinity;
        let maxR = -Infinity;
        marked.forEach((k) => {
          minL = Math.min(minL, k.offsetLeft);
          maxR = Math.max(maxR, k.offsetLeft + k.offsetWidth);
        });
        if (Number.isFinite(minL) && maxR > -Infinity) {
          // 대상 묶음의 왼쪽 끝이 화면 왼쪽에 오는 지점 ~ 오른쪽 끝이 화면 오른쪽에 오는 지점.
          from = Math.max(0, Math.min(minL, max));
          to = Math.max(from, Math.min(maxR - el.clientWidth, max));
        }
      }
      const range = to - from;
      // 대상이 이미 한 화면에 다 들어오면 왕복할 거리가 없다 — 억지로 흔들지 않는다.
      if (!shouldChipSweep(seconds, range)) {
        resyncRef.current = true;
        return;
      }
      if (resyncRef.current || start < 0) {
        start = chipSweepStartFor(ts, el.scrollLeft - from, seconds, range);
        resyncRef.current = false;
      }
      el.scrollLeft = from + chipSweepOffset(ts - start, seconds, range);
    };
    const hold = () => { held = true; };
    const release = () => { held = false; };
    // 🔴 뗌은 **window에서** 듣는다. 두 실패 모드를 동시에 막는 유일한 조합이다:
    //    · 요소에만 걸면 — 손가락이 칩존 밖으로 나가서 떼는 순간(드래그는 늘 그렇다) `pointerup`이
    //      이 요소로 오지 않아 `held`가 **영영 true**가 되고 왕복이 조용히 죽는다.
    //    · `pointerleave`를 뗌으로 치면 — 손가락이 **아직 닿아 있는데** 경계를 넘는 순간 재개돼
    //      사용자의 손과 싸운다.
    el.addEventListener('pointerdown', hold);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', hold);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [elRef, seconds, resyncRef, paused]);
}

export function ChipZone({
  columns, rowValues, row, currentColId, activeTone, anomalyPending, editingColId,
  activeChipRef, gridRef, onActivate, onCommit, onCancel, commitMarkColId,
}: {
  columns: Column[];
  rowValues: Record<string, string>;
  row: number;
  currentColId?: string;
  activeTone: string;
  anomalyPending: boolean;
  editingColId: string | null;
  activeChipRef: Ref<HTMLDivElement>;
  /** 자동 스크롤(우측 끝 정렬)을 ActiveState가 수행하기 위한 스크롤 컨테이너 핸들. */
  gridRef: Ref<HTMLDivElement>;
  onActivate: (c: Column) => void;
  onCommit: (c: Column, value: string, prevValue: string) => void;
  onCancel: () => void;
  /** v0.45.0 UI③ — 방금 음성 확정된 칩(V 마크 대상)의 colId. null=마크 없음. */
  commitMarkColId?: string | null;
}) {
  const sweepSeconds = useSettingsStore((s) => s.chipSweepSeconds);
  // 왕복 루프가 DOM을 직접 만지려면 자기 핸들이 필요한데, `gridRef`는 부모(ActiveState)가 소유한
  // `Ref`라 여기서 `.current`를 읽을 수 없다. 콜백 ref로 **둘 다** 채운다 — 부모 계약 불변.
  const localGridRef = useRef<HTMLDivElement | null>(null);
  const setGridRef = useCallback((el: HTMLDivElement | null) => {
    localGridRef.current = el;
    if (typeof gridRef === 'function') gridRef(el);
    else if (gridRef) (gridRef as MutableRefObject<HTMLDivElement | null>).current = el;
  }, [gridRef]);
  // 활성 칩·행·확정 마크가 바뀌면 `ActiveState`의 우측끝 정렬이 `scrollLeft`를 옮긴다. 그 자리에서
  // 왕복 위상을 이어받게 표시만 해 둔다(실제 역산은 다음 프레임 — 그때는 정렬이 이미 끝나 있다).
  // ref에 두는 이유: state로 두면 매 칩 이동마다 rAF 루프가 정리·재등록된다.
  const sweepResyncRef = useRef(true);
  useEffect(() => { sweepResyncRef.current = true; }, [currentColId, row, commitMarkColId]);
  // 🔴 WP-4 C3-① — 인라인 편집(칩 터치 → 수동 입력) 중에는 왕복을 멈춘다.
  useChipSweep(localGridRef, sweepSeconds, sweepResyncRef, editingColId != null);
  return (
    <div
      data-testid="voice-chip-grid"
      // 오라클 관측점 — 왕복이 켜졌는지를 DOM에서 읽는다(값은 편도 초, 꺼졌으면 'off').
      data-chip-sweep={sweepSeconds > 0 ? String(sweepSeconds) : 'off'}
      ref={setGridRef}
      style={{
        // 배정 트랙(v0.43.0 UI-b 기준 20%)을 꽉 채우고, 초과분은 가로 스크롤.
        height: '100%', minHeight: 0,
        // 칩 높이 = 트랙 안쪽 높이 전체(한 행). 44px 하한은 ColumnChip이 건다.
        ['--chip-row-h' as string]: '100%',
        // 🔴 칩의 cqh/cqw가 **이 트랙**을 기준으로 계산되게 한다. 칩 자신에 걸면 안 된다 —
        //    칩은 내용 기반 폭이라 size containment가 폭을 0으로 무너뜨린다.
        ['containerType' as string]: 'size',
        ['containerName' as string]: 'chipzone',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        // ⚠️ `scrollBehavior: 'smooth'`를 걸지 마라. `scrollLeft` 대입 직후 읽은 값이 **애니메이션
        //    중간값**이라 측정·복원이 틀어진다(프리뷰 단계에서 실제로 간헐 실패했다).
        position: 'relative',
        padding: `${CHIP_PAD_Y}px 12px`,
        display: 'flex',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
        gap: CHIP_GAP,
        borderBottom: `1px solid ${anomalyPending ? 'rgba(255,23,68,0.42)' : T.line}`,
        transition: 'border-color 180ms ease',
      }}
    >
      {columns.map((c) => {
        const isVoice = c.input === 'voice';
        const isTouch = c.input === 'touch';
        const value = isVoice || isTouch
          ? rowValues[c.id] ?? ''
          : nestedAutoValue(columns, c, row);
        const isActive = c.id === currentColId;
        const hasValue = rowValues[c.id] !== undefined && rowValues[c.id] !== '';
        return (
          <ColumnChip
            key={c.id}
            containerRef={isActive ? activeChipRef : undefined}
            col={c}
            value={value}
            isActive={isActive}
            activeTone={activeTone}
            isDone={(isVoice || isTouch) && hasValue}
            isEditing={editingColId === c.id}
            justCommitted={commitMarkColId != null && c.id === commitMarkColId}
            onActivate={() => onActivate(c)}
            onCommit={(newValue) => onCommit(c, newValue, value)}
            onCancel={onCancel}
          />
        );
      })}
    </div>
  );
}
