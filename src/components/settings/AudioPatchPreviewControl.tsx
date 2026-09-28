import { useSyncExternalStore } from 'react';
import { T } from '../../tokens';
import {
  audioPatchAvailable, audioSessionTypeSupported, getAudioPatchSelection,
  selectAudioPatch, subscribeAudioPatchSelection,
} from '../../lib/ios27AudioPatch';
import { useSessionStore, isSessionLive } from '../../stores/sessionStore';

/** Preview-only, memory-only selector. The running session always keeps its start snapshot. */
export function AudioPatchPreviewControl() {
  const selection = useSyncExternalStore(subscribeAudioPatchSelection, getAudioPatchSelection);
  const phase = useSessionStore((s) => s.phase);
  if (!audioPatchAvailable()) return null;
  const supported = audioSessionTypeSupported();
  const nextSession = isSessionLive(phase);
  return (
    <section data-testid="audio-patch-controls" style={{ padding: 12, border: `1px solid ${T.lineStrong}`, borderRadius: 14, background: T.card }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>iOS 27 음성 실험</div>
      <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>선택은 저장되지 않습니다. {nextSession ? '변경은 다음 세션부터 적용됩니다.' : '세션 시작 때 적용됩니다.'}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, color: supported ? T.text : T.textMute, marginTop: 8 }}>
        <input type="checkbox" data-testid="audio-session-play-and-record" checked={supported && selection.playAndRecord}
          disabled={!supported} onChange={(e) => selectAudioPatch({ playAndRecord: e.target.checked })}
          style={{ width: 24, height: 24 }} />
        오디오 세션: 녹음+재생{supported ? '' : ' (미지원)'}
      </label>
    </section>
  );
}
