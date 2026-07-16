import { useState } from 'react';
import { T } from '../../tokens';
import { ModalBase } from '../ModalBase';

function ResetOptionRow({ checked, onToggle, label, testid }: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  testid: string;
}) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
        padding: '0 12px', borderRadius: 12, cursor: 'pointer',
        background: checked ? 'rgba(255,82,82,0.10)' : T.inputBg,
        border: `1px solid ${checked ? 'rgba(255,82,82,0.45)' : T.line}`,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        data-testid={testid}
        style={{ width: 18, height: 18, accentColor: T.red, flexShrink: 0, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 14, fontWeight: 700, color: checked ? T.red : T.text, lineHeight: 1.4 }}>
        {label}
      </span>
    </label>
  );
}

/** v0.32.0 B3 — 초기화 확인 모달. 무엇이 초기화되고 무엇이 보존되는지 명시한 뒤 실행.
 *  기본: Google 로그인·시트 URL·저장된 시트 **보존**(민구 확정) — 체크박스로만 opt-in 삭제.
 *  버튼 문구는 '생성' 부분문자열 금지(hasText:'생성' .last() 헬퍼 보호) — 초기화 실행/취소는 안전. */
export function SettingsResetModal({ onCancel, onConfirm }: {
  onCancel: () => void;
  onConfirm: (opts: { clearLogin: boolean; clearSheets: boolean }) => void;
}) {
  const [clearLogin, setClearLogin] = useState(false);
  const [clearSheets, setClearSheets] = useState(false);
  return (
    <ModalBase
      onClose={onCancel}
      testid="settings-reset-modal"
      role="dialog"
      ariaModal
      ariaLabel="설정 초기화"
      blur
      animation="fade-up 200ms ease-out"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 480, maxHeight: '84vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>설정 초기화</div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 2 }}>
            설정탭의 구성을 기본값으로 되돌립니다
          </div>
        </div>

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              padding: '10px 12px', borderRadius: 12,
              background: 'rgba(255,82,82,0.06)', border: '1px solid rgba(255,82,82,0.25)',
              fontSize: 13, color: T.text, lineHeight: 1.6, wordBreak: 'keep-all',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: T.red, marginBottom: 4 }}>
              기본값으로 되돌아감
            </div>
            컬럼 구성 → 기본 10항목 · 행수 50 · 세션명 설정 · 빠른 인식 OFF ·
            인식 허용범위 60% · 안내 속도 1.05x · 음성·검토 옵션 · 생성 상태 해제
          </div>
          <div
            style={{
              padding: '10px 12px', borderRadius: 12,
              background: 'rgba(0,200,83,0.06)', border: '1px solid rgba(0,200,83,0.25)',
              fontSize: 13, color: T.text, lineHeight: 1.6, wordBreak: 'keep-all',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: T.green, marginBottom: 4 }}>
              그대로 유지됨
            </div>
            Google 로그인 · 시트 URL·저장된 시트 (아래에서 함께 삭제 선택 가능) —
            세션 데이터·클립·로그는 영향 없음
          </div>
          <ResetOptionRow
            checked={clearLogin}
            onToggle={() => setClearLogin((v) => !v)}
            label="Google 로그인도 해제"
            testid="settings-reset-clear-login"
          />
          <ResetOptionRow
            checked={clearSheets}
            onToggle={() => setClearSheets((v) => !v)}
            label="시트 URL·저장된 시트도 삭제"
            testid="settings-reset-clear-sheets"
          />
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}`, display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            autoFocus
            style={{
              flex: 1, height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={() => onConfirm({ clearLogin, clearSheets })}
            data-testid="settings-reset-confirm"
            style={{
              flex: 2, height: 48, borderRadius: 14, border: 'none',
              background: T.red, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(255,82,82,0.32)',
            }}
          >
            초기화 실행
          </button>
        </div>
      </div>
    </ModalBase>
  );
}
