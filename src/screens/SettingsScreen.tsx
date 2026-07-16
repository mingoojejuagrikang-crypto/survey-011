import { useEffect, useState } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useSettingsStore } from '../stores/settingsStore';
import type { Column } from '../types';
import { parseSpreadsheetId } from '../lib/sheets';
import { computeTotalRows } from '../lib/autoValue';
import { logger } from '../lib/logger';
import { useSettingsActions } from '../lib/useSettingsActions';
import { HelpButton, SettingsHelpModal } from '../components/settings/SettingsHelp';
import { COLUMN_HELP, DATA_TYPE_HELP, FIRST_ENTRY_TIP } from '../components/settings/helpCopy';
import { UpdateControl } from '../components/settings/UpdateControl';
import { ColumnCard } from '../components/settings/ColumnCard';
import { SheetConnectSection } from '../components/settings/SheetConnectSection';
import { SessionOptionsSection } from '../components/settings/SessionOptionsSection';
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

        {/* Section 1 - Google + Sheet URL (+ 연결 3상태 카드) — SheetConnectSection으로 추출(Stage 2) */}
        <SheetConnectSection
          loading={loading}
          error={error}
          confirmedUrl={confirmedUrl}
          showUrlInput={showUrlInput}
          setShowUrlInput={setShowUrlInput}
          savedSheetsOpen={savedSheetsOpen}
          setSavedSheetsOpen={setSavedSheetsOpen}
          pickerAvailable={pickerAvailable}
          onGoogleClick={onGoogleClick}
          onUrlTyping={onUrlTyping}
          onUrlConfirm={onUrlConfirm}
          onPickerClick={onPickerClick}
          onSelectSavedSheet={onSelectSavedSheet}
          onSheetTabChange={onSheetTabChange}
        />

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

        {/* 세션 옵션(세션명·빠른 인식·자동 캡처·비프음·TTS) — SessionOptionsSection으로 추출(Stage 2) */}
        <SessionOptionsSection prospectiveSessionLabel={prospectiveSessionLabel} />

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
