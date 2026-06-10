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
  | null;

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
  { id: 'prevRow', word: '이전',     display: '이전',     desc: '이전 행으로 이동해 값을 검토·수정합니다' },
  { id: 'nextRow', word: '다음',     display: '다음',     desc: '다음 행으로 넘어갑니다 (입력 중이던 행은 빈 행으로 남아 데이터 탭에서 채울 수 있어요)', primary: true },
  { id: 'cancel',  word: '취소',     display: '취소',     desc: '현재 인식된 값을 지웁니다' },
  { id: 'keep',    word: '유지',     display: '유지',     desc: '현재 항목의 값을 그대로 두고 다음으로 넘어갑니다' },
  { id: 'pause',   word: '일시정지', display: '일시정지', desc: '입력을 잠시 멈춥니다',            primary: true },
  { id: 'resume',  word: '재시작',   display: '재시작',   desc: '멈춘 입력을 다시 시작합니다',      primary: true },
  { id: 'end',     word: '종료',     display: '종료',     desc: '입력을 끝내고 저장합니다',        primary: true },
];

/** Commands shown in the compact on-screen hint row. */
export const PRIMARY_COMMANDS = VOICE_COMMANDS.filter((c) => c.primary);
