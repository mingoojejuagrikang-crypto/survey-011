/**
 * v0.35.2 Stage 2 — 설정탭 오케스트레이션 훅 (SettingsScreen에서 순수 이동, GL-006 §7~8 UI/로직 분리).
 * Google 인증·시트 연결/저장목록·컬럼 타입 검토·테이블 생성 게이트·전체 초기화의 상태와 핸들러를
 * 소유한다. 화면(SettingsScreen)은 표현만 담당한다.
 *
 * v0.49 R1 리팩토링 P1-2 — 500줄 상한 도달로 책임 3덩이를 서브 훅으로 분리하고, 이 훅은 **조립만**
 * 한다(반환 형태 불변 — 호출부 SettingsScreen 수정 0):
 *  - 시트 연결·인증: useSettingsSheetConnection (loading/error·요청 세대·loadHeaders 공유 기반 소유)
 *  - 테이블 생성·타입 검토: useSettingsTableGeneration
 *  - 전체 초기화·첫 진입 팁: useSettingsReset (SETTINGS_TIP_SEEN_KEY 소유)
 * 서브 훅 간 공유는 useSettingsSheetConnection의 `internal` 번들(SettingsActionsShared)로만 배선한다.
 * 로직·계측(extra 문자열)은 분리 전과 바이트 동일(SOP-003 파서 계약).
 */
import { useSettingsSheetConnection } from './useSettingsSheetConnection';
import { useSettingsTableGeneration } from './useSettingsTableGeneration';
import { useSettingsReset } from './useSettingsReset';

export function useSettingsActions() {
  const conn = useSettingsSheetConnection();
  const gen = useSettingsTableGeneration(conn.internal);
  const reset = useSettingsReset({ shared: conn.internal, setTypeReview: gen.setTypeReview });

  return {
    loading: conn.loading, error: conn.error,
    confirmedUrl: conn.confirmedUrl, sheetUrlDraft: conn.sheetUrlDraft,
    typeReview: gen.typeReview, setTypeReview: gen.setTypeReview,
    tablePreviewOpen: gen.tablePreviewOpen, setTablePreviewOpen: gen.setTablePreviewOpen,
    generateGateOpen: gen.generateGateOpen, setGenerateGateOpen: gen.setGenerateGateOpen,
    showUrlInput: conn.showUrlInput, setShowUrlInput: conn.setShowUrlInput,
    savedSheetsOpen: conn.savedSheetsOpen, setSavedSheetsOpen: conn.setSavedSheetsOpen,
    resetOpen: reset.resetOpen, setResetOpen: reset.setResetOpen,
    tipDismissed: reset.tipDismissed, dismissTip: reset.dismissTip,
    previewRowCount: gen.previewRowCount, pickerAvailable: conn.pickerAvailable,
    onGoogleClick: conn.onGoogleClick, onUrlTyping: conn.onUrlTyping,
    onUrlConfirm: conn.onUrlConfirm, onSheetTabChange: conn.onSheetTabChange,
    reviewTypes: gen.reviewTypes,
    onPickerClick: conn.onPickerClick, onSelectSavedSheet: conn.onSelectSavedSheet,
    prospectiveSessionLabel: gen.prospectiveSessionLabel,
    onGenerate: gen.onGenerate, onGenerateConfirm: gen.onGenerateConfirm,
    onResetConfirm: reset.onResetConfirm,
  };
}
