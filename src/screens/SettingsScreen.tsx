/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Stage 2(섹션 분리)에서 해소. 해소 시 이 주석 제거. */
import { useEffect, useState } from 'react';
import { T } from '../tokens';
import { I, AuthMark } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useSettingsStore } from '../stores/settingsStore';
import { ConnectionStatusCard } from '../components/ConnectionStatusCard';
import type { Column } from '../types';
import { parseSpreadsheetId } from '../lib/sheets';
import { computeTotalRows } from '../lib/autoValue';
import { buildSessionLabel, pickSessionLabelValue } from '../lib/sessionLabel';
import { logger } from '../lib/logger';
import { useSettingsActions } from '../lib/useSettingsActions';
import { HelpButton, SettingsHelpModal } from '../components/settings/SettingsHelp';
import { COLUMN_HELP, DATA_TYPE_HELP, FIRST_ENTRY_TIP } from '../components/settings/helpCopy';
import { UpdateControl } from '../components/settings/UpdateControl';
import { ColumnCard } from '../components/settings/ColumnCard';
import { TtsVoiceSelector } from '../components/settings/TtsVoiceSelector';
import { BeepPicker } from '../components/settings/BeepPicker';
import { TypeReviewModal } from '../components/settings/TypeReviewModal';
import { TablePreviewModal } from '../components/settings/TablePreviewModal';
import { SettingsSummary } from '../components/settings/SettingsSummary';
import { SettingsSummaryModal } from '../components/settings/SettingsSummaryModal';
import { SettingsResetModal } from '../components/settings/SettingsResetModal';

// ─── screen root ───────────────────────────────────────────────
export function SettingsScreen({ onNavigateToInput }: { onNavigateToInput?: () => void } = {}) {
  const s = useSettingsStore();
  // v0.32.0 설정탭 UX(Vance) B2 — 설정 요약 팝업(설정탭 전용).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // v0.35.0 FB-E(Vance) — 하단 인라인 설정 요약을 접기식·기본 접힘으로(온디맨드). 인라인 자체는
  //   유지(제거하면 C10 스크롤 마찰 재발) — 헤더 탭으로만 펼친다. savedSheetsOpen과 동일 패턴.
  const [summaryInlineOpen, setSummaryInlineOpen] = useState(false);
  // v0.23.0 설정탭#4(Vance) — `?` 도움말 팝업 열림 여부(카드별 `?` 또는 첫 진입 안내의 "자세히").
  const [helpOpen, setHelpOpen] = useState(false);

  // 인증·시트 연결·타입 검토·생성 게이트·초기화 오케스트레이션 — useSettingsActions(순수 이동)가 소유.
  const {
    loading, error,
    confirmedUrl,
    typeReview, setTypeReview,
    tablePreviewOpen, setTablePreviewOpen,
    generateGateOpen, setGenerateGateOpen,
    showUrlInput, setShowUrlInput,
    savedSheetsOpen, setSavedSheetsOpen,
    resetOpen, setResetOpen,
    tipDismissed, dismissTip,
    previewRowCount, pickerAvailable,
    onGoogleClick, onUrlTyping, onUrlConfirm, onSheetTabChange, reviewTypes,
    onPickerClick, onSelectSavedSheet,
    prospectiveSessionLabel, onGenerate, onGenerateConfirm, onResetConfirm,
  } = useSettingsActions();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        sub="오늘의 측정 항목과 시트 연결"
        right={<HelpButton onOpen={() => setHelpOpen(true)} label="설정 도움말" testid="settings-help-button" />}
      />

      <div
        style={{
          flex: 1, minHeight: 0,
          overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 12,
        }}
      >
        {/* v0.23.0 설정탭#4(Vance) — 첫 진입 1회 안내 배너(dismissible). 스크롤 영역 내부 인라인
            배너라 fixed 오버레이와 달리 버튼/카드 탭을 가로채지 않는다(기존 Playwright 흐름 보존).
            "자세히"로 전체 설명 팝업을, ✕로 영구 닫기(localStorage). */}
        {!tipDismissed && (
          <div
            data-testid="settings-first-tip"
            role="note"
            style={{
              margin: '8px 16px 0', padding: '12px 14px', borderRadius: 14,
              background: 'rgba(41,121,255,0.10)', border: `1px solid ${T.blue}`,
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}
          >
            <span aria-hidden style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>💡</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 14, color: T.text, fontWeight: 600, lineHeight: 1.5, wordBreak: 'keep-all' }}>
                {FIRST_ENTRY_TIP}
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                style={{
                  alignSelf: 'flex-start', minHeight: 36, padding: '0 14px', borderRadius: 999,
                  border: `1px solid ${T.blue}`, background: 'transparent',
                  color: T.blue, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                }}
              >
                자세히 보기
              </button>
            </div>
            <button
              type="button"
              onClick={dismissTip}
              aria-label="안내 닫기"
              data-testid="settings-first-tip-dismiss"
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: '50%',
                border: `1px solid ${T.lineStrong}`, background: 'transparent',
                color: T.textDim, fontSize: 15, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="닫기"
            >
              ✕
            </button>
          </div>
        )}

        {/* v0.32.0 설정탭 UX(Vance) B2/B3 — 유틸리티 행(항상 첫 콘텐츠 행): 설정 요약 팝업 + 초기화.
            버튼 문구에 '생성' 부분문자열 금지(기존 스펙의 hasText:'생성' .last() 헬퍼 보호). */}
        <div style={{ padding: '8px 16px 10px', display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="settings-summary-open"
            onClick={() => {
              // v0.33.0 B-10 — 설정 요약 팝업 열림 계측.
              logger.log({ type: 'command', parsed: 'ui_open', extra: 'settings_summary' });
              setSummaryOpen(true);
            }}
            style={{
              flex: 1, minHeight: 40, borderRadius: 12,
              border: `1px solid ${T.lineStrong}`, background: T.card,
              color: T.textDim, fontSize: 13, fontWeight: 800, letterSpacing: -0.2,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {I.table(15, T.textDim)} 설정 요약
          </button>
          <button
            type="button"
            data-testid="settings-reset-open"
            onClick={() => setResetOpen(true)}
            style={{
              minHeight: 40, padding: '0 16px', borderRadius: 12,
              border: '1px solid rgba(255,82,82,0.40)', background: 'rgba(255,82,82,0.08)',
              color: T.red, fontSize: 13, fontWeight: 800, letterSpacing: -0.2, cursor: 'pointer',
            }}
          >
            초기화
          </button>
        </div>

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

        {/* Section 2 - Column list */}
        <div
          style={{
            marginTop: 14, paddingLeft: 16, paddingRight: 16,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 4px',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textDim, letterSpacing: 0.6 }}>
              컬럼 · {s.columns.length}개
            </span>
            {/* S-2: 시트 데이터유형과 저장된 타입 일치 검토 */}
            <button
              onClick={reviewTypes}
              style={{
                fontSize: 12, fontWeight: 700, color: T.textDim, whiteSpace: 'nowrap',
                padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${T.lineStrong}`, background: 'transparent',
              }}
              title="시트의 실제 데이터형과 일치하는지 검토"
            >
              타입 검토
            </button>
          </div>

          {typeReview && (
            <TypeReviewModal
              checked={typeReview.checked}
              mismatches={typeReview.mismatches}
              onApplyAll={() => {
                for (const m of typeReview.mismatches) {
                  const col = s.columns.find((c) => c.id === m.id);
                  if (col) s.updateColumn(m.id, { ...col, type: m.sheet });
                }
                setTypeReview(null);
              }}
              onClose={() => setTypeReview(null)}
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {s.columns.map((c, idx) => (
              <ColumnCard
                key={c.id}
                col={c}
                index={idx}
                onChange={(n) => s.updateColumn(c.id, n)}
                onRemove={() => s.removeColumn(c.id)}
                onMoveUp={() => s.reorderColumns(idx, idx - 1)}
                onMoveDown={() => s.reorderColumns(idx, idx + 1)}
                isFirst={idx === 0}
                isLast={idx === s.columns.length - 1}
              />
            ))}

            <button
              onClick={s.addColumn}
              style={{
                height: 48, borderRadius: 12,
                background: 'transparent', border: `1px dashed ${T.lineStrong}`,
                color: T.textDim, fontSize: 15, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {I.plus(16, T.textDim)} 항목 추가
            </button>
          </div>
        </div>

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
                  logger.log({ type: 'app', extra: `setting_changed:fastRecognition=${next}` });
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
                  logger.log({ type: 'app', extra: `setting_changed:autoScreenCapture=${next}` });
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

        {/* v0.34.0 C10(Vance) — 설정 요약 인라인(스크롤 영역 말미, 민구 요청: "설정 재확인에 페이지
            최상단까지 가는 번거로움"). 상단 '설정 요약' 팝업 버튼은 유지하고, 같은 SettingsSummary
            SSOT를 하단 액션바("총 N행 생성됨 (미리보기)") 바로 위에서 한 번 더 보여준다. 수치는
            팝업(SettingsSummaryModal)과 동일 소스: computeTotalRows(s.columns) +
            prospectiveSessionLabel(). footer(액션바, flexShrink:0 무스크롤 존)에 넣지 않는다 —
            반드시 스크롤 영역 안. 캡션에 '생성됨'/'생성 예정' 부분문자열 금지(기존 text= 로케이터
            보호) — 스펙 단언은 data-testid 기반. */}
        {s.columns.length > 0 && (
          <div
            data-testid="settings-summary-inline"
            style={{
              margin: '18px 16px 0',
              padding: 14,
              background: T.card,
              borderRadius: 16,
              border: `1px solid ${T.line}`,
              display: 'flex',
              flexDirection: 'column',
              gap: summaryInlineOpen ? 10 : 0,
            }}
          >
            {/* v0.35.0 FB-E — 헤더 탭으로만 펼침(기본 접힘). testid는 컨테이너에 상주(항상 마운트),
                내용만 게이트. savedSheets 헤더와 동일 aria-expanded + 회전 셰브런 패턴. */}
            <button
              data-testid="settings-summary-toggle"
              onClick={() => setSummaryInlineOpen((v) => !v)}
              aria-expanded={summaryInlineOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.textDim, textAlign: 'left', width: '100%',
                // v0.35.0 R2-FIX-4(리뷰 라운드2, a11y) — 44px 터치 타깃 확보(장갑 낀 현장 조작).
                //   종전 padding:0 + 18~20px 텍스트라 타깃이 작았다.
                minHeight: 44, padding: '4px 0',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 800, color: T.textDim, letterSpacing: -0.2, flex: 1 }}>
                설정 요약
              </span>
              <span
                style={{
                  flexShrink: 0, display: 'inline-flex',
                  transform: summaryInlineOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
                }}
              >
                {I.chevDown(18, T.textMute)}
              </span>
            </button>
            {summaryInlineOpen && (
              <SettingsSummary
                columns={s.columns}
                totalRows={computeTotalRows(s.columns)}
                sessionLabel={prospectiveSessionLabel()}
              />
            )}
          </div>
        )}

        {/* Footer: version + build date */}
        <div
          style={{
            marginTop: 18, padding: '12px 16px 8px',
            textAlign: 'center',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            v{__APP_VERSION__}{' '}
            <span style={{ color: T.textMute, fontWeight: 500, fontSize: 12 }}>({__BUILD_DATE__})</span>
          </div>
          <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>
            survey-011 · mingoo.jejuagri.kang@gmail.com
          </div>
          {/* v0.18.0 1f — 수동 업데이트 확인/새로고침. 새 버전이 대기 중이면 바로 적용, 아니면
              능동 체크만 트리거(설치형에서 새 버전 반영 경로를 사용자가 직접 호출). */}
          <UpdateControl />
        </div>
      </div>

      {/* Action bar */}
      <div
        style={{
          padding: '12px 16px 12px',
          borderTop: `1px solid ${T.line}`,
          background: 'rgba(255,255,255,0.02)',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}
      >
        {!s.tableGenerated && s.columns.length > 0 && previewRowCount > 0 && (
          <div style={{ textAlign: 'center', fontSize: 13, color: T.textMute }}>
            현재 설정으로 <span style={{ color: T.blue, fontWeight: 700 }}>{previewRowCount}행</span> 생성 예정
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {s.tableGenerated ? (
            <>
              <button
                onClick={() => {
                  // v0.33.0 B-10 — 미리보기 팝업 열림 계측(생성 후 '미리보기' 버튼 경로).
                  logger.log({ type: 'command', parsed: 'ui_open', extra: 'table_preview' });
                  setTablePreviewOpen(true);
                }}
                style={{
                  flex: 1, height: 56, borderRadius: 28,
                  background: 'rgba(0,200,83,0.12)',
                  border: '1px solid rgba(0,200,83,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  fontSize: 16, fontWeight: 700, color: T.green,
                  cursor: 'pointer',
                }}
              >
                {I.check(20, T.green)} 총 {s.totalRows}행 생성됨 (미리보기)
              </button>
              <button
                onClick={onGenerate}
                style={{
                  height: 56, padding: '0 18px', borderRadius: 28,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                재생성
              </button>
            </>
          ) : (
            <button
              onClick={onGenerate}
              style={{
                flex: 1, height: 56, borderRadius: 28, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 18, fontWeight: 800, letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${T.blueGlow}`,
              }}
            >
              {I.table(20, '#fff')} 입력 테이블 생성
            </button>
          )}
        </div>
        {/* v0.32.0 설정탭 UX(Vance) B4 — 생성 완료 후 다음 단계 안내 + 입력탭 이동(자동 전환 없음,
            민구 확정). 캡션은 '생성됨'/'생성 예정' 부분문자열을 피한다(기존 text= 로케이터 보호). */}
        {s.tableGenerated && (
          <>
            <div style={{ textAlign: 'center', fontSize: 12, color: T.textMute, lineHeight: 1.4 }}>
              생성 완료 — 입력 탭에서 [음성 입력 시작]을 누르세요
            </div>
            <button
              type="button"
              data-testid="settings-go-input"
              onClick={() => onNavigateToInput?.()}
              style={{
                width: '100%', height: 54, borderRadius: 28, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 17, fontWeight: 800, letterSpacing: -0.2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${T.blueGlow}`,
              }}
            >
              입력탭으로 이동 →
            </button>
          </>
        )}
      </div>

      {/* v0.19.0 W3 — '최종 설정값 확인' 게이트. 요약은 현재 columns에서 파생(stale 방지).
          v0.32.0 B1 — 게이트는 무스크롤 요약 전용으로 재설계(테이블 본문 제거). 표가 필요하면
          게이트 안의 "생성될 테이블 미리보기"로 아래 닫기 전용 미리보기를 게이트 위에 오버레이.
          "확인(이대로 생성)" = onGenerateConfirm에서만 실제 생성, "취소" = 미생성. */}
      {generateGateOpen && (
        <TablePreviewModal
          columns={s.columns}
          totalRows={computeTotalRows(s.columns)}
          sessionLabel={prospectiveSessionLabel()}
          regenerating={s.tableGenerated}
          onConfirm={onGenerateConfirm}
          onOpenPreview={() => {
            // v0.33.0 B-10 — 게이트 안 "생성될 테이블 미리보기" 경로도 동일 계측.
            logger.log({ type: 'command', parsed: 'ui_open', extra: 'table_preview' });
            setTablePreviewOpen(true);
          }}
          onClose={() => setGenerateGateOpen(false)}
        />
      )}

      {/* 생성 후 '미리보기' — 닫기 전용(부수효과 없음). 게이트에서 열었을 때는 게이트 위에 겹쳐야
          하므로 게이트보다 뒤(DOM 순서 = 위)에 마운트하고, 행수는 게이트가 열려 있으면 현재 columns
          에서 파생(생성 전 stale totalRows 방지). '생성' 포함 버튼이 없어 hasText:'생성' .last()는
          여전히 게이트 확인 버튼을 가리킨다. */}
      {tablePreviewOpen && (
        <TablePreviewModal
          columns={s.columns}
          totalRows={generateGateOpen ? computeTotalRows(s.columns) : s.totalRows}
          onClose={() => setTablePreviewOpen(false)}
        />
      )}

      {/* v0.32.0 설정탭 UX(Vance) B2 — 설정 요약 팝업(닫기 전용, 무스크롤). 로그인·시트 연결·컬럼
          요약(SettingsSummary 공용)·다이얼/토글·생성 상태를 한 화면에 모은다. 설정탭 전용. */}
      {summaryOpen && (() => {
        const activeSheetId = parseSpreadsheetId(s.sheetUrl);
        const sheetName = s.savedSheets.find((x) => x.sheetId === activeSheetId)?.name ?? null;
        const sheetLabel = s.sheetUrl.trim()
          ? `${sheetName ?? '시트'}${s.sheetTab ? ` · ${s.sheetTab}` : ''}`
          : null;
        return (
          <SettingsSummaryModal
            googleConnected={s.googleConnected}
            userEmail={s.userEmail}
            sheetLabel={sheetLabel}
            columns={s.columns}
            totalRows={computeTotalRows(s.columns)}
            sessionLabel={prospectiveSessionLabel()}
            recognitionTolerance={s.recognitionTolerance}
            ttsRate={s.ttsRate}
            fastRecognition={s.fastRecognition}
            tableGenerated={s.tableGenerated}
            generatedRows={s.totalRows}
            onClose={() => setSummaryOpen(false)}
          />
        );
      })()}

      {/* v0.32.0 설정탭 UX(Vance) B3 — 초기화 확인 모달. 기본은 로그인·시트 보존, 체크박스로 opt-in
          삭제. 버튼 문구에 '생성' 부분문자열 금지(초기화 실행/취소는 안전). */}
      {resetOpen && (
        <SettingsResetModal
          onCancel={() => setResetOpen(false)}
          onConfirm={(opts) => void onResetConfirm(opts)}
        />
      )}

      {/* v0.23.0 설정탭#4(Vance) — 설명 팝업. 카드별 `?` 또는 첫 진입 안내의 "자세히 보기"에서 연다.
          모든 데이터형/필드 설명을 한 곳에 모은다(COLUMN_HELP). 사용자 명시 오픈 → 자동 노출 아님. */}
      {/* v0.33.0 항목10-A — 데이터형 6종 설명(DATA_TYPE_HELP)을 같은 팝업에 이어 통합. */}
      {helpOpen && (
        <SettingsHelpModal
          title="설정 도움말"
          items={[...COLUMN_HELP, ...DATA_TYPE_HELP]}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </div>
  );
}
