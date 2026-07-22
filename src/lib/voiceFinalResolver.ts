/**
 * v0.35.3 Stage 3-2 — handleFinal 결정표(순수). 최종 인식 결과 1건이 어느 경로로 가는지를
 * (명령, 신뢰도, 세션 phase, 대기 모드)만으로 판정한다. 부수효과 없음 — 실행(액션 해석)은
 * useVoiceSession.handleFinal이 담당하고, 이 표는 tests/voiceFinalResolver.spec.ts가
 * 특성화로 고정한다(종전 handleFinal 인라인 분기와 판정 동일).
 *
 * 판정 순서(종전 코드 순서 그대로 — 순서가 곧 우선순위 계약):
 *  1. paused면 resume/end만 수용, 나머지 무시(v0.15.0 A5 — resume은 신뢰도 게이트도 안 탄다:
 *     일시정지 탈출의 유일한 경로라 의도적 비게이트).
 *  2. 명령 신뢰도 게이트(T-2): 명령별 floor(레지스트리 SSOT, 기본 0.7) 미달이면 재질문.
 *     confidence 0은 "미보고" 센티널 — 통과.
 *  3. trendConfirm 해소(v0.7.0 B4): '확인'/'유지'=확정·진행, 타 명령=알림 해제 후 명령 디스패치
 *     (수정 의미론 'modify'로 강등), 명령 아님=값 경로 폴스루(정정 재커밋).
 *     **단 화면 표시만 바꾸는 UI 명령은 알림을 해제하지 않는다**(v0.38.0 리뷰#1) — 같은 동작의
 *     화면 버튼은 알림을 유지하는데 음성만 해제하면 음성/터치가 어긋나고, 무엇보다 사용자가
 *     이상치를 **확인하지 않은 채** 다음으로 넘어갈 수 있다(데이터 무결성).
 *  4. 명령 디스패치.
 *  5. atEnd/reviewWait 센티넬은 일반 값 발화를 흡수(안내만).
 *  6. 값 경로.
 */
import { VOICE_COMMANDS, isVoiceUiCommand, type VoiceCommand } from './voiceCommands';

export type AwaitingKind = 'value' | 'modify' | 'trendConfirm' | 'atEnd' | 'reviewWait';

export type FinalAction =
  | { act: 'pausedResume' }
  | { act: 'pausedEnd' }
  | { act: 'pausedIgnore' }
  | { act: 'rejectLowConfidence'; minConfidence: number }
  | { act: 'trendResolve' }
  | { act: 'dispatch'; cmd: Exclude<VoiceCommand, null>; trendDemoted: boolean }
  | { act: 'absorbAtEnd' }
  | { act: 'absorbReviewWait' }
  | { act: 'value'; trendCorrection: boolean };

export function resolveFinal(input: {
  cmd: VoiceCommand;
  confidence: number;
  paused: boolean;
  awaitingKind: AwaitingKind;
}): FinalAction {
  const { cmd, confidence, paused, awaitingKind } = input;

  if (paused) {
    if (cmd === 'resume') return { act: 'pausedResume' };
    if (cmd === 'end') return { act: 'pausedEnd' };
    return { act: 'pausedIgnore' };
  }

  const minConfidence = VOICE_COMMANDS.find((c) => c.id === cmd)?.minConfidence ?? 0.7;
  if (cmd && confidence > 0 && confidence < minConfidence) {
    return { act: 'rejectLowConfidence', minConfidence };
  }

  if (awaitingKind === 'trendConfirm') {
    if (cmd === 'confirm' || cmd === 'keep') return { act: 'trendResolve' };
    // v0.38.0 리뷰#1 — 화면 표시만 바꾸는 명령(도움말·조절판·인식률·안내속도)은 이상치 판단과
    // 무관하므로 알림을 소모하지 않는다. 같은 동작의 화면 버튼과 동등해야 한다.
    if (isVoiceUiCommand(cmd)) return { act: 'dispatch', cmd, trendDemoted: false };
    if (cmd) return { act: 'dispatch', cmd, trendDemoted: true };
    return { act: 'value', trendCorrection: true };
  }

  if (cmd) return { act: 'dispatch', cmd, trendDemoted: false };
  if (awaitingKind === 'atEnd') return { act: 'absorbAtEnd' };
  if (awaitingKind === 'reviewWait') return { act: 'absorbReviewWait' };
  return { act: 'value', trendCorrection: false };
}
