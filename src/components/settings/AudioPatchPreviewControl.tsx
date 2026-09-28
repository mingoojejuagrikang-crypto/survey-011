import { useSyncExternalStore } from 'react';
import { T } from '../../tokens';
import {
  audioPatchAvailable, audioSessionTypeSupported, getAudioPatchSelection,
  selectAudioPatch, subscribeAudioPatchSelection, type AudioPatchMode,
} from '../../lib/ios27AudioPatch';
import { useSessionStore, isSessionLive } from '../../stores/sessionStore';

/** Preview-only, memory-only selector. The running session always keeps its start snapshot. */
export function AudioPatchPreviewControl() {
  const selection = useSyncExternalStore(subscribeAudioPatchSelection, getAudioPatchSelection);
  const phase = useSessionStore((s) => s.phase);
  if (!audioPatchAvailable()) return null;
  const supported = audioSessionTypeSupported();
  const nextSession = isSessionLive(phase);
  const options: { mode: AudioPatchMode; label: string }[] = [
    { mode: 'default', label: '기본' },
    { mode: 'a', label: 'A 무응답 복구' },
    { mode: 'b', label: 'B 지연 재시작' },
  ];
  return (
    <section data-testid="audio-patch-controls" style={{ padding: 12, border: `1px solid ${T.lineStrong}`, borderRadius: 14, background: T.card }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>iOS 27 음성 실험</div>
      <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>선택은 저장되지 않습니다. {nextSession ? '변경은 다음 세션부터 적용됩니다.' : '세션 시작 때 적용됩니다.'}</div>
      <div role="group" aria-label="음성 실험 모드" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {options.map(({ mode, label }) => (
          <button key={mode} type="button" data-testid={`audio-patch-${mode}`} aria-pressed={selection.mode === mode}
            onClick={() => selectAudioPatch({ mode, playAndRecord: selection.playAndRecord })}
            style={{ minHeight: 44, padding: '0 10px', borderRadius: 9, border: `1px solid ${selection.mode === mode ? T.blue : T.lineStrong}`,
              background: selection.mode === mode ? T.blue : T.cardAlt, color: T.text, fontWeight: 700, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, color: supported ? T.text : T.textMute, marginTop: 8 }}>
        <input type="checkbox" data-testid="audio-session-play-and-record" checked={supported && selection.playAndRecord}
          disabled={!supported} onChange={(e) => selectAudioPatch({ mode: selection.mode, playAndRecord: e.target.checked })}
          style={{ width: 24, height: 24 }} />
        오디오 세션: 녹음+재생{supported ? '' : ' (미지원)'}
      </label>
    </section>
  );
}
