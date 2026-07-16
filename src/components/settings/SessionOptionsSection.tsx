import { T } from '../../tokens';
import { useSettingsStore } from '../../stores/settingsStore';
import { buildSessionLabel, pickSessionLabelValue } from '../../lib/sessionLabel';
import { logger } from '../../lib/logger';
import { settingChanged } from '../../lib/logEvents';
import { BeepPicker } from './BeepPicker';
import { TtsVoiceSelector } from './TtsVoiceSelector';

/** v0.35.2 Stage 2 — 설정탭 세션 옵션 섹션: 세션명 컬럼 선택/자유입력/미리보기 + 빠른 인식 토글 +
 *  자동 캡처 토글 + 비프음 선택 + TTS 음성 선택. SettingsScreen에서 순수 이동(DOM 불변).
 *  세션명 미리보기 계산(prospectiveSessionLabel)은 useSettingsActions 소유 — prop으로 받는다. */
export function SessionOptionsSection({ prospectiveSessionLabel }: { prospectiveSessionLabel: () => string }) {
  const s = useSettingsStore();
  return (
    <>
        {/* 세션 옵션: 세션명 컬럼 선택 + 소음 환경 모드 */}
        <div
          style={{
            marginTop: 14, padding: '0 16px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <div
            style={{
              background: T.card, borderRadius: 14, padding: 12,
              border: `1px solid ${T.line}`,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10,
              }}
            >
              {/* v0.22.0 — 이 select는 세션명에 쓸 *항목(컬럼)*을 고른다. 자유입력 세션명과 구분해
                  라벨을 "세션명 항목"으로 명확히 한다(아래 텍스트칸이 실제 세션명). */}
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                세션명 항목
              </div>
              <select
                value={s.sessionLabelColId ?? ''}
                onChange={(e) => {
                  const newColId = e.target.value || null;
                  const isoDate = new Date().toISOString().slice(0, 10);
                  const custom = (s.sessionCustomLabel ?? '').trim();
                  const pickedCol = newColId ? s.columns.find((c) => c.id === newColId) : null;
                  // v0.22.0 — 효과 라벨 = 자유입력 우선, 없으면 (선택 항목값 또는 상수 join).
                  const autoLabel = pickedCol
                    ? (() => { const v = pickSessionLabelValue(s.columns, pickedCol); return v ? `${isoDate} ${v}` : isoDate; })()
                    : buildSessionLabel(s.columns, { isoDate });
                  s.set({
                    sessionLabelColId: newColId,
                    sessionAutoLabel: custom || autoLabel,
                  });
                }}
                style={{
                  flex: 1, maxWidth: 200, height: 36, borderRadius: 8,
                  background: T.inputBg, border: `1px solid ${T.line}`,
                  color: T.text, fontSize: 14, fontWeight: 600,
                  padding: '0 8px', outline: 'none',
                }}
              >
                <option value="">(자동 선택)</option>
                {s.columns
                  .filter(
                    (c) =>
                      c.input === 'auto' &&
                      ((c.auto.kind === 'fixed' && c.auto.value && c.auto.value !== '오늘') ||
                        (c.auto.kind === 'options' && c.auto.selected.length >= 1)),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            {/* v0.22.0 — 자유입력 세션명(민구 채택). 입력값이 있으면 자동 라벨보다 우선해 세션명이 된다.
                비우면 자동(생성일 + 상수들)으로 폴백. 입력칸 16px·44px 터치 타깃·줄바꿈 불필요. */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}
            >
              <label htmlFor="session-custom-label" style={{ fontSize: 13, fontWeight: 700, color: T.textDim, flexShrink: 0 }}>
                세션명
              </label>
              <input
                id="session-custom-label"
                type="text"
                value={s.sessionCustomLabel ?? ''}
                placeholder="비우면 자동(생성일 + 항목)"
                onChange={(e) => {
                  const raw = e.target.value;
                  const custom = raw.trim();
                  const isoDate = new Date().toISOString().slice(0, 10);
                  const pickedCol = s.sessionLabelColId
                    ? s.columns.find((c) => c.id === s.sessionLabelColId)
                    : null;
                  const autoLabel = pickedCol
                    ? (() => { const v = pickSessionLabelValue(s.columns, pickedCol); return v ? `${isoDate} ${v}` : isoDate; })()
                    : buildSessionLabel(s.columns, { isoDate });
                  s.set({
                    sessionCustomLabel: raw === '' ? null : raw,
                    sessionAutoLabel: custom || autoLabel,
                  });
                }}
                style={{
                  flex: 1, minWidth: 0, maxWidth: 200, height: 44, borderRadius: 8,
                  background: T.inputBg, border: `1px solid ${T.line}`,
                  color: T.text, fontSize: 16, fontWeight: 600,
                  padding: '0 10px', outline: 'none', textAlign: 'right',
                }}
              />
            </div>
            {/* v0.22.0 — 미리보기는 *효과* 라벨(자유입력 있으면 그것, 없으면 자동 디폴트)을 보여준다.
                store의 sessionAutoLabel은 위 핸들러가 효과 라벨로 유지하지만, 아직 한 번도 편집하지
                않은 초기 상태(null)에서도 디폴트가 보이도록 prospectiveSessionLabel()로 직접 계산한다. */}
            <div style={{ fontSize: 12, color: T.textMute }}>
              세션명 미리보기: <span style={{ color: T.text, fontWeight: 700 }}>{prospectiveSessionLabel()}</span>
            </div>
            {/* v0.19.0 W4-UI — "소음 환경 모드" 토글 UI 제거(민구 결정). store의 noisyMode 필드는
                Mack이 별도로 제거한다(여기선 JSX·참조만 삭제). 아래 "빠른 인식 (실험)" 토글은 보존. */}

            {/* v0.15.0 A6 — 스피커폰 모드 토글 삭제(민구 요청 + Trace 회귀신호 0). 모드로 게이트되던
                가드(TTS-중 명령차단·post-TTS 잔향 폐기·신뢰도 상향)도 함께 제거 — 이어폰 barge-in 기본. */}

            {/* v0.9.0 — 빠른 인식(조기확정) 실험 토글. 기본 OFF(미완성 숫자 절단 리스크). */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, marginTop: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                빠른 인식 (실험)
              </div>
              <button
                onClick={() => {
                  const next = !s.fastRecognition;
                  s.set({ fastRecognition: next });
                  logger.log({ type: 'app', extra: settingChanged('fastRecognition', next) });
                }}
                style={{
                  width: 60, height: 32, borderRadius: 16,
                  background: s.fastRecognition ? T.blue : '#2A2D32',
                  border: 'none', cursor: 'pointer',
                  position: 'relative',
                }}
                title="안내까지의 딜레이를 줄이려 중간 인식이 안정되면 곧바로 확정합니다(실험)"
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4, left: s.fastRecognition ? 32 : 4,
                    width: 24, height: 24, borderRadius: 12,
                    background: '#fff',
                    transition: 'left 150ms ease',
                  }}
                />
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
              음성을 멈춘 뒤 인식 확정까지의 대기(딜레이)를 줄입니다. 중간 인식이 잠깐 안정되면 바로
              확정하므로 소수점을 늦게 말하면 잘릴 수 있습니다. 실험 기능이라 기본은 꺼져 있습니다.
            </div>

            {/* v0.33.0 항목10-B — 입력화면 자동 캡처 토글(기본 on, 민구 확정). 트리거/가드/저장은
                src/lib/screenshot.ts가 SSOT — 여기는 스위치만. 빠른 인식 토글 패턴 재사용. */}
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, marginTop: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                입력화면 자동 캡처
              </div>
              <button
                data-testid="auto-capture-toggle"
                aria-pressed={s.autoScreenCapture}
                onClick={() => {
                  const next = !s.autoScreenCapture;
                  s.set({ autoScreenCapture: next });
                  logger.log({ type: 'app', extra: settingChanged('autoScreenCapture', next) });
                }}
                style={{
                  width: 60, height: 32, borderRadius: 16,
                  background: s.autoScreenCapture ? T.blue : '#2A2D32',
                  border: 'none', cursor: 'pointer',
                  position: 'relative',
                }}
                title="음성 입력에 앱이 반응하는 순간의 화면을 저화질로 저장해 로그와 함께 남깁니다"
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4, left: s.autoScreenCapture ? 32 : 4,
                    width: 24, height: 24, borderRadius: 12,
                    background: '#fff',
                    transition: 'left 150ms ease',
                  }}
                />
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
              값 저장·알람·재질문 같은 순간의 화면을 저화질 사진으로 남겨 음성 로그와 함께 백업합니다.
              세션당 최대 100장, 2초에 1장 이하로만 저장돼 측정을 느리게 하지 않습니다.
            </div>

            {/* v0.33.0 항목10-C — 비프음 선택(긍정/부정 각 5종 중 1, 민구 확정). 탭 = 미리듣기 + 선택.
                세그먼트 스펙은 beepVariants.ts, 재생 해석(kind→극성→변형)은 beep.ts가 SSOT. */}
            <BeepPicker />

            {/* v0.8.0 — 추세 검증 전역 마스터 토글 제거(이상치 알람은 컬럼별 규칙 유무로 활성).
                조사시기(회차) 컬럼 선택은 조회탭으로 이전(WS4) — roundDateColId 필드는 유지. */}

            <TtsVoiceSelector />

          </div>
        </div>
    </>
  );
}
