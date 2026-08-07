import { useEffect, useRef } from 'react';
import { T } from '../../tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { logger } from '../../lib/logger';
import { inputControlPanelOpened, settingChanged } from '../../lib/logEvents';
import { speak, setBargeInEnabled } from '../../lib/speech';
import {
  CHIP_SWEEP_LEVEL_MAX, chipSweepSecondsForLevel, chipSweepLevelForSeconds,
} from '../../lib/chipSweep';
import type { VoiceUiCommandSignal } from '../../lib/voiceCommands';
import { VOICE_TYPE } from './heroLayout';

/** v0.20.0 입력탭#1·#2 — 입력 컨트롤바: [인식 허용범위] · [안내 속도] 두 다이얼을 수평 배치.
 *  허용범위(recognitionTolerance) 0.40~0.90 → %로 표시. 속도(ttsRate) 0.5~2.0 → x로 표시·샘플 음성.
 *  두 다이얼은 375 폭에서도 한 줄에 들어가게 동일 flex(각 minWidth:0).
 *  v0.44.0 §D1 — 세 번째 항목 [말끊기 ON/OFF](BargeInToggle, 기본 ON)를 그 아래 전폭 1행으로
 *  추가(민구 확정 08-02: "바지인 기능 토글을 입력탭의 서랍메뉴에 포함"). 접힌 요약 필은 종전
 *  두 값만 유지한다 — 문자열이 길어지면 375 폭 오버레이 필이 줄바꿈돼 §C5-b 겹침 관례를 해친다. */
function clampStep(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export function ActiveControlSteppers({ uiCommand, open, canExpand, onOpenChange }: {
  uiCommand: VoiceUiCommandSignal | null;
  /** 확장 여부 — **부모가 소유**한다. 열려 있는 동안 하단 인디케이터·`<`·`>`를 숨겨야 하는데
   *  (fb-27-6 오탭 원인 제거), 그 판단이 이 컴포넌트 밖에서 필요하기 때문이다. */
  open: boolean;
  /** anomaly/paused에서는 확인·수정/재시작·종료가 필수이므로 조절판 재확장을 막는다. */
  canExpand: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const s = useSettingsStore();
  const ttsDebounceRef = useRef<number | null>(null);
  const sampleTts = (rate: number) => {
    if (ttsDebounceRef.current !== null) window.clearTimeout(ttsDebounceRef.current);
    ttsDebounceRef.current = window.setTimeout(() => {
      void speak('이 속도로 안내합니다.', { interrupt: true, rate });
      // v0.33.0 B-5 — ttsRate 스탭퍼 변경 로깅(이전엔 무로깅). 샘플 TTS와 같은 디바운스 창에서
      // 최종값만 1회 기록해 연타가 링버퍼(2000)를 잠식하지 않게 한다.
      logger.log({ type: 'app', extra: settingChanged('ttsRate', rate) });
    }, 350);
  };
  // v0.33.0 B-6 — recognitionTolerance 로깅 디바운스(이전엔 탭마다 즉시 로깅 → 연타 시 링버퍼 잠식).
  // ttsDebounceRef와 동일 패턴·동일 350ms 창, 최종값만 기록.
  const tolLogDebounceRef = useRef<number | null>(null);
  const setOpen = (
    updater: boolean | ((v: boolean) => boolean),
    source: 'touch' | 'voice',
  ) => {
    const next = typeof updater === 'function' ? updater(open) : updater;
    const allowedNext = canExpand ? next : false;
    if (allowedNext && !open) {
      logger.log({ type: 'app', extra: inputControlPanelOpened(source) });
    }
    onOpenChange(allowedNext);
  };
  const setTolerance = (next: number) => {
    const value = clampStep(next, 0.4, 0.9);
    s.set({ recognitionTolerance: value });
    if (tolLogDebounceRef.current !== null) window.clearTimeout(tolLogDebounceRef.current);
    tolLogDebounceRef.current = window.setTimeout(() => {
      logger.log({ type: 'app', extra: settingChanged('recognitionTolerance', value) });
    }, 350);
  };
  const setTtsRate = (next: number) => {
    const value = clampStep(next, 0.5, 2);
    s.set({ ttsRate: value });
    sampleTts(value);
  };
  // v0.44.0 §D1(민구 확정 08-02) — 말끊기(barge-in) 토글. 스토어 영속 + 라이브 speech 모듈
  // 동기화(TtsVoiceSelector의 setPreferredVoiceName 패턴). 토글은 연타 대상이 아니라서
  // 스텝퍼류 디바운스 없이 즉시 1회 로깅한다.
  const setBargeIn = (next: boolean) => {
    s.set({ bargeInEnabled: next });
    setBargeInEnabled(next);
    logger.log({ type: 'app', extra: settingChanged('bargeInEnabled', next) });
  };
  // 🔴 v0.46.0 WP-D(민구 R3 · 제보 F17) — **네 번째 서랍 항목: 칩 왕복**.
  //    민구 원문이 *"입력탭의 진행설정"* 이었고, 이 서랍이 그 자리다(08-05 확정 — 설정탭
  //    SessionOptionsSection이 아니다. 「진행설정」이라는 이름의 UI는 이 레포에 없었다).
  //    🔑 **왜 여기인가:** 이 값은 *"2~3m 떨어져서 읽히는가"* 가 판정 기준이라 **칩존을 보면서**
  //    맞춰야 한다. 설정탭에 두면 조사 중에 탭을 나갔다 와야 한다.
  //    값의 의미(편도 초·0=끔)와 상한은 src/lib/chipSweep.ts가 SSOT — 여기는 스텝퍼만.
  //    로깅은 ttsRate·recognitionTolerance와 같은 350ms 디바운스(연타가 링버퍼를 잠식하지 않게).
  const sweepLogDebounceRef = useRef<number | null>(null);
  // 🔴 v0.46.1 WP-4(민구 확정 08-07) — 스텝퍼는 이제 **단계 0~10**을 다룬다(초가 아니다).
  //    민구: *"0~10까지 설정 변경. 0은 정지, 10은 … 읽을 수 있는 가장 빠른 속도."*
  //    ⚠️ **단계가 클수록 빠르다**(직관과 반대) — 민구가 그렇게 정의했다. 변환은 chipSweep.ts가 SSOT.
  const setChipSweepLevel = (nextLevel: number) => {
    const level = Math.min(CHIP_SWEEP_LEVEL_MAX, Math.max(0, Math.round(nextLevel)));
    const value = chipSweepSecondsForLevel(level);
    s.set({ chipSweepSeconds: value });
    if (sweepLogDebounceRef.current !== null) window.clearTimeout(sweepLogDebounceRef.current);
    sweepLogDebounceRef.current = window.setTimeout(() => {
      logger.log({ type: 'app', extra: settingChanged('chipSweepSeconds', value) });
    }, 350);
  };
  const handledUiCommandSeqRef = useRef(0);
  useEffect(() => {
    if (!uiCommand || uiCommand.seq <= handledUiCommandSeqRef.current) return;
    handledUiCommandSeqRef.current = uiCommand.seq;
    const current = useSettingsStore.getState();
    switch (uiCommand.id) {
      case 'toggleInputControls': setOpen((v) => !v, 'voice'); break;
      case 'recognitionDown': setTolerance(current.recognitionTolerance - 0.05); break;
      case 'recognitionUp': setTolerance(current.recognitionTolerance + 0.05); break;
      case 'guidanceSlower': setTtsRate(current.ttsRate - 0.05); break;
      case 'guidanceFaster': setTtsRate(current.ttsRate + 0.05); break;
    }
    // 이벤트 seq가 유일한 실행 트리거다. 설정/로컬 상태 변경으로 같은 명령을 재실행하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiCommand?.seq]);
  const sweepLevel = chipSweepLevelForSeconds(s.chipSweepSeconds);
  const tolPct = Math.round(s.recognitionTolerance * 100);
  // v0.37.0 FB-K(민구) — 모호한 "입력 조절"·"인식"·"안내" 라벨을 뜻이 분명한 "허용 인식률"·
  //   "안내속도"로 교체(원거리·장갑 현장에서 무엇을 조절하는지 즉시 이해). 요약 접힘 버튼도
  //   포괄 라벨("입력 조절")을 제거하고 두 값만 나열한다.
  const summary = `허용 인식률 ${tolPct}% · 안내속도 ${s.ttsRate.toFixed(2)}x`;
  return (
    <div
      data-testid="input-control-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        /* 🔴 v0.46.0 FB-B(민구 제보 08-06 *"서랍에서 칩 자동 스크롤 속도 조절할 수 있는 메뉴가
         *  없다"*) — **펼친 패널이 배정 트랙보다 크면 부모의 `overflow:hidden`이 아래를 잘라낸다.**
         *  실측(402×812): 패널 **289px** vs `voice-control-bar` 트랙 **226px** → **63px 손실**,
         *  4번째 항목(칩 왕복, 행 높이 69px)이 거의 통째로 사라졌다. 375×667은 112px 손실.
         *
         *  ⚠️ **탭바가 덮은 게 아니다.** 컨트롤바 bottom과 탭바 top이 정확히 맞닿아 있다
         *  (실측 723=723 · 785=785 · 578=578). 그 `overflow:hidden`은 v0.43.0 UI-b의 **의도된
         *  방어**이고 제대로 동작했다 — 탭바를 침범하는 대신 자기 내용을 잘랐을 뿐이다.
         *  👉 그래서 처방은 「하단 여백」이 아니라 **트랙 안에서의 내부 스크롤**이다.
         *
         *  🔑 원인은 WP-D가 **서랍 항목을 3개 → 4개로 늘린 것**이다. 패널은 커졌고 트랙은 안 늘었다.
         *  트랙을 늘리는 길은 막혀 있다 — 그 비율은 `heroLayout.ts` zone 계약(WP-G 소유)이다.
         *
         *  ⚠️ **접힘 상태에는 걸지 않는다**(`open` 가드). 접힌 토글 49px은 `heroLayout.ts:124`가
         *  고정으로 쓰는 계약이라 flex 축을 건드리면 그 계산이 흔들린다. */
        ...(open ? { minHeight: 0, flex: '1 1 auto' } : null),
      }}
    >
      <button
        type="button"
        data-testid="input-control-toggle"
        aria-expanded={open}
        disabled={!canExpand}
        onClick={() => {
          // v0.33.0 B-7 — 입력 조절 패널 열림/닫힘 계측(ui_suspend/ui_resume의 command 컨벤션).
          // updater 밖에서 로깅(StrictMode의 updater 중복 호출로 이벤트가 2배로 찍히지 않게).
          logger.log({ type: 'command', parsed: open ? 'ui_close' : 'ui_open', extra: 'input_control_panel' });
          setOpen((v) => !v, 'touch');
        }}
        style={{
          minHeight: 42,
          borderRadius: 14,
          border: `1px solid ${T.lineStrong}`,
          background: T.card,
          color: T.textDim,
          fontSize: VOICE_TYPE.caption,
          fontWeight: 850,
          letterSpacing: -0.2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: canExpand ? 'pointer' : 'default',
          opacity: canExpand ? 1 : 0.6,
          touchAction: 'manipulation',
        }}
        title="허용 인식률·안내속도"
      >
        <span>{summary}</span>
        <span aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>⌄</span>
      </button>
      {open && (
        /* 🔴 v0.46.0 FB-B — 트랙이 모자라면 **여기서** 스크롤한다(패널 헤더 주석의 처방).
         *  · `minHeight:0` 없이 `flex:1 1 auto`만 주면 flex item의 `min-height:auto`가 축소를
         *    막아 종전과 똑같이 잘린다 — 이 레포가 이미 데인 함정이다(UI-a 함정 1의 사촌).
         *  · `overscrollBehavior:'contain'` — 서랍 끝에서 스크롤이 **뒤 화면으로 새지 않게** 한다.
         *    현장은 장갑 낀 손이라 관성 스크롤이 부모로 넘어가면 칩존이 딸려 움직인다.
         *  · 접힌 토글은 이 컨테이너 **밖**이라 항상 보인다(49px 계약 불변).
         *  ⚠️ 스크롤이 생겼다는 사실 자체는 **실기기 판정 대상**이다 — 2~3m 거리·장갑에서
         *    4번째 항목에 닿는 것이 실제로 편한지는 민구가 본다. 대안(ⓒ재배치·ⓓ요약필 승격)은
         *    `_ASK-wp-d.md` Q4에 그대로 있다. */
        <div
          data-testid="input-control-scroll"
          style={{
            minHeight: 0,
            flex: '1 1 auto',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StepperControl
            testId="stepper-tolerance"
            label="허용 인식률"
            value={`${tolPct}%`}
            detail="높을수록 엄격"
            accent={T.green}
            minusLabel="인식 기준 낮추기"
            plusLabel="인식 기준 높이기"
            canMinus={s.recognitionTolerance > 0.4}
            canPlus={s.recognitionTolerance < 0.9}
            onMinus={() => setTolerance(s.recognitionTolerance - 0.05)}
            onPlus={() => setTolerance(s.recognitionTolerance + 0.05)}
          />
          <StepperControl
            testId="stepper-tts-rate"
            label="안내속도"
            value={`${s.ttsRate.toFixed(2)}x`}
            detail="음성 속도"
            accent={T.blue}
            minusLabel="음성 안내 속도 낮추기"
            plusLabel="음성 안내 속도 높이기"
            canMinus={s.ttsRate > 0.5}
            canPlus={s.ttsRate < 2}
            onMinus={() => setTtsRate(s.ttsRate - 0.05)}
            onPlus={() => setTtsRate(s.ttsRate + 0.05)}
          />
          <BargeInToggle on={s.bargeInEnabled} onToggle={() => setBargeIn(!s.bargeInEnabled)} />
          {/* v0.46.0 WP-D — 말끊기와 같은 전폭 1행(375 폭에서 3항목 가로 배치는 48px 터치 타깃이
              나오지 않는다). ⚠️ 접힌 요약 필(summary)에는 **넣지 않는다** — 문자열이 길어지면
              375 폭 오버레이 필이 줄바꿈돼 §C5-b 겹침 관례를 해치고, heroLayout.ts:124가 고정으로
              쓰는 **접힌 토글 49px**(WP-G 소유 계약)이 흔들린다. 이 행은 **펼친 높이만** 늘린다. */}
          <StepperControl
            testId="stepper-chip-sweep"
            fullWidth
            label="칩 왕복"
            // 단계와 실제 편도 초를 **함께** 보여준다 — 민구가 실기기에서 튜닝할 때
            // "몇 단계가 몇 초인가"를 화면에서 바로 읽어야 한다.
            value={sweepLevel > 0 ? `${sweepLevel} (${s.chipSweepSeconds}초)` : '정지'}
            // 🔴 단계가 클수록 **빠르다**(민구 정의). 라벨이 이 방향을 명시해야 오조작이 없다.
            detail="0=정지 · 10=가장 빠름"
            accent={s.chipSweepSeconds > 0 ? T.text : T.textMute}
            minusLabel="칩 왕복 느리게(0이면 정지)"
            plusLabel="칩 왕복 빠르게"
            canMinus={sweepLevel > 0}
            canPlus={sweepLevel < CHIP_SWEEP_LEVEL_MAX}
            onMinus={() => setChipSweepLevel(sweepLevel - 1)}
            onPlus={() => setChipSweepLevel(sweepLevel + 1)}
          />
        </div>
        </div>
      )}
    </div>
  );
}

/** v0.44.0 §D1 — 세 번째 서랍 항목: 말끊기 ON/OFF(기본 ON). 두 스텝퍼 아래 전폭 1행
 *  (375 폭에서 3항목 가로 배치는 48px 터치 타깃이 안 나온다). 행 전체가 하나의 토글 버튼 —
 *  터치 타깃 = 행 전체(minHeight 56 ≥ 48). 시각 관례는 StepperControl을 따른다(테두리·배경·
 *  라벨/값/설명 3단 타이포). ON=현행 이어폰 barge-in(안내 중 말하면 즉시 끊고 인식),
 *  OFF=half-duplex(안내 중 인식 중지 — 스피커폰 에코 오인식 방지). */
function BargeInToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="toggle-barge-in"
      role="switch"
      aria-checked={on}
      aria-label={on ? '말끊기 끄기' : '말끊기 켜기'}
      title={on ? '말끊기 끄기' : '말끊기 켜기'}
      onClick={onToggle}
      style={{
        gridColumn: '1 / -1',
        minHeight: 56,
        borderRadius: 16,
        border: `1px solid ${T.lineStrong}`,
        background: 'rgba(255,255,255,0.035)',
        padding: 8,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 48px',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <span style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: VOICE_TYPE.captionXs, color: T.textMute, fontWeight: 800, lineHeight: 1 }}>말끊기</span>
        <span style={{ fontSize: VOICE_TYPE.stepperValue, color: on ? T.green : T.textMute, fontWeight: 950, lineHeight: 1.15 }}>
          {on ? '켬' : '끔'}
        </span>
        <span style={{ fontSize: VOICE_TYPE.captionXxs, color: T.textMute, fontWeight: 650, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
          {on ? '안내 중 말하면 즉시 인식' : '안내 중에는 인식 중지'}
        </span>
      </span>
      {/* 상태 심볼 — 스텝퍼의 48px 우측 버튼 자리와 정렬(시각 관례 유지). aria는 버튼 본체가 진다. */}
      <span
        aria-hidden
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          border: `1px solid ${on ? T.green : T.lineStrong}`,
          background: on ? T.greenGlowFaint : 'rgba(255,255,255,0.025)',
          color: on ? T.green : T.textMute,
          fontSize: VOICE_TYPE.stepperValueLg,
          fontWeight: 950,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on ? '✓' : '✕'}
      </span>
    </button>
  );
}

function StepperControl({
  testId, label, value, detail, accent, minusLabel, plusLabel, canMinus, canPlus, onMinus, onPlus,
  fullWidth = false,
}: {
  testId: string;
  label: string;
  value: string;
  detail: string;
  accent: string;
  minusLabel: string;
  plusLabel: string;
  canMinus: boolean;
  canPlus: boolean;
  onMinus: () => void;
  onPlus: () => void;
  /** v0.46.0 WP-D — 2열 그리드에서 한 행을 통째로 쓴다(BargeInToggle과 같은 관례). */
  fullWidth?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        ...(fullWidth ? { gridColumn: '1 / -1' } : null),
        minWidth: 0,
        borderRadius: 16,
        border: `1px solid ${T.lineStrong}`,
        background: 'rgba(255,255,255,0.035)',
        padding: 8,
        display: 'grid',
        gridTemplateColumns: '48px minmax(0, 1fr) 48px',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <StepperButton label="−" title={minusLabel} disabled={!canMinus} onClick={onMinus} testId={`${testId}-minus`} />
      <div style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: VOICE_TYPE.captionXs, color: T.textMute, fontWeight: 800, lineHeight: 1 }}>{label}</span>
        <span style={{ fontSize: VOICE_TYPE.stepperValue, color: accent, fontWeight: 950, lineHeight: 1.15, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {value}
        </span>
        <span style={{ fontSize: VOICE_TYPE.captionXxs, color: T.textMute, fontWeight: 650, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{detail}</span>
      </div>
      <StepperButton label="+" title={plusLabel} disabled={!canPlus} onClick={onPlus} testId={`${testId}-plus`} />
    </div>
  );
}

function StepperButton({
  label, title, disabled, onClick, testId,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        border: `1px solid ${T.lineStrong}`,
        background: disabled ? 'rgba(255,255,255,0.025)' : T.card,
        color: disabled ? T.textMute : T.text,
        fontSize: VOICE_TYPE.stepperValueLg,
        fontWeight: 950,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        touchAction: 'manipulation',
      }}
    >
      {label}
    </button>
  );
}
