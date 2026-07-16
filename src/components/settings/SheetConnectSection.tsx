import type { Dispatch, SetStateAction } from 'react';
import { T } from '../../tokens';
import { I, AuthMark } from '../icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { parseSpreadsheetId } from '../../lib/sheets';
import { ConnectionStatusCard } from '../ConnectionStatusCard';

/** v0.35.2 Stage 2 — 설정탭 Section 1: Google 로그인 + 시트 URL/Drive 선택/저장목록/탭 선택 +
 *  연결 3상태 카드. SettingsScreen에서 순수 이동(DOM 불변) — 상태·핸들러는 useSettingsActions가
 *  소유하고 prop으로 받는다(GL-006 §7 표현 전용). */
export function SheetConnectSection({
  loading, error, confirmedUrl, showUrlInput, setShowUrlInput,
  savedSheetsOpen, setSavedSheetsOpen, pickerAvailable,
  onGoogleClick, onUrlTyping, onUrlConfirm, onPickerClick, onSelectSavedSheet, onSheetTabChange,
}: {
  loading: string | null;
  error: string | null;
  confirmedUrl: string;
  showUrlInput: boolean;
  setShowUrlInput: Dispatch<SetStateAction<boolean>>;
  savedSheetsOpen: boolean;
  setSavedSheetsOpen: Dispatch<SetStateAction<boolean>>;
  pickerAvailable: boolean;
  onGoogleClick: () => Promise<void>;
  onUrlTyping: (url: string) => void;
  onUrlConfirm: () => Promise<void>;
  onPickerClick: () => Promise<void>;
  onSelectSavedSheet: (entry: { url: string }) => Promise<void>;
  onSheetTabChange: (newTab: string) => Promise<void>;
}) {
  const s = useSettingsStore();
  return (
    <>
        {/* Section 1 - Google + Sheet URL */}
        <div style={{ padding: '0 16px', flexShrink: 0 }}>
          <div
            style={{
              background: T.card, borderRadius: 16, padding: 14,
              border: `1px solid ${T.line}`,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <button
              onClick={onGoogleClick}
              disabled={loading !== null}
              style={{
                height: 56, borderRadius: 14,
                border: `1px solid ${s.googleConnected ? 'rgba(0,200,83,0.35)' : T.lineStrong}`,
                background: s.googleConnected ? 'rgba(0,200,83,0.10)' : '#2A2D32',
                color: T.text, fontSize: 17, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                cursor: loading ? 'wait' : 'pointer', letterSpacing: -0.2,
                opacity: loading ? 0.7 : 1,
              }}
            >
              <AuthMark s={22} />
              {s.googleConnected ? (
                <>
                  연결됨 · <span style={{ color: T.textDim, fontWeight: 500 }}>{s.userEmail}</span>
                </>
              ) : (
                <>Google 로그인</>
              )}
              {s.googleConnected && I.check(20, T.green)}
            </button>

            {pickerAvailable ? (
              /* Drive Picker를 주 동작으로 승격 */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={onPickerClick}
                  disabled={loading !== null}
                  style={{
                    height: 52, borderRadius: 12, border: 'none',
                    background: T.blue, color: '#fff',
                    fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    cursor: loading ? 'wait' : 'pointer',
                    boxShadow: `0 4px 14px ${T.blueGlow}`,
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {I.link(16, '#fff')} Drive에서 시트 선택
                </button>
                {s.sheetUrl && (
                  <div
                    style={{
                      fontSize: 12, color: T.textMute, padding: '0 4px',
                      wordBreak: 'break-all', lineHeight: 1.4,
                    }}
                  >
                    {confirmedUrl && s.sheetUrl === confirmedUrl
                      ? <span style={{ color: T.green }}>{I.check(12, T.green)} 연결됨 · </span>
                      : null}
                    <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>
                      {s.sheetUrl.replace(/^https?:\/\//, '').slice(0, 60)}{s.sheetUrl.length > 60 ? '…' : ''}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setShowUrlInput((v) => !v)}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'transparent', border: 'none',
                    color: T.textMute, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', textDecoration: 'underline', padding: 0,
                  }}
                >
                  {showUrlInput ? '▲ URL 직접 입력 숨기기' : '▼ URL 직접 입력'}
                </button>
                {showUrlInput && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div
                      style={{
                        flex: 1, height: 52, borderRadius: 12,
                        background: T.inputBg, border: `1px solid ${T.line}`,
                        display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
                        minWidth: 0,
                      }}
                    >
                      <div style={{ color: T.textMute }}>{I.link(18)}</div>
                      <input
                        value={s.sheetUrl}
                        onChange={(e) => onUrlTyping(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onUrlConfirm(); }}
                        placeholder="스프레드시트 URL 붙여넣기"
                        style={{
                          flex: 1, background: 'transparent', border: 'none', outline: 'none',
                          fontSize: 15, color: T.text, minWidth: 0,
                        }}
                      />
                    </div>
                    {(() => {
                      const applied = s.sheetUrl.trim() === confirmedUrl.trim() && s.availableSheets.length > 0;
                      const canConfirm = !!s.sheetUrl.trim() && !applied && !loading;
                      return (
                        <button
                          onClick={onUrlConfirm}
                          disabled={!canConfirm && !applied}
                          style={{
                            height: 52, padding: '0 16px', borderRadius: 12,
                            border: 'none',
                            background: applied ? 'rgba(0,200,83,0.18)' : canConfirm ? T.blue : '#2A2D32',
                            color: applied ? T.green : canConfirm ? '#fff' : T.textMute,
                            fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                            cursor: canConfirm ? 'pointer' : 'default',
                            display: 'flex', alignItems: 'center', gap: 6,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {applied ? <>{I.check(16, T.green)} 적용됨</> : '확인'}
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              /* Picker 미사용 — 기존 URL 입력 방식 */
              <div style={{ display: 'flex', gap: 8 }}>
                <div
                  style={{
                    flex: 1, height: 52, borderRadius: 12,
                    background: T.inputBg, border: `1px solid ${T.line}`,
                    display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
                    minWidth: 0,
                  }}
                >
                  <div style={{ color: T.textMute }}>{I.link(18)}</div>
                  <input
                    value={s.sheetUrl}
                    onChange={(e) => onUrlTyping(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onUrlConfirm(); }}
                    placeholder="스프레드시트 URL 붙여넣기"
                    style={{
                      flex: 1, background: 'transparent', border: 'none', outline: 'none',
                      fontSize: 15, color: T.text, minWidth: 0,
                    }}
                  />
                </div>
                {(() => {
                  const applied = s.sheetUrl.trim() === confirmedUrl.trim() && s.availableSheets.length > 0;
                  const canConfirm = !!s.sheetUrl.trim() && !applied && !loading;
                  return (
                    <button
                      onClick={onUrlConfirm}
                      disabled={!canConfirm && !applied}
                      style={{
                        height: 52, padding: '0 16px', borderRadius: 12,
                        border: 'none',
                        background: applied ? 'rgba(0,200,83,0.18)' : canConfirm ? T.blue : '#2A2D32',
                        color: applied ? T.green : canConfirm ? '#fff' : T.textMute,
                        fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
                        cursor: canConfirm ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', gap: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {applied ? <>{I.check(16, T.green)} 적용됨</> : '확인'}
                    </button>
                  );
                })()}
              </div>
            )}

            {/* v0.13.0 R1 — 저장된 시트 목록(파일명). 한 번 연결한 시트는 자동 저장되어, 토큰 만료로
                연결이 풀려도 매번 공유링크를 다시 붙여넣지 않고 여기서 한 번에 다시 선택할 수 있다. */}
            {s.savedSheets.length > 0 && (() => {
              const activeSheetId = parseSpreadsheetId(s.sheetUrl);
              const activeName = s.savedSheets.find((x) => x.sheetId === activeSheetId)?.name ?? null;
              return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* v0.14.0 F — 기본 접힌 드롭다운 헤더. 접힌 상태로도 '사용 중' 시트명을 보여줘 식별
                    가능하고, 탭하면 전체 목록(선택/삭제)이 펼쳐진다. 시트가 많아도 화면 점유 최소. */}
                <button
                  onClick={() => setSavedSheetsOpen((v) => !v)}
                  aria-expanded={savedSheetsOpen}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
                    background: T.inputBg, border: `1px solid ${T.line}`, borderRadius: 12,
                    padding: '10px 12px', cursor: 'pointer', color: T.text, textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 800, color: T.textDim, flexShrink: 0 }}>
                    저장된 시트 ({s.savedSheets.length})
                  </span>
                  <span
                    style={{
                      flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700,
                      color: activeName ? T.green : T.textMute, textAlign: 'right',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {activeName ?? (savedSheetsOpen ? '' : '탭하여 선택')}
                  </span>
                  <span
                    style={{
                      flexShrink: 0, display: 'inline-flex',
                      transform: savedSheetsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
                    }}
                  >
                    {I.chevDown(16, T.textMute)}
                  </span>
                </button>
                {savedSheetsOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {s.savedSheets.map((sheet) => {
                    const active = parseSpreadsheetId(s.sheetUrl) === sheet.sheetId;
                    return (
                      <div
                        key={sheet.sheetId}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: active ? 'rgba(0,200,83,0.10)' : T.inputBg,
                          border: `1px solid ${active ? 'rgba(0,200,83,0.4)' : T.line}`,
                          borderRadius: 12, padding: '8px 10px', minWidth: 0,
                        }}
                      >
                        <button
                          onClick={() => { setSavedSheetsOpen(false); void onSelectSavedSheet(sheet); }}
                          disabled={loading !== null}
                          title={sheet.url}
                          style={{
                            flex: 1, minWidth: 0, textAlign: 'left',
                            background: 'transparent', border: 'none', cursor: loading ? 'wait' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, color: T.text, padding: 0,
                          }}
                        >
                          <span style={{ flexShrink: 0, color: active ? T.green : T.textMute }}>
                            {active ? I.check(16, T.green) : I.link(16, T.textMute)}
                          </span>
                          <span
                            style={{
                              flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                          >
                            {sheet.name}
                          </span>
                          {active && (
                            <span style={{ flexShrink: 0, fontSize: 11, color: T.green, fontWeight: 700 }}>
                              사용 중
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => s.removeSavedSheet(sheet.sheetId)}
                          title="목록에서 삭제"
                          style={{
                            flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                            background: 'transparent', border: 'none', color: T.textMute,
                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {I.trash(15, T.textMute)}
                        </button>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })()}

            {(s.availableSheets.length > 0 || s.sheetUrl) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, color: T.textMute, fontWeight: 700, padding: '0 2px' }}>
                  시트 (읽기/쓰기 모두 이 시트 사용)
                </span>
                <select
                  value={s.sheetTab}
                  onChange={(e) => onSheetTabChange(e.target.value)}
                  disabled={s.availableSheets.length === 0}
                  style={{
                    height: 48, borderRadius: 12, background: T.inputBg,
                    border: `1px solid ${T.line}`,
                    padding: '0 12px',
                    fontSize: 16, color: s.sheetTab ? T.text : T.textMute, fontWeight: 600,
                    appearance: 'none', outline: 'none',
                  }}
                >
                  {s.availableSheets.length === 0 ? (
                    <option value="">— 로그인 후 자동 로드 —</option>
                  ) : (
                    s.availableSheets.map((tab) => (
                      <option key={tab} value={tab} style={{ background: T.bg }}>
                        {tab}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {(loading || error) && (
              <div
                style={{
                  fontSize: 14, color: error ? T.red : T.textDim,
                  padding: '4px 6px', lineHeight: 1.4,
                }}
              >
                {error || loading}
              </div>
            )}
          </div>
        </div>

        {/* v0.33.0 항목5 — 연결 3상태 분리 표시(07-10 QA P1 #1): Google 연결(토큰 실시간 판정,
            [AUTH-7] stale 표시 해소) / 시트 연결 / 과거값 준비(+재시도). 입력탭 시작 카드와 공용. */}
        <div style={{ marginTop: 10, paddingLeft: 16, paddingRight: 16 }}>
          <ConnectionStatusCard />
        </div>
    </>
  );
}
