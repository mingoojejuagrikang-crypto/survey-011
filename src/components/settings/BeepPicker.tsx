import { T } from '../../tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { previewBeep } from '../../lib/beep';
import { BEEP_VARIANTS, type BeepPolarity } from '../../lib/beepVariants';
import { logger } from '../../lib/logger';

export function BeepPicker() {
  const s = useSettingsStore();
  const rows: { polarity: BeepPolarity; label: string; selectedId: string; storeKey: 'beepPositiveId' | 'beepNegativeId' }[] = [
    { polarity: 'positive', label: '확인음 (값 저장)', selectedId: s.beepPositiveId, storeKey: 'beepPositiveId' },
    { polarity: 'negative', label: '경고음 (이상치)', selectedId: s.beepNegativeId, storeKey: 'beepNegativeId' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }} data-testid="beep-picker">
      {rows.map((row) => (
        <div key={row.polarity} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>{row.label}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {BEEP_VARIANTS.filter((v) => v.polarity === row.polarity).map((v) => {
              const active = row.selectedId === v.id;
              return (
                <button
                  key={v.id}
                  data-testid={`beep-chip-${v.id}`}
                  aria-pressed={active}
                  aria-label={`${row.label} ${v.label}${active ? ' (선택됨)' : ''}`}
                  onClick={() => {
                    previewBeep(v); // 탭 = 즉시 미리듣기(사용자 제스처 안 — AudioContext resume 안전)
                    if (!active) {
                      s.set({ [row.storeKey]: v.id } as Partial<{ beepPositiveId: string; beepNegativeId: string }>);
                      logger.log({ type: 'app', extra: `beep_changed:${row.polarity}=${v.id}` });
                    }
                  }}
                  style={{
                    minHeight: 44, padding: '0 14px', borderRadius: 12,
                    border: `1px solid ${active ? T.blue : T.lineStrong}`,
                    background: active ? 'rgba(41,121,255,0.14)' : T.inputBg,
                    color: active ? T.blue : T.textDim,
                    fontSize: 14, fontWeight: active ? 800 : 600,
                    cursor: 'pointer', letterSpacing: -0.1,
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {/* v0.35.0 FB-D(Vance) — 확인음·경고음 마스터 볼륨 슬라이더. 슬라이더는 store만 갱신(드래그
          중 비프 폭주 방지), '미리듣기'가 현재 볼륨으로 확인음→경고음을 순서로 들려준다(긍/부정 대비).
          범위를 넓게 열어(0~100%) 민구가 실기기에서 STT 오트리거 없이 조절하게 한다. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label htmlFor="beep-volume" style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
            소리 크기
          </label>
          <span style={{ fontSize: 13, fontWeight: 800, color: T.blue }}>{Math.round(s.beepVolume * 100)}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="beep-volume"
            data-testid="beep-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.beepVolume}
            aria-label="확인음·경고음 소리 크기"
            onChange={(e) => s.set({ beepVolume: Number(e.target.value) })}
            style={{ flex: 1, minWidth: 0, height: 44, accentColor: T.blue, cursor: 'pointer' }}
          />
          <button
            data-testid="beep-volume-preview"
            aria-label="현재 소리 크기로 미리듣기"
            onClick={() => {
              const vol = s.beepVolume;
              const pos = BEEP_VARIANTS.find((x) => x.id === s.beepPositiveId && x.polarity === 'positive')
                ?? BEEP_VARIANTS.find((x) => x.polarity === 'positive')!;
              const neg = BEEP_VARIANTS.find((x) => x.id === s.beepNegativeId && x.polarity === 'negative')
                ?? BEEP_VARIANTS.find((x) => x.polarity === 'negative')!;
              previewBeep(pos, vol);
              window.setTimeout(() => previewBeep(neg, vol), 480);
            }}
            style={{
              flexShrink: 0, minHeight: 44, padding: '0 14px', borderRadius: 12,
              border: `1px solid ${T.lineStrong}`, background: T.inputBg,
              color: T.text, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: -0.1,
            }}
          >
            미리듣기
          </button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
        칩을 누르면 소리를 미리 들려주고 그 소리로 선택됩니다. 확인음은 값이 저장될 때,
        경고음은 이상치 알람이 뜰 때 울립니다. 소리 크기는 확인음·경고음에 함께 적용됩니다.
      </div>
    </div>
  );
}

/** S-2: result popup for "타입 검토" — lists columns whose saved type ≠ sheet's data type. */
