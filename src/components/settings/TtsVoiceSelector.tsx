import { useEffect, useState } from 'react';
import { T } from '../../tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { getKoreanVoices, refreshVoices, setPreferredVoiceName, speak, warmupTts } from '../../lib/speech';

export function TtsVoiceSelector() {
  const s = useSettingsStore();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // ko-voice count observed by the LAST manual refresh — null until the button is used.
  // Drives the "iOS 플랫폼 제약" notice: only after the user explicitly refreshed and the
  // list is still thin do we surface the platform-limitation explanation.
  const [lastRefreshKo, setLastRefreshKo] = useState<number | null>(null);

  useEffect(() => {
    // v0.5.0 W1: re-poll getVoices() on mount AND whenever the app returns to foreground —
    // iOS Safari materializes newly-downloaded voices lazily, often only after the app
    // regains visibility (user installs a voice in 설정 → switches back to the PWA).
    const refresh = () => {
      refreshVoices();
      setVoices(getKoreanVoices());
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Sync preferred voice name into the speech module whenever it changes
  useEffect(() => {
    setPreferredVoiceName(s.preferredVoiceName);
  }, [s.preferredVoiceName]);

  // 음성 새로고침: warmupTts()는 사용자 제스처 안에서 엔진을 깨워 iOS가 음성 목록을
  // 채우도록 자극한다 → 300ms 뒤 재조회. (즉답이 아닌 이유: getVoices()가 warmup 직후
  // 비동기로 채워지는 iOS 동작 보호.)
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      warmupTts();
      await new Promise((r) => setTimeout(r, 300));
      const { ko } = refreshVoices();
      setVoices(getKoreanVoices());
      setLastRefreshKo(ko);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>안내 음성</div>
        <select
          value={s.preferredVoiceName}
          onChange={(e) => {
            const name = e.target.value;
            s.set({ preferredVoiceName: name });
            setPreferredVoiceName(name);
            speak('안녕하세요, 이 음성으로 안내합니다.', { interrupt: true, rate: 1.05 });
          }}
          disabled={voices.length === 0}
          style={{
            flex: 1, maxWidth: 220, height: 36, borderRadius: 8,
            background: T.inputBg, border: `1px solid ${T.line}`,
            color: T.text, fontSize: 13, fontWeight: 600,
            padding: '0 8px', outline: 'none',
          }}
        >
          <option value="">(기본)</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>{v.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div
          aria-live="polite"
          style={{ fontSize: 12, fontWeight: 700, color: lastRefreshKo !== null ? T.text : T.textDim }}
        >
          {lastRefreshKo !== null
            ? `새로고침 완료 — 한국어 음성 ${lastRefreshKo}개 감지`
            : `한국어 음성 ${voices.length}개 감지`}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          style={{
            height: 36, padding: '0 14px', borderRadius: 8,
            background: T.inputBg, border: `1px solid ${T.lineStrong}`,
            color: T.text, fontSize: 13, fontWeight: 700,
            cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? '확인 중…' : '음성 새로고침'}
        </button>
      </div>
      {lastRefreshKo !== null && lastRefreshKo <= 1 && (
        <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.5 }}>
          iOS는 기본 내장 음성만 웹 앱에 제공합니다. 설정에서 추가로 내려받은 고품질·Siri 음성은
          Apple 정책상 여기 표시되지 않습니다 — 새로고침을 반복해도 목록에 나타나지 않습니다.
        </div>
      )}
      <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
        iPhone <b>설정 → 손쉬운 사용 → 음성 콘텐츠 → 음성 → 한국어</b>에서 <b>기본 음성</b>을
        선택하면 안내가 또렷해질 수 있습니다. 단, 고품질(Enhanced/Premium)·Siri 음성은 웹 앱에
        제공되지 않으므로 위 목록에는 기본 내장 음성만 나타납니다.
      </div>
    </div>
  );
}

/** v0.33.0 항목10-C(Vance) — 비프음 선택. 긍정(값 수용)/부정(이상치 알람) 각 5칩, 탭 = 미리듣기 +
 *  선택(민구 확정). 칩은 aria-pressed 토글(옵션 순번 칩 접근성 패턴), 44px 터치 타깃(장갑). */
