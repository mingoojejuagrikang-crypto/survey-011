/**
 * Voice command registry — the SINGLE SOURCE OF TRUTH for voice commands (I-1).
 *
 * Design (민구 결정: "완전 통일 — 단일 수용"): each function maps to exactly ONE accepted word.
 * Earlier the parser accepted several aliases per function (수정/정정, 스킵/건너/패스/다음, …); they
 * are removed so the app teaches — and the user learns — one word per action. detectCommand()
 * (koreanNum.ts), the on-screen hint chips, the help popup, and TTS prompts all read from here, so
 * the accepted word and the taught word can never drift apart.
 *
 * Robustness note: dropping aliases trades recognition breadth for teachability. Each canonical
 * `word` was chosen to be a distinct, STT-reliable token, and the help popup + TTS reinforce it.
 * `stt_command_miss` telemetry (handleFinal) records near-misses so the field data — not guesswork
 * — tells us whether any word needs a fallback later.
 *
 * IMPORTANT for matching: no canonical `word` may be a prefix of another (detectCommand uses
 * startsWith). Keep that invariant when editing this list — e.g. '이전'(prevRow) vs '다음'(nextRow)
 * are safe because neither prefixes the other. (사용자가 '이전행'/'다음행'으로 말해도 startsWith로
 * 동일하게 인식된다.)
 */

export type VoiceCommand =
  | 'modify'
  | 'cancel'
  | 'prevRow'
  | 'nextRow'
  | 'keep'
  | 'pause'
  | 'resume'
  | 'end'
  | 'confirm'
  | 'help'
  | 'toggleInputControls'
  | 'recognitionDown'
  | 'recognitionUp'
  | 'guidanceSlower'
  | 'guidanceFaster'
  | null;

/** 화면 표시만 바꾸는 명령들 — 값·행·세션 상태를 건드리지 않는다(도움말 열기, 조절판 토글,
 *  인식률/안내속도 조절). 같은 동작의 화면 버튼과 **완전히 동등**해야 한다.
 *
 *  v0.38.0 리뷰#1 — 이 목록이 타입으로만 존재해 런타임 판정이 불가능했고, 결국 dispatch switch에
 *  같은 6종이 **복붙**돼 있었다. 복붙된 판단이 이번 회차 결함들의 뿌리였으므로([PAST-2]) 배열을
 *  SSOT로 두고 타입을 여기서 파생시킨다 — 명령이 늘거나 줄면 이 배열 한 곳만 고친다. */
export const VOICE_UI_COMMAND_IDS = [
  'help',
  'toggleInputControls',
  'recognitionDown',
  'recognitionUp',
  'guidanceSlower',
  'guidanceFaster',
] as const;

export type VoiceUiCommand = (typeof VOICE_UI_COMMAND_IDS)[number];

/** 이 명령이 화면 표시만 바꾸는가(= 값·이상치 판정에 관여하지 않는가). */
export function isVoiceUiCommand(cmd: VoiceCommand): cmd is VoiceUiCommand {
  return cmd != null && (VOICE_UI_COMMAND_IDS as readonly string[]).includes(cmd);
}

export interface VoiceUiCommandSignal {
  id: VoiceUiCommand;
  seq: number;
}

export interface CommandSpec {
  id: Exclude<VoiceCommand, null>;
  /** The one accepted spoken word for this command. */
  word: string;
  /** Label shown in the help popup / hint chips (same as `word` today, kept separate for i18n). */
  display: string;
  /** One-line explanation shown in the help popup. */
  desc: string;
  /** Shown in the compact inline hint row (the full set lives in the help popup). */
  primary?: boolean;
  /**
   * Per-command STT confidence floor (handleFinal). Defaults to 0.7 when omitted — commands
   * rewind/destroy state, so they clear a higher bar than the value gate (0.65).
   * T-12: '수정'(modify) is the exception — it is recoverable (clip preserved, [CLIP-1]) and the
   * ~10s replay cost that justified the strict bar is already gone (re-ask is short), so a
   * false-reject costs ≈0 while a false-accept is recoverable. Real-device logs showed deliberate
   * '수정' utterances rejected at 0.587/0.634 (just under the bar); 0.55 admits those while staying
   * a comfortable margin above the noise cluster (max 0.313).
   */
  minConfidence?: number;
}

export const VOICE_COMMANDS: CommandSpec[] = [
  { id: 'modify',  word: '수정',     display: '수정',     desc: '직전에 입력한 값을 고칩니다',      primary: true, minConfidence: 0.55 },
  // v0.33.0 백로그 A(민구 결정 1·3): '이전' = 버튼과 동일한 단순 행 이동. 완료된 행에 착지하면
  // 기록값을 읽어주고 명령 대기(수정은 '수정' 명령으로만 — bare 값 덮어쓰기 없음).
  { id: 'prevRow', word: '이전',     display: '이전',     desc: '이전 행으로 이동합니다 (완료된 행은 값을 읽어주고 대기)' },
  { id: 'nextRow', word: '다음',     display: '다음',     desc: '다음 행으로 넘어갑니다 (입력 중이던 행은 빈 행으로 남아 데이터 탭에서 채울 수 있어요)', primary: true },
  { id: 'cancel',  word: '취소',     display: '취소',     desc: '현재 인식된 값을 지웁니다' },
  { id: 'keep',    word: '유지',     display: '유지',     desc: '현재 항목의 값을 그대로 두고 다음으로 넘어갑니다' },
  // v0.7.0 B4: 추세 검증 알림의 확인 응답("확인해주세요" → "확인"). 알림 상태 밖에서는 짧은
  // 재안내만 한다(useVoiceSession). prefix 불변식 검증: 기존 단어(수정·이전·다음·취소·유지·
  // 일시정지·재시작·종료) 어느 것과도 서로 prefix 관계가 아니다.
  { id: 'confirm', word: '확인',     display: '확인',     desc: '추세 알림에서 방금 입력한 값을 그대로 확정합니다' },
  { id: 'pause',   word: '일시정지', display: '일시정지', desc: '입력을 잠시 멈춥니다',            primary: true },
  { id: 'resume',  word: '재시작',   display: '재시작',   desc: '멈춘 입력을 다시 시작합니다',      primary: true },
  { id: 'end',     word: '종료',     display: '종료',     desc: '입력을 끝내고 저장합니다',        primary: true },
  // v0.38.0 #4-③ — 음성입력 중 보이는 비-네비 버튼의 누락 커버리지. 숫자·단위 발화와
  // 겹치지 않는 명시적 복합어만 허용한다. detectCommand가 공백을 제거하므로 word는 붙여 쓰고,
  // 사용자가 읽는 display는 자연스러운 띄어쓰기를 유지한다. 서로 완전-prefix 관계는 없다.
  { id: 'help',                word: '도움말',           display: '도움말',           desc: '음성 명령어 도움말을 엽니다' },
  { id: 'toggleInputControls', word: '입력조절',         display: '입력 조절',        desc: '허용 인식률과 안내속도 조절판을 열거나 닫습니다' },
  { id: 'recognitionDown',     word: '인식률낮추기',     display: '인식률 낮추기',    desc: '허용 인식률을 한 단계 낮춥니다' },
  { id: 'recognitionUp',       word: '인식률높이기',     display: '인식률 높이기',    desc: '허용 인식률을 한 단계 높입니다' },
  { id: 'guidanceSlower',      word: '안내속도느리게',   display: '안내속도 느리게',  desc: '음성 안내 속도를 한 단계 낮춥니다' },
  { id: 'guidanceFaster',      word: '안내속도빠르게',   display: '안내속도 빠르게',  desc: '음성 안내 속도를 한 단계 높입니다' },
];

/** Commands shown in the compact on-screen hint row. */
export const PRIMARY_COMMANDS = VOICE_COMMANDS.filter((c) => c.primary);

/** "수정 <컬럼명>" 발화에서 허용하는 조사 꼬리(닫힌 목록).
 *  ⚠️ '도'(역시)는 **의도적으로 제외** — '횡경도' 같은 실제 컬럼명과 구분이 불가능해, 허용하면
 *  '횡경'만 있는 설정에서 "수정 횡경도"가 '횡경'으로 오매치된다(v0.34.0 리뷰 Codex High).
 *  같은 이유로 임의 접미사(startsWith)는 허용하지 않는다 — 모르는 꼬리는 매치 실패로 떨어뜨린다. */
const MODIFY_COL_PARTICLES = ['으로', '로', '을', '를', '은', '는', '이', '가', '에', '의', '만'];

/** v0.34.0 A3 — "수정 <컬럼명>" 파서. 완료 행 검토 대기(reviewWait) 스코프에서 특정 컬럼을 지목해
 *  수정 진입할 때 쓴다("수정 초장" → '초장'). 규칙:
 *   - 정규화: 공백 전부 제거(STT가 '초장'을 '초 장'으로 쪼개는 변형 대응) 후 '수정' 전치/후치 제거.
 *   - 매칭(v0.34.0 리뷰 Codex High·agy 공통 — 오지목=시트 오염이므로 보수적으로):
 *     ① **완전 일치** 우선. ② 없으면 **컬럼명 + 허용 조사**(MODIFY_COL_PARTICLES)만 인정.
 *     임의 접미사는 불허 — '횡경'만 있을 때 "수정 횡경도"는 매치 실패(null)로 떨어진다.
 *   - **모호하면 거부(null)**: 같은 이름의 컬럼이 둘 이상이면(시트 중복 헤더 — sheets.ts는
 *     occurrence별 다른 id를 부여) 어느 쪽인지 결정할 수 없으므로 지목하지 않는다. 호출자가
 *     첫 동명 컬럼을 잡아 엉뚱한 셀을 지우던 경로를 차단.
 *   - **숫자값 추출(extractModifyValue)과 상호배타** — 호출자는 값 추출이 null일 때만 이 함수를
 *     시도한다(컬럼명이 숫자로 파싱될 일은 없지만, 우선순위를 값>컬럼명으로 고정하는 계약).
 *  reviewWait 밖에서는 호출하지 않는다(일반 수정 의미론 불변). */
export function extractModifyColumn(text: string, colNames: string[]): string | null {
  const norm = text.replace(/[\s.,]+/g, '');
  let rest: string | null = null;
  if (norm.startsWith('수정')) rest = norm.slice(2);
  else if (norm.endsWith('수정')) rest = norm.slice(0, -2);
  if (!rest) return null;
  const target = rest;
  const norms = colNames.map((name) => ({ name, n: name.replace(/\s+/g, '') })).filter((c) => c.n);
  // 동명 컬럼이 둘 이상이면 어느 것도 지목하지 않는다(모호 → 거부).
  const isDuplicated = (n: string) => norms.filter((c) => c.n === n).length > 1;

  // ① 완전 일치.
  const exact = norms.filter((c) => c.n === target);
  if (exact.length === 1) return exact[0].name;
  if (exact.length > 1) return null; // 중복 헤더 — 모호

  // ② 컬럼명 + 허용 조사. 후보가 여럿이면 가장 긴 컬럼명(접두 섀도잉 방지), 그래도 동명 중복이면 거부.
  let best: string | null = null;
  let bestLen = 0;
  for (const { name, n } of norms) {
    if (!target.startsWith(n)) continue;
    const tail = target.slice(n.length);
    if (!MODIFY_COL_PARTICLES.includes(tail)) continue; // 임의 접미사 불허
    if (n.length > bestLen) {
      best = isDuplicated(n) ? null : name;
      bestLen = n.length;
    }
  }
  return best;
}
