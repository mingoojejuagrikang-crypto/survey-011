import { useSyncExternalStore } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import { clipPlayer } from '../../lib/clipPlayer';

/** v0.33.0 #9 — 클립 재생 전용 셀(44px 컬럼). 값 셀(EditableCell)에서 재생 버튼을 분리해
 *  오터치를 구조적으로 없앤다. 터치 타깃은 44×44 이상(장갑·한 손 계약). 재생 상태 색·title·
 *  aria-label 규약은 기존(v0.13.0 R4) 그대로 승계 — clipPlayer.toggle 내부의 clip_play 계측도
 *  경로 불변. 클립 없는 행은 빈 자리만 유지해 컬럼 정렬을 지킨다. */
export function ClipCell({ clipKey, value }: { clipKey?: string; value: string }) {
  const clipState = useSyncExternalStore(
    clipPlayer.subscribe,
    () => (clipKey ? clipPlayer.stateOf(clipKey) : 'idle'),
  );
  return (
    <div
      data-testid="clip-cell"
      style={{
        width: 44, flexShrink: 0, minHeight: 44,
        borderRight: `1px solid ${T.line}`,
        display: 'flex', alignItems: 'stretch',
      }}
    >
      {clipKey && (
        <button
          onClick={() => clipPlayer.toggle(clipKey)}
          data-testid="clip-cell-button"
          // v0.13.0 R4 — 클립이 부자연/판독불가여도 어떤 값을 말한 클립인지 화면으로 확정할 수 있게
          // 재생 버튼 title에 인식값을 함께 노출.
          title={
            clipState === 'playing' ? '정지'
            : clipState === 'queued' ? '대기 중 (탭하면 취소)'
            : value ? `음성 재생: ${value}` : '음성 재생'
          }
          aria-label={value ? `음성 재생: ${value}` : '음성 재생'}
          style={{
            flex: 1, minWidth: 44, minHeight: 44, padding: 0,
            background: 'transparent', border: 'none',
            color: clipState === 'playing' ? T.amber : clipState === 'queued' ? T.textMute : T.blue,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {clipState === 'playing' ? I.stop(14, T.amber) : I.play(14, clipState === 'queued' ? T.textMute : T.blue)}
        </button>
      )}
    </div>
  );
}
