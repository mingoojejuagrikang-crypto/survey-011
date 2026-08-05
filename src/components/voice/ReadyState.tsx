import { useEffect } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { isSpeechSupported } from '../../lib/speech';
import { ConnectionStatusCard } from '../ConnectionStatusCard';
import { isSheetSourceBlocked } from '../../lib/sheetConnection';
import { VOICE_TYPE } from './heroLayout';
import { emitReadyProbe } from './readyProbe';

export function ReadyState({ totalRows, onStart }: { totalRows: number; onStart: () => void }) {
  const s = useSettingsStore();
  // v0.45.0 WP-1① — 시작 전 입·출력 상태 프로브(F15 근원 판정용). 스로틀·계약은 readyProbe.ts.
  useEffect(() => { emitReadyProbe(); }, []);
  const sourceBlocked = isSheetSourceBlocked(s);
  const ready = s.tableGenerated && !sourceBlocked && totalRows > 0 && isSpeechSupported();
  const autoCount = s.columns.filter((c) => c.input === 'auto').length;
  const voiceCount = s.columns.filter((c) => c.input === 'voice').length;
  const ttsHint = !isSpeechSupported()
    ? '이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 권장)'
    : sourceBlocked
    ? '시트 연결을 다시 확인해 주세요'
    : !s.tableGenerated
    ? '먼저 설정 탭에서 테이블을 생성하세요'
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* v0.19.0 W1 — 상단 큰 탭 타이틀("음성 입력") 제거(하단 TabBar 하이라이트와 중복).
          단 ttsHint(기능 안내: 미지원 브라우저 / 테이블 미생성)는 삭제하지 않고 본문 상단
          경고 배너로 이전한다 — 순수 탭 이름만 사라지고 기능 안내는 보존. */}
      <div
        style={{
          // 🔴 `minHeight: 0`이 없으면 flex 자식의 `min-height: auto`가 콘텐츠 자연 높이를
          //    하한으로 잡아 컨테이너가 수축을 거부한다 — 짧은 뷰포트에서 시작 버튼이 아래로
          //    밀려 TabBar에 가려지고 **클릭 자체가 불가능**해진다.
          //    §B1이 셸을 실제 뷰포트에 맞추면서 발현 조건이 노출됐다(B1 산출물 §4).
          //    🔑 B1 산출물은 이걸 "640×600 = 작은 데스크톱 창, 실기기엔 없음"으로 우선순위를
          //    낮췄으나 **틀렸다** — 390×568(실기기 폰 크기, PortraitGuard에 안 걸린다)에서도
          //    재현된다. §C1 probe가 실측으로 반증했다(2026-08-03).
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', gap: 28,
        }}
      >
        {ttsHint && (
          <div
            role="alert"
            style={{
              width: '100%', maxWidth: 320,
              padding: '12px 16px', borderRadius: 12,
              background: 'rgba(255,234,0,0.10)', border: `1px solid ${T.amber}`,
              color: T.amber, fontSize: VOICE_TYPE.bodySm, fontWeight: 600,
              lineHeight: 1.5, letterSpacing: -0.1, textAlign: 'center',
            }}
          >
            {ttsHint}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              width: 168, height: 168, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.06), rgba(255,255,255,0.02) 70%, transparent)',
              border: `1px solid ${T.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.micFilled(76, '#3A3E45')}
          </div>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute', inset: -16 - i * 12, borderRadius: '50%',
                border: `1px solid rgba(255,255,255,${0.05 - i * 0.02})`,
              }}
            />
          ))}
        </div>

        <div
          style={{
            background: T.card, border: `1px solid ${T.line}`, borderRadius: 14,
            padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 12,
            width: '100%', maxWidth: 320,
          }}
        >
          <SummaryRow label="오늘 테이블" value={totalRows} unit="행" />
          <SummaryRow label="자동입력 항목" value={autoCount} unit="개" />
          <SummaryRow label="음성입력 항목" value={voiceCount} unit="개" accent />
        </div>

        {/* v0.33.0 항목5 — 세션 시작 전 연결 3상태(Google/시트/과거값). 07-13 §4처럼 토큰이 만료된
            채 시작해 알람이 침묵하는 상황을 시작 카드에서 미리 보이게 한다(설정탭과 공용 컴포넌트). */}
        <div style={{ width: '100%', maxWidth: 320 }}>
          <ConnectionStatusCard />
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button
          disabled={!ready}
          onClick={onStart}
          style={{
            width: '100%', height: 60, borderRadius: 28, border: 'none',
            background: ready ? T.blue : '#2A2D32',
            color: ready ? '#fff' : T.textMute,
            fontSize: VOICE_TYPE.actionLabel, fontWeight: 800, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            cursor: ready ? 'pointer' : 'not-allowed',
            boxShadow: ready ? `0 8px 28px ${T.blueGlow}` : 'none',
          }}
        >
          {I.mic(22, ready ? '#fff' : T.textMute)} 음성 입력 시작
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, unit, accent }: { label: string; value: number; unit?: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontSize: VOICE_TYPE.bodySm, color: T.textDim, fontWeight: 600, letterSpacing: -0.1 }}>{label}</span>
      <span
        style={{
          fontSize: VOICE_TYPE.readyValue, fontWeight: 800,
          color: accent ? T.blue : T.text,
          letterSpacing: -0.6,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        }}
      >
        {value}
        {unit && <span style={{ fontSize: VOICE_TYPE.captionSm, color: T.textDim, fontWeight: 500, marginLeft: 4 }}>{unit}</span>}
      </span>
    </div>
  );
}

// ─── A-hero helpers (v0.17.0) ─────────────────────────────────
// 입력 화면 타이포 계약은 components/voice/heroLayout에서 공유한다. v0.34.0 A4 이후
// ReadyState 자체는 hero 숫자 크기를 소유하지 않는다.
