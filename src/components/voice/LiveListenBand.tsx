import { useEffect, useState } from 'react';
import { T } from '../../tokens';
import { VoiceWaveform } from './VoiceWaveform';
import type { GlowTone } from './EdgeGlow';

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 입력탭 **상시 파형 밴드**(hero 아래 독립 grid row).
 *  파형은 입력 세션 동안 항상 존재한다 — 확인/경고/일시정지/수정 어느 카드가 떠도 사라지지 않는다
 *  (§6.2 "waveform이 곧 '듣는 중' 상태 문구를 대체"). v0.38.0부터 뷰포트별 60~100px 높이를
 *  상태 변화와 관계없이 예약하고, 레퍼런스의 13개 세로 막대를 기존 밴드 폭의 70% 안에 배치한다.
 *
 *  상태 연동: 색은 EdgeGlow와 같은 톤(green/red/amber — tone SSOT는 VoiceScreen), paused에선
 *  active=false → rAF 중지 + 주황 평선(§5.3). 미확정 임시값(interim)은 v0.36.0부터 hero가 크게
 *  표시한다(FB#2 — 종전의 이 밴드 내 작은 칩 표시를 대체). 데이터는 기존 getter만 소비. */
const TONE_COLOR: Record<GlowTone, string> = { green: T.green, amber: T.amber, red: T.red };

export function LiveListenBand({
  active, tone, getAudioLevel, getTimeDomainData,
}: {
  /** 듣는 중(phase active·비일시정지·비완료)이면 true — 파형이 실시간으로 움직인다. */
  active: boolean;
  /** 상태 톤(VoiceScreen SSOT) — 파형 색이 엣지글로우와 함께 상태를 말한다. */
  tone: GlowTone;
  getAudioLevel: () => number;
  getTimeDomainData: (out: Uint8Array) => boolean;
}) {
  const height = useBandHeight();
  return (
    <div
      data-testid="live-listen-band"
      style={{
        flex: 'none',
        width: '100%',
        height,
        minHeight: height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 20px',
      }}
    >
      <div style={{ width: '70%', maxWidth: 315, minWidth: 0 }}>
        <VoiceWaveform
          active={active}
          getLevel={getAudioLevel}
          getTimeDomainData={getTimeDomainData}
          height={height}
          color={TONE_COLOR[tone]}
        />
      </div>
    </div>
  );
}

/** 짧은 화면의 중앙 카드 공간을 보존하면서, 같은 뷰포트 안에서는 모든 상태가 같은 높이를 쓴다. */
function useBandHeight(): number {
  const calc = () => Math.round(Math.min(100, Math.max(60, window.innerHeight * 0.105)));
  const [height, setHeight] = useState(calc);
  useEffect(() => {
    const onResize = () => setHeight(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}
