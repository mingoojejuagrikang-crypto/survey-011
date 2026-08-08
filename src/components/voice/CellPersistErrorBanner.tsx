import { T } from '../../tokens';
import { I } from '../icons';
import { VOICE_TYPE } from './heroLayout';

/** v0.47.0 C-FIX2b(2차 재검증, major) — **셀 저장 실패** 배너(PersistErrorBanner의 셀 스코프 변형).
 *
 *  언제 뜨나: 수동/터치 셀 커밋의 IDB 쓰기(saveSession)가 실패한 경우(useVoiceSession의
 *  persistCellValue → notifyCellPersistFailed → cellPersistError.arm). 경고음·TTS는 순간이라
 *  놓칠 수 있다 — PRINCIPLES §1 「실패는 화면에 남기고 재시도 경로를 제공한다」의 화면 절반이
 *  이 배너다.
 *
 *  왜 stop 배너(PersistErrorBanner)를 재사용하지 않나: 문구("종료되지 않음")와 재시도 의미론
 *  (retryFinalPersist → 성공 시 세션 종료)이 stop 전용이다 — 근거는 cellPersistError.ts 머리 주석.
 *  시각 계약(red 모달·큰 타이포·60px 터치 타깃·a11y)은 그 배너와 동일하게 따른다 — 저장 실패는
 *  측정값 유실 위험이고, 배경을 계속 만지다 값이 더 꼬이는 것보다 저장을 먼저 끝내게 막는 편이
 *  데이터 무결성에 맞다(그 배너의 확립된 판단 계보).
 *
 *  수동 시트가 저장 결과 전에 닫히는 축(ActiveState): 시트가 닫혀도 이 배너가 남아 실패를
 *  전달하므로 수용 — 판단 근거는 산출물 리뷰 대응 절.
 */
export function CellPersistErrorBanner({
  colName,
  value,
  retrying,
  onRetry,
}: {
  /** 실패한 셀의 항목명(시트 불특정 — 이름은 표시 전용, 키는 store의 colId). */
  colName: string;
  value: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cell-persist-error-title"
      aria-describedby="cell-persist-error-desc"
      data-testid="cell-persist-error-banner"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        padding: 'max(16px, var(--sat)) max(16px, var(--sar)) max(16px, var(--sab)) max(16px, var(--sal))',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 520,
          display: 'flex', flexDirection: 'column', gap: 14,
          padding: '20px 18px', borderRadius: 18,
          background: 'rgba(34,18,18,0.98)', border: `2px solid ${T.red}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flexShrink: 0, display: 'flex' }} aria-hidden>{I.cloudOff(26, T.red)}</span>
          <span
            id="cell-persist-error-title"
            style={{
              fontSize: VOICE_TYPE.bannerTitle, fontWeight: 900, color: T.red, letterSpacing: -0.3,
              lineHeight: 1.25, wordBreak: 'keep-all', overflowWrap: 'anywhere',
            }}
          >
            저장 실패 — 값이 저장되지 않음
          </span>
        </div>
        <p
          id="cell-persist-error-desc"
          style={{
            margin: 0, fontSize: VOICE_TYPE.bodyText, lineHeight: 1.55, color: T.text,
            wordBreak: 'keep-all', overflowWrap: 'anywhere',
          }}
        >
          방금 입력한 <b>{colName} {value}</b> 값을 기기에 저장하지 못했습니다.
          저장에 성공해야 이 값이 남습니다. 저장 공간이 부족하면 공간을 확보한 뒤 다시 저장하세요.
        </p>
        <button
          type="button"
          autoFocus
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          data-testid="cell-persist-retry-btn"
          style={{
            minHeight: 60, borderRadius: 14, border: 'none',
            cursor: retrying ? 'wait' : 'pointer',
            background: retrying ? '#7a2e2e' : T.red, color: '#fff',
            opacity: retrying ? 0.85 : 1,
            fontSize: VOICE_TYPE.bannerAction, fontWeight: 900, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: retrying ? 'none' : '0 4px 14px rgba(255,23,68,0.4)',
          }}
          title={retrying ? '저장 중…' : '다시 저장'}
        >
          {retrying ? '저장 중…' : '다시 저장'}
        </button>
      </div>
    </div>
  );
}
