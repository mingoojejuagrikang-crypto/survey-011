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
 * startsWith). Keep that invariant when editing this list — e.g. '다시'(redo) vs '다음행'(nextRow)
 * are safe because neither prefixes the other.
 */

export type VoiceCommand =
  | 'modify'
  | 'cancel'
  | 'redo'
  | 'skip'
  | 'prevRow'
  | 'nextRow'
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
}

export const VOICE_COMMANDS: CommandSpec[] = [
  { id: 'modify',  word: '수정',     display: '수정',     desc: '직전에 입력한 값을 고칩니다',      primary: true },
  { id: 'skip',    word: '스킵',     display: '스킵',     desc: '현재 행을 건너뜁니다',            primary: true },
  { id: 'prevRow', word: '이전행',   display: '이전행',   desc: '이전 행으로 이동해 값을 검토·수정합니다' },
  { id: 'nextRow', word: '다음행',   display: '다음행',   desc: '다음 행으로 이동합니다' },
  { id: 'cancel',  word: '취소',     display: '취소',     desc: '현재 인식된 값을 지웁니다' },
  { id: 'redo',    word: '다시',     display: '다시',     desc: '현재 항목을 다시 입력합니다' },
  { id: 'pause',   word: '일시정지', display: '일시정지', desc: '입력을 잠시 멈춥니다',            primary: true },
  { id: 'resume',  word: '재시작',   display: '재시작',   desc: '멈춘 입력을 다시 시작합니다',      primary: true },
  { id: 'end',     word: '종료',     display: '종료',     desc: '입력을 끝내고 저장합니다',        primary: true },
];

/** Commands shown in the compact on-screen hint row. */
export const PRIMARY_COMMANDS = VOICE_COMMANDS.filter((c) => c.primary);
