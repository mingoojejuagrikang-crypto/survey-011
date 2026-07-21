import { T } from '../../tokens';
import { VOICE_COMMANDS } from '../../lib/voiceCommands';

/** I-1: 음성 명령어 전체 목록 팝업. voiceCommands.ts(SSOT)에서 동적 생성 — 기능당 단어 1개.
 *
 *  v0.26.0 화면잘림 대응(민구 07-03 제보 후보): 종전 타이포(pill 21px·설명 20px·gap 15)는 명령어
 *  10개가 90vh를 넘겨 마지막 항목이 화면 중간에서 끊겨 보였다 — 스크롤은 됐지만 스크롤 단서가 없어
 *  사용자에겐 "잘림"으로 보인다. ① 타이포를 압축해 402×874·375×812에서 전 항목이 한 화면에 들어오게
 *  하고, ② 하단 전폭 "닫기" 버튼을 추가한다 — 상단 ✕는 마이크 재연결 배너(role=alert)가 뜨면 가려져
 *  탭이 막히는 것을 스윕에서 실측(배너와 안 겹치는 하단 닫기가 장갑 손가락에도 더 크다). */
export function CommandHelpPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        // v0.37.0 리뷰 #4(Codex) — 모달 대역(≥55)으로 올려 TabBar(z-54) 위에 뜨게 한다. 종전 z-50은
        //   나비 아래라, 도움말 모달이 열린 채 탭을 누르면 모달을 닫지 않고 화면만 바뀌어
        //   onCommandHelpClose가 안 불려 STT가 suspend된 채 방치됐다(다른 모달 — ExitConfirmDialog·
        //   ManualValueSheet z-55와 동일 대역). 나비를 항상 덮는 유일 예외는 수동 입력 시트(bottomInset
        //   var(--nav-h)로 나비를 남김) — 그건 z-55여도 나비를 자르지 않게 별도 격리돼 있다.
        position: 'fixed', inset: 0, zIndex: 55,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // v0.33.0 safe-area — fixed 오버레이라 App 셸 패딩 밖. 노치/홈인디케이터 침범 방지
        //   (하단 닫기 버튼이 홈바에 잘리지 않게). Safari 탭에선 var(--sa*)=0 → 기존 12px 유지.
        paddingTop: 'max(12px, var(--sat))',
        paddingBottom: 'max(12px, var(--sab))',
        paddingLeft: 'max(12px, var(--sal))',
        paddingRight: 'max(12px, var(--sar))',
      }}
    >
      <div
        data-testid="command-help-popup"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 'min(600px, 96vw)', maxHeight: '90%',
          display: 'flex', flexDirection: 'column',
          background: T.card, borderRadius: 24, border: `1px solid ${T.lineStrong}`,
          padding: '20px 18px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: T.text }}>음성 명령어</div>
          <button
            onClick={onClose}
            style={{
              width: 40, height: 40, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: 20, cursor: 'pointer',
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 14, color: T.textMute, marginBottom: 12, lineHeight: 1.45 }}>
          <span style={{ color: T.amber, fontWeight: 800 }}>도움말 중 입력 정지</span>
          <br />
          명령은 아래 단어로 동작합니다.
        </div>
        {/* 목록만 스크롤 컨테이너 — 넘치는 기기(가로모드·텍스트 확대)에서도 하단 닫기 버튼은 항상 보인다. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {VOICE_COMMANDS.map((cmd) => (
            <div key={cmd.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
              <span
                style={{
                  flexShrink: 0, minWidth: 78, textAlign: 'center',
                  padding: '5px 12px', borderRadius: 999,
                  background: T.blueGlow, color: '#fff', fontSize: 16, fontWeight: 800,
                  // v0.22.0(P2 잘림 점검): 명령어 단어가 길어도 pill 안에서 줄바꿈(잘림 0).
                  whiteSpace: 'normal', wordBreak: 'keep-all', overflowWrap: 'anywhere',
                }}
              >
                {cmd.display}
              </span>
              {/* v0.22.0(P2 잘림 점검): 설명이 길어도 flex 자식이 부모를 넘기지 않게 minWidth:0 +
                  줄바꿈 보장. 잘림(ellipsis) 없음 — 전체 표시. */}
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, color: T.textDim, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{cmd.desc}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          data-testid="cmd-help-close"
          style={{
            marginTop: 14, flexShrink: 0, width: '100%', minHeight: 48,
            borderRadius: 14, border: `1px solid ${T.lineStrong}`,
            background: 'transparent', color: T.text, fontSize: 17, fontWeight: 800, cursor: 'pointer',
          }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
