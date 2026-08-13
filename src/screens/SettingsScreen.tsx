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
import {
  SettingsSummaryModal,
} from '../components/settings/SettingsSummaryModal';
import { SettingsResetModal } from '../components/settings/SettingsResetModal';

// ─── screen root ───────────────────────────────────────────────
export function SettingsScreen() {
  const s = useSettingsStore();
  // v0.32.0 설정탭 UX(Vance) B2 — 설정 요약 팝업(설정탭 전용).
  const [summaryOpen, setSummaryOpen] = useState(false);
  // v0.23.0 설정탭#4(Vance) — `?` 도움말 팝업 열림 여부(카드별 `?` 또는 첫 진입 안내의 "자세히").
  const [helpOpen, setHelpOpen] = useState(false);

  // 인증·시트 연결·타입 검토·생성 게이트·초기화 오케스트레이션 — useSettingsActions(순수 이동)가 소유.
  const {
    loading, error,
    confirmedUrl, sheetUrlDraft,
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

        {/* 🔴 v0.45.0 UI①(민구 확정 08-05, 추가요청3=F5 재지적) — 종전 유틸리티 행(v0.32.0 B2/B3:
            '설정 요약'+'초기화', 항상 첫 콘텐츠 행)을 **삭제했다.** '설정 요약' 진입점은 하단
            액션바의 '설정요약'(settings-summary-shortcut — "이미 하단의 테이블 보기 버튼 옆에
            배치되어 있음", 수차례 요청 재지적)만 남고, '초기화'는 하단 상시 영역(액션바 2행)으로
            이동했다("스크롤과 무관하게 상시 보기에 하단에 배치"). 되살리려면 이 결정부터 봐라. */}

        {/* Section 1 - Google + Sheet URL (+ 연결 3상태 카드) — SheetConnectSection으로 추출(Stage 2) */}
        <SheetConnectSection
          loading={loading}
          error={error}
          confirmedUrl={confirmedUrl}
          sheetUrlDraft={sheetUrlDraft}
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

        {/* v0.44.0 §C7 F26: v0.34.0 C10 인라인 설정 요약(+v0.35.0 FB-E 접기식) 폐기(민구 08-02)
            — 되살리려면 §4-b를 먼저 읽어라. C10의 원 요청("설정 재확인에 페이지 최상단까지 가는
            번거로움")은 생성 완료 액션바의 '설정요약' 바로가기가 흡수한다.
            🔴 v0.45.0 UI① 갱신 — 상단 '설정 요약' 버튼도 삭제됐다(민구 재지적). 이제 요약 팝업
            진입점은 하단 액션바의 '설정요약'(settings-summary-shortcut) **하나뿐**이다. */}

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
            {/* 🔴 v0.46.0 (민구 지시 08-06) — **테스트 배포본은 버전 옆에 「프리뷰」라고 적는다.**
                프리뷰는 bump를 안 하므로 프로덕션과 버전 숫자가 같아진다(08-06 실측: 둘 다 0.45.0).
                숫자만 보고는 어느 빌드인지 알 수 없어 제보 판정이 번들 grep까지 갔다. 이 배지가
                **민구가 화면에서 즉시 구분**하게 하고, 짝이 되는 로그 표식(logger.ts)이
                **분석자가 로그에서 구분**하게 한다. */}
            {__PREVIEW_BUILD__ && (
              <span
                data-testid="preview-build-badge"
                style={{
                  color: T.amber,
                  border: `1px solid ${T.amber}`,
                  borderRadius: 6, padding: '1px 6px',
                  fontSize: 11, fontWeight: 800, marginRight: 6,
                  letterSpacing: -0.2,
                }}
              >
                프리뷰
              </span>
            )}
            <span style={{ color: T.textMute, fontWeight: 500, fontSize: 12 }}>({__BUILD_DATE__})</span>
          </div>
          <div style={{ fontSize: 11, color: T.textMute, marginTop: 4 }}>
            survey-011 · mingoo.jejuagri.kang@gmail.com
          </div>
          {/* v0.18.0 1f — 수동 업데이트 확인/새로고침. 새 버전이 대기 중이면 바로 적용, 아니면
              능동 체크만 트리거(설치형에서 새 버전 반영 경로를 사용자가 직접 호출). */}
          {/* 🔴 v0.46.0 — 프리뷰 빌드는 **서비스워커가 없다**(VitePWA disable). `UpdateControl`은
              전부 SW의 `needRefresh`에 걸려 있어 **영원히 「최신」만 답한다** — 민구가 08-06에
              *"프리뷰는 홈 화면 설치 시 업데이트 점검이 안 되니?"* 로 정확히 짚었다.
              👉 없는 기능을 있는 척 보이지 않게 **버튼 대신 실제 갱신법을 적는다.** */}
          {__PREVIEW_BUILD__ ? (
            <div
              data-testid="preview-update-note"
              style={{ fontSize: 11, color: T.textMute, marginTop: 10, lineHeight: 1.5 }}
            >
              테스트본은 자동 업데이트 확인이 없습니다.
              <br />
              <b style={{ color: T.textDim }}>화면을 아래로 당겨 새로고침</b>하면 최신이 됩니다.
            </div>
          ) : (
            <UpdateControl />
          )}
        </div>

        {/* 🔴 v0.46.0 WP-H(민구 지시 08-05) — '설정 초기화'는 **스크롤 영역의 맨 아래**다.
            액션바 상시 행(v0.45.0 UI①)에서 여기로 내렸다 — 근거는 액션바 쪽 주석에 있다.
            🔑 위치가 계약이다: Footer(버전·업데이트)보다 **뒤**, 즉 설정탭에서 가장 마지막에
            닿는 자리다. 일상 동작(테이블 재생성)은 액션바에 남고, 파괴적 동작만 여기 있다.
            명칭도 '초기화' → **'설정 초기화'**(민구 지시) — 무엇이 초기화되는지 버튼이 말한다.
            높이 56·글자 13은 액션바 3버튼 행과 동일하게 유지한다(민구: "버튼과 내부 글자 크기
            동일하도록"). 확인 모달(SettingsResetModal) 흐름·testid는 불변. */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px 16px' }}>
          <button
            type="button"
            data-testid="settings-reset-open"
            onClick={() => setResetOpen(true)}
            style={{
              flex: 1, height: 56, borderRadius: 28,
              border: '1px solid rgba(255,23,68,0.40)', background: 'rgba(255,23,68,0.08)',
              color: T.red, fontSize: 13, fontWeight: 800, letterSpacing: -0.2,
              whiteSpace: 'nowrap', cursor: 'pointer',
            }}
          >
            설정 초기화
          </button>
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
        {/* v0.44.0 §C7 F26 — 생성 완료 액션바는 3버튼 한 행: 설정요약 · 생성 테이블 보기 · 재생성.
            종전 "총 N행 생성됨 (미리보기)"/"재생성" 2버튼 행을 여기로 재배치했다(같은 기능 버튼
            중복 금지) — 행수·생성 상태 수치는 설정 요약 팝업("생성됨 · 총 N행")과 미리보기 팝업이
            갖는다. '설정요약'은 무공백 표기가 계약.
            🔴 v0.45.0 UI① 갱신(리뷰 C14) — 종전 "정확 문구 '설정 요약' 상단 진입점 1개" 계약은
            **폐기**됐다: 상단 버튼 삭제로 정확 문구 진입점은 0개가 계약이다(v0440-c7-cleanup·
            settings-ux가 0개로 잰다). 이 무공백 버튼이 유일 진입점이다.
            '생성' 부분문자열은 액션바에선 종전에도 허용(hasText:'생성' .last() 헬퍼는 게이트가
            열린 동안만 쓰이고, 모달이 액션바보다 DOM 뒤에 마운트되므로 여전히 게이트 확인 버튼을
            가리킨다). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {s.tableGenerated ? (
            <>
              <button
                type="button"
                data-testid="settings-summary-shortcut"
                onClick={() => {
                  // v0.33.0 B-10 — 설정 요약 팝업 열림 계측(상단 버튼과 동일 extra).
                  logger.log({ type: 'command', parsed: 'ui_open', extra: 'settings_summary' });
                  setSummaryOpen(true);
                }}
                style={{
                  flex: 1, height: 56, borderRadius: 28,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 13, fontWeight: 800, letterSpacing: -0.2,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                }}
              >
                설정요약
              </button>
              <button
                type="button"
                data-testid="settings-open-preview"
                onClick={() => {
                  // v0.33.0 B-10 — 미리보기 팝업 열림 계측(생성 후 버튼 경로, extra 불변).
                  logger.log({ type: 'command', parsed: 'ui_open', extra: 'table_preview' });
                  setTablePreviewOpen(true);
                }}
                style={{
                  flex: 1, height: 56, borderRadius: 28,
                  border: '1px solid rgba(57,255,20,0.35)', background: 'rgba(57,255,20,0.12)',
                  color: T.green, fontSize: 13, fontWeight: 800, letterSpacing: -0.2,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                }}
              >
                생성 테이블 보기
              </button>
              <button
                type="button"
                onClick={onGenerate}
                style={{
                  flex: 1, height: 56, borderRadius: 28,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 13, fontWeight: 800, letterSpacing: -0.2,
                  whiteSpace: 'nowrap', cursor: 'pointer',
                }}
              >
                {/* 🔴 v0.46.0 WP-H — '재생성' → '테이블 재생성'(민구 지시 08-05). 무엇을 재생성하는지
                    버튼이 말한다. 같은 회차에 '초기화' → '설정 초기화'로 짝을 맞췄다 — 둘 다
                    "무엇에 대한 동작인가"를 이름에 넣는 정정이고, 초기화를 스크롤 맨 아래로 내린
                    배치 변경과 한 묶음이다. 게이트 모달 제목('재생성 — 설정값 확인')은 불변. */}
                테이블 재생성
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
        {/* 🔴 v0.46.0 WP-H(민구 지시 08-05) — '초기화' 상시 행을 **철회**했다. 액션바에서 빠지고
            스크롤 영역 맨 아래(Footer 아래)로 내려갔다. v0.45.0 UI①의 "스크롤과 무관하게 상시"
            배치를 무르는 것이므로 되살리기 전에 아래 근거를 읽어라.
            근거(민구): *"하루에 세션 여러개를 만들어서 음성입력"* — **재생성은 일상, 초기화는 예외**다.
            상시 노출은 그 빈도를 거꾸로 반영했고, 실측이 대가를 보여줬다: 08-05 하루에
            `settings_reset` **6회**(07:07:25 · 07:07:51 · 09:15:26 · 09:46:28 · 16:29:01 · 17:12:03)
            — 07:07 두 건은 **26초 간격**이다. 초기화는 기본 컬럼 템플릿을 되돌려 리스트 선택지를
            통째로 날린다(v0.46.0 §3-J). 즉 상시 배치가 파괴적 동작의 오탭 비용을 키웠다.
            👉 파괴적 동작은 **찾아가서** 누르게 한다. 확인 모달은 종전 그대로 2단계로 남는다. */}
        {/* v0.44.0 §C7 F25: v0.32.0 B4 결정 폐기(민구 08-02) — 되살리려면 §4-b를 먼저 읽어라.
            여기 있던 "생성 완료 — 입력 탭에서 [음성 입력 시작]을 누르세요" 안내문구와
            "입력탭으로 이동 →" 버튼(settings-go-input)을 삭제했다(F26이 3버튼 행으로 대체). */}
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
          요약(SettingsSummary 공용)·다이얼/토글·생성 상태를 한 화면에 모은다. 설정탭 전용.
          v0.49.0 W3(FB-3) — 「이전 조사」 행 추가. v0.49 r2 A9/B1 — 그 상태의 **소유자는 팝업**이다
          (종전엔 여기서 렌더마다 계산해 prop으로 내렸다 — 설정 쓰기마다 인덱스 전수 스캔).
          팝업은 열릴 때 준비를 깨우고(ensurePastIndex) 준비되면 스스로 갱신한다. */}
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
            roundDateColId={s.roundDateColId}
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
