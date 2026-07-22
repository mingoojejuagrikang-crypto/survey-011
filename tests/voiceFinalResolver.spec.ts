/**
 * v0.35.3 Stage 3-2 — handleFinal 결정표(resolveFinal) 특성화 테스트 (Node, 서버 불필요).
 *
 * 기대값은 리팩토링 이전 handleFinal 인라인 분기의 판정을 그대로 옮긴 것 — 여기를 바꾸고 싶어지면
 * 음성 코어의 명령 우선순위 계약이 바뀐 것이다(중단·보고 신호).
 */
import { test, expect } from '@playwright/test';
import { resolveFinal } from '../src/lib/voiceFinalResolver';
import { detectCommand } from '../src/lib/koreanNum';
import { VOICE_COMMANDS, VOICE_UI_COMMAND_IDS } from '../src/lib/voiceCommands';

const base = { confidence: 0.95, paused: false, awaitingKind: 'value' as const };

test('paused — resume/end만 수용, 나머지(명령·값) 무시', () => {
  expect(resolveFinal({ ...base, paused: true, cmd: 'resume' })).toEqual({ act: 'pausedResume' });
  expect(resolveFinal({ ...base, paused: true, cmd: 'end' })).toEqual({ act: 'pausedEnd' });
  expect(resolveFinal({ ...base, paused: true, cmd: 'modify' })).toEqual({ act: 'pausedIgnore' });
  expect(resolveFinal({ ...base, paused: true, cmd: null })).toEqual({ act: 'pausedIgnore' });
});

test('명령 신뢰도 게이트(T-2) — 명령별 floor, 0은 미보고 센티널 통과', () => {
  // 기본 floor 0.7 (end 등)
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0.69 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.7 });
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0.7 }))
    .toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false });
  // T-12: modify는 0.55 완화 — 0.587 실기기 발화가 수용돼야 한다.
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.587 }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  // 정확 경계 0.55 = 수용(조건은 `< floor` — `<=`로 바뀌면 여기서 잡힌다, 리뷰 s3r2 Codex Low).
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.55 }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  expect(resolveFinal({ ...base, cmd: 'modify', confidence: 0.54 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.55 });
  // confidence 0 = 미보고 → 게이트 통과
  expect(resolveFinal({ ...base, cmd: 'end', confidence: 0 }))
    .toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false });
  // 값 발화(cmd 없음)는 이 게이트 대상 아님
  expect(resolveFinal({ ...base, cmd: null, confidence: 0.1 }))
    .toEqual({ act: 'value', trendCorrection: false });
});

test('trendConfirm 해소(B4) — 확인/유지=확정, 타 명령=강등 디스패치, 값=정정 폴스루', () => {
  const tc = { ...base, awaitingKind: 'trendConfirm' as const };
  expect(resolveFinal({ ...tc, cmd: 'confirm' })).toEqual({ act: 'trendResolve' });
  expect(resolveFinal({ ...tc, cmd: 'keep' })).toEqual({ act: 'trendResolve' });
  expect(resolveFinal({ ...tc, cmd: 'nextRow' }))
    .toEqual({ act: 'dispatch', cmd: 'nextRow', trendDemoted: true });
  expect(resolveFinal({ ...tc, cmd: null })).toEqual({ act: 'value', trendCorrection: true });
  // 신뢰도 게이트가 trendConfirm 해소보다 먼저다(종전 코드 순서).
  expect(resolveFinal({ ...tc, cmd: 'confirm', confidence: 0.5 }))
    .toEqual({ act: 'rejectLowConfidence', minConfidence: 0.7 });
});

/**
 * v0.38.0 리뷰#1(Codex High) — 이상치 대기 중 **화면 표시만 바꾸는 명령**은 알림을 소모하지 않는다.
 *
 * 결함: '확인'/'유지'가 아닌 **모든** 명령이 trendDemoted=true로 나가 useVoiceSession이
 * setAnomalyAlert(null)로 알림을 지웠다. 그래서 "도움말"이라고 말하면 **미확인 이상치 경고가
 * 사라졌다** — 같은 동작을 화면 버튼으로 누르면 알림이 유지되는데도. 음성/터치 불일치이자,
 * 사용자가 이상값을 확인·수정하지 않고 넘어갈 수 있는 데이터 무결성 문제다.
 */
test('[리뷰#1] trendConfirm 중 UI 전용 명령은 알림을 소모하지 않는다(터치 버튼과 동등)', () => {
  const tc = { ...base, awaitingKind: 'trendConfirm' as const };

  for (const cmd of VOICE_UI_COMMAND_IDS) {
    expect(resolveFinal({ ...tc, cmd }), `${cmd}는 알림을 유지해야 한다`)
      .toEqual({ act: 'dispatch', cmd, trendDemoted: false });
  }

  // 대조군 — 값·행을 움직이는 명령은 종전대로 알림을 해제하고 강등된다(회귀 방지).
  for (const cmd of ['nextRow', 'prevRow', 'modify', 'cancel', 'end'] as const) {
    expect(resolveFinal({ ...tc, cmd }), `${cmd}는 종전대로 강등돼야 한다`)
      .toEqual({ act: 'dispatch', cmd, trendDemoted: true });
  }

  // 이상치 대기가 아닐 때는 UI 명령도 종전과 동일(강등 개념 자체가 없다).
  expect(resolveFinal({ ...base, awaitingKind: 'value', cmd: 'help' }))
    .toEqual({ act: 'dispatch', cmd: 'help', trendDemoted: false });
});

test('센티넬 흡수 — atEnd/reviewWait의 일반 값 발화, 명령은 정상 디스패치', () => {
  expect(resolveFinal({ ...base, awaitingKind: 'atEnd', cmd: null })).toEqual({ act: 'absorbAtEnd' });
  expect(resolveFinal({ ...base, awaitingKind: 'reviewWait', cmd: null })).toEqual({ act: 'absorbReviewWait' });
  expect(resolveFinal({ ...base, awaitingKind: 'reviewWait', cmd: 'modify' }))
    .toEqual({ act: 'dispatch', cmd: 'modify', trendDemoted: false });
  expect(resolveFinal({ ...base, awaitingKind: 'atEnd', cmd: 'end' }))
    .toEqual({ act: 'dispatch', cmd: 'end', trendDemoted: false });
});

test('일반 값 대기 — 명령 없으면 값 경로', () => {
  expect(resolveFinal({ ...base, cmd: null })).toEqual({ act: 'value', trendCorrection: false });
  expect(resolveFinal({ ...base, awaitingKind: 'modify', cmd: null }))
    .toEqual({ act: 'value', trendCorrection: false });
});

test('v0.38.0 #4-③ — 가시 UI 명령은 매핑되고 숫자·단위 발화는 명령으로 오인되지 않는다', () => {
  const uiCommands = [
    ['도움말', 'help'],
    ['입력 조절', 'toggleInputControls'],
    ['인식률 낮추기', 'recognitionDown'],
    ['인식률 높이기', 'recognitionUp'],
    ['안내속도 느리게', 'guidanceSlower'],
    ['안내속도 빠르게', 'guidanceFaster'],
  ] as const;
  for (const [spoken, expected] of uiCommands) expect(detectCommand(spoken)).toBe(expected);

  for (const measurement of ['12', '12.3', '십이 점 삼', '12 밀리미터', '당도 15.2', '영 점 오']) {
    expect(detectCommand(measurement), `${measurement}는 측정값 발화`).toBeNull();
  }

  const normalizedWords = VOICE_COMMANDS.map((command) => command.word.replace(/\s+/g, ''));
  for (const word of normalizedWords) {
    expect(normalizedWords.filter((candidate) => candidate !== word && candidate.startsWith(word)), `${word} prefix 충돌`).toEqual([]);
  }
});
