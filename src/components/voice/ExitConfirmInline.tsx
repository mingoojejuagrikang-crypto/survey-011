import { T } from '../../tokens';

/** ui-standard §3-6 — 저장확인은 레이어가 아니라 중앙 track의 인라인 상태다.
 *  실제 취소/저장 행동은 하단 `ActiveControlBar`가 맡아 손의 위치 학습을 유지한다. */
export function ExitConfirmInline() {
  return (
    <div
      data-testid="exit-confirm-inline"
      role="status"
      aria-live="polite"
      aria-label="저장 후 종료합니다"
      style={{
        width: '100%', height: '100%', minHeight: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.text,
        fontSize: 38,
        fontWeight: 900,
        lineHeight: 1.15,
        letterSpacing: -0.8,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      저장 후 종료합니다
    </div>
  );
}
