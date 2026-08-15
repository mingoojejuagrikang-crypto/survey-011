import { T } from '../../tokens';
import { I } from '../icons';
import { useSettingsStore } from '../../stores/settingsStore';
import { logger } from '../../lib/logger';

/** [ENV-12 · r2-nearcap] 설정탭 하단 액션바 — 생성 예정 행수 안내 + 생성/재생성 버튼 행.
 *  SettingsScreen에서 **순수 이동(DOM 불변)**. 스토어는 직접 구독하고(SessionOptionsSection과
 *  같은 관행), `useSettingsActions` 소유분(previewRowCount·onGenerate)과 화면 로컬 팝업 상태
 *  2종만 prop으로 받는다 — 이름을 그대로 둬 본문 바이트가 이동 전과 같다.
 *  🔴 문구 계약을 손대지 마라: '설정요약'은 **무공백** 표기이고(v0440-c7-cleanup·settings-ux가
 *  정확 문구 '설정 요약' 진입점을 **0개**로 잰다), '생성' 부분문자열의 위치도 게이트 헬퍼
 *  (hasText:'생성' .last())의 전제다. 근거는 아래 렌더 지점 주석. */
export function SettingsActionBar({
  previewRowCount, onGenerate, setSummaryOpen, setTablePreviewOpen,
}: {
  previewRowCount: number;
  onGenerate: () => void;
  setSummaryOpen: (v: boolean) => void;
  setTablePreviewOpen: (v: boolean) => void;
}) {
  const s = useSettingsStore();
  return (
    <>
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
    </>
  );
}
