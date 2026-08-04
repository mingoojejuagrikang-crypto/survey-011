import { T } from '../../tokens';
import { VOICE_TYPE } from './heroLayout';

/** ui-standard §3-6 — 저장확인은 레이어가 아니라 중앙 track의 인라인 상태다.
 *  실제 취소/저장 행동은 하단 `ActiveControlBar`가 맡아 손의 위치 학습을 유지한다.
 *
 *  v0.44.0 §C3(F21 "종료터치시 3줄안내") — 단일 문구를 3행으로 바꾼다:
 *  `완료행` / `17/18` / `✓ 터치시 저장하고 종료합니다`.
 *  종료를 누른 순간 사용자가 알아야 할 것은 "몇 행을 채웠고, 지금 누르면 저장된다"다 —
 *  종전 문구("저장 후 종료합니다")는 상태 없이 결과만 말해 몇 행이 저장되는지 안 보였다. */
export function ExitConfirmInline({
  completedCount, totalRows,
}: {
  completedCount: number;
  totalRows: number;
}) {
  return (
    <div
      data-testid="exit-confirm-inline"
      role="status"
      aria-live="polite"
      aria-label={`완료행 ${completedCount}/${totalRows}, 터치시 저장하고 종료합니다`}
      style={{
        width: '100%', height: '100%', minHeight: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'clamp(6px, 1.4vh, 14px)',
        textAlign: 'center',
        overflow: 'hidden',
      }}
    >
      <span
        data-testid="exit-confirm-rows-label"
        style={{
          color: T.textDim,
          fontSize: VOICE_TYPE.exitConfirmLabel,
          fontWeight: 850,
          lineHeight: 1.15,
          letterSpacing: -0.3,
        }}
      >
        완료행
      </span>
      <span
        data-testid="exit-confirm-rows"
        style={{
          color: T.text,
          fontSize: VOICE_TYPE.exitConfirmTitle,
          fontWeight: 900,
          lineHeight: 1.1,
          letterSpacing: -0.8,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {completedCount}/{totalRows}
      </span>
      <span
        data-testid="exit-confirm-hint"
        style={{
          display: 'inline-flex', alignItems: 'baseline', gap: '0.3em',
          color: T.textDim,
          fontSize: VOICE_TYPE.exitConfirmLabel,
          fontWeight: 850,
          lineHeight: 1.15,
          letterSpacing: -0.3,
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden style={{ color: T.green }}>✓</span>
        터치시 저장하고 종료합니다
      </span>
    </div>
  );
}
