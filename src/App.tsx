import { useEffect, useState } from 'react';
import { TabBar, type TabId } from './components/TabBar';
import { UpdateBanner } from './components/UpdateBanner';
import { SettingsScreen } from './screens/SettingsScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { DataScreen } from './screens/DataScreen';
import { T, DEVICE } from './tokens';
import { hydrateSessions } from './lib/hydrate';
import { hydratePastIndexFallback, getCachedIndex, getFallbackIndex, ensurePastIndex } from './lib/pastValues';
import { useSettingsStore } from './stores/settingsStore';
import { initAutoCapture } from './lib/screenshot';
import { captureForFeedback, initFeedbackQueueFlush, submitFeedback } from './lib/feedback';
import { FeedbackModal } from './components/FeedbackModal';
import { logger } from './lib/logger';
import { useSessionStore } from './stores/sessionStore';

export default function App() {
  const [tab, setTab] = useState<TabId>('settings');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);
  // v0.33.0 항목11 — 개선요청 모달 상태. closed=닫힘 / capturing=캡처 중(모달 미표시) /
  // {shot}=캡처 종료(성공 Blob 또는 실패 null) + 모달 표시. 캡처를 모달 '표시 전에' 끝내야
  // 스크린샷에 모달 자신이 찍히지 않는다.
  const [feedback, setFeedback] = useState<'closed' | 'capturing' | { shot: Blob | null }>('closed');
  // v0.33.0 항목4 [STT-16] — 음성 세션이 살아 있는 동안(활성/일시정지/완료 대기) VoiceScreen을
  // unmount하지 않기 위한 신호. 조건부 렌더(탭 전환)가 인식기·워치독·onTokenSettled 구독을 통째로
  // teardown해 STT가 죽고 수동 pause/resume로만 회복되던 근인(07-13 로그 2/2 재현)의 해소 축.
  const sessionLive = useSessionStore((s) => s.phase !== 'ready' && s.phase !== 'done');

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 480);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Hydrate data store from IndexedDB once on mount. Errors are logged + recorded as
  // `hydrationError` (D-1) so DataScreen can offer a retry instead of a misleading empty state.
  // Auto-sync intentionally disabled — user explicitly picks sessions in DataScreen.
  useEffect(() => {
    // v0.5.0 W7(T-19): 앱 기동 계측 — 다음 로그 분석에서 "앱이 떴는데 세션이 없다"와
    // "앱 자체가 안 떴다"를 구분할 수 있게 한다.
    logger.log({ type: 'app', extra: 'app_boot', meta: { appVersion: logger.device().appVersion } });
    void hydrateSessions();
    // v0.33.0 항목5 — 과거값 인덱스 영속 폴백 복원(idempotent, 토큰 무관). 부팅 시점에 미리
    // 하이드레이션해 두면 미로그인 세션의 첫 값 커밋부터 폴백 알람이 작동한다.
    // v0.34.0 C9(c) — 폴백 복원 직후 1회: 시트가 설정돼 있는데 인덱스(신선 캐시·영속 폴백)가
    // 전무하면 ensurePastIndex()로 미리 준비한다(민구: "시트가 연결되면 자동으로 작동해야 함").
    // 인증수단(토큰/API key)이 없으면 loadPastIndex가 not_signed_in으로 1회 skip하고 백오프도
    // 걸지 않으므로(shouldRetryLoad) 미로그인 부팅에 무해. 세션 시작·설정 저장 트리거와 중복돼도
    // 캐시/in-flight 가드가 흡수한다.
    void hydratePastIndexFallback().then(() => {
      const st = useSettingsStore.getState();
      // v0.34.0 리뷰(Codex+agy 공통 지적) — 부팅 프리페치도 다른 3개 호출부(세션시작 useVoiceSession
      // :2185·설정저장 SettingsScreen:1309·테이블생성 :1304)와 동일하게 anyAnomalyRule로 게이트한다.
      // 이상치 규칙이 없으면 과거값 인덱스는 애초에 쓰이지 않으므로 전체 시트 다운로드가 낭비이고
      // (Codex), 비공개 시트+API key 조합에서 무의미한 403 재시도가 도는 표면도 함께 줄어든다(agy).
      const anyAnomalyRule = st.columns.some(
        (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
      );
      if (anyAnomalyRule && st.sheetUrl && st.sheetTab && !getCachedIndex() && !getFallbackIndex()) ensurePastIndex();
    });
    // v0.33.0 항목10-B — 입력화면 자동 캡처 배선(logger tap 단일 지점, idempotent).
    // 토글 off면 tap은 남되 캡처가 스킵된다(스위치는 settingsStore.autoScreenCapture).
    initAutoCapture();
    // v0.33.0 항목11 — 개선요청 큐 자동 재전송 배선(부팅 즉시 1회 + online 복귀 + 토큰 settle).
    initFeedbackQueueFlush();
  }, []);

  // v0.33.0 B(신규) — lifecycle:vis_* 계측(07-13 분석 §3 권고). 화면 끄기/OS 앱 전환/브라우저
  // 백그라운드 전환을 앱 레벨(문서 단위)에서 기록해, "탭 전환 unmount"([STT-16] 인앱)와
  // "visibility 상실"(OS 레벨)을 다음 로그부터 분별한다. VoiceScreen 수명과 무관하게 살아 있고,
  // logger가 세션 컨텍스트를 자동 첨부하므로 세션 중이면 sessionId가 실린다.
  useEffect(() => {
    const onVis = () => {
      logger.log({
        type: 'app',
        extra: `lifecycle:${document.visibilityState === 'hidden' ? 'vis_hidden' : 'vis_visible'}`,
      });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // v0.33.0 B-4 — 탭 전환 계측(이전엔 완전 무로깅 → 데이터탭 오터치·[STT-16] 재구성 불가).
  // 기존 command 타입 + extra:'tab:<from>-><to>' 컨벤션(신규 LogEntry type 없음, log-replay 호환).
  const changeTab = (next: TabId) => {
    // v0.33.0 항목11 — '개선요청' 탭 인터셉트(민구 확정: 화면 전환 없는 팝업 방식). setTab하지
    // 않으므로 현재 화면(음성 세션 포함)이 그대로 유지되고, 모달 표시 '전에' 화면을 캡처해
    // 스크린샷에 모달이 찍히지 않는다. 캡처는 best-effort(타임아웃 4s) — 실패해도 모달은 뜬다.
    if (next === 'feedback') {
      if (feedback !== 'closed') return; // 이미 캡처 중/모달 표시 중 — 중복 인터셉트 무시
      logger.log({ type: 'app', extra: `feedback_open:tab=${tab}` });
      // v0.34.0 A2 — 팝업 열림 신호(캡처 시작 시점부터). useVoiceSession 구독이 STT를 일시정지한다
      // (실기기 피드백: "피드백 팝업 작동 시 음성입력은 잠시 일시 정지"). keep-alive([STT-16]) 덕에
      // 어느 탭에서 열어도 세션 중이면 신호가 도달하고, 세션이 없으면 자연 no-op.
      useSessionStore.getState().setUiModalOpen('feedback');
      setFeedback('capturing');
      void captureForFeedback().then((shot) => setFeedback({ shot }));
      return;
    }
    if (next !== tab) {
      // v0.37.0 리뷰#2(민구) — 실제 탭 전환 직전, 음성 화면에 열린 오버레이(수동 입력 시트·？명령어
      //   도움말)를 먼저 닫는다(→ onClose→STT resume). FB-I로 나비가 상시 탭 가능해진 뒤, 시트가 열린
      //   채(STT suspend) 탭을 누르면 onClose 없이 전환돼 STT가 정지된 채 남아 발화가 유실되던 구멍의
      //   차단축. 열린 오버레이가 없으면 ActiveState 구독이 자연 no-op.
      useSessionStore.getState().requestOverlayClose();
      logger.log({ type: 'command', parsed: 'tab', extra: `tab:${tab}->${next}` });
    }
    setTab(next);
  };

  const phoneStyle: React.CSSProperties = isMobile
    ? {
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        background: T.bg,
        color: T.text,
        // v0.15.0 A1 — standalone(홈화면 설치) safe-area 침범 방지. 브라우저 크롬이 없는
        // standalone에서 콘텐츠가 상태바·노치를 침범하던 문제. 상단/좌우만 셸에서 흡수하고,
        // 하단은 탭바가 max(28px, env(...))로 별도 처리한다(이중 패딩 방지). 일반 Safari 탭에선
        // env(...)가 0이라 무영향. 가로 inset은 노치 가로방향 안전마진(앱은 portrait 고정이지만 방어).
        // v0.33.0 — env() 직접 판독 대신 global.css :root의 safe-area 변수(SSOT) 소비.
        paddingTop: 'var(--sat)',
        paddingLeft: 'var(--sal)',
        paddingRight: 'var(--sar)',
      }
    : {
        width: DEVICE.width,
        height: DEVICE.height,
        margin: '20px auto',
        borderRadius: 36,
        background: T.bg,
        color: T.text,
        boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      };

  return (
    <div className={isMobile ? 'mobile-app-shell' : undefined} style={phoneStyle}>
      {/* v0.18.0 1f — 비강제 "새 버전" 배너(상단 고정, 모든 탭 공통). 새 SW waiting 시에만 노출. */}
      <UpdateBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* v0.32.0 설정탭 UX(Vance) B4 — 생성 완료 후 다음 단계(입력탭) 이동 버튼. 자동 탭 전환은
            하지 않는다(민구 확정) — 사용자가 버튼으로 명시 이동. */}
        {tab === 'settings' && <SettingsScreen onNavigateToInput={() => changeTab('voice')} />}
        {/* v0.33.0 항목4 [STT-16] — keep-alive 렌더: 세션이 살아 있으면 다른 탭에서도 VoiceScreen을
            display:none으로 유지(unmount 금지). 인식기·워치독·클립 레코더·onTokenSettled 구독이
            탭 전환에 인질로 잡히지 않는다(세션 상태 소유권이 컴포넌트 수명에서 분리). 세션이 없으면
            기존대로 unmount — 입력탭 첫 진입 전 마이크 prewarm(getUserMedia)이 미리 뜨지 않는다. */}
        {(tab === 'voice' || sessionLive) && (
          <div
            style={{
              display: tab === 'voice' ? 'flex' : 'none',
              flexDirection: 'column',
              flex: tab === 'voice' ? 1 : undefined,
              minHeight: 0,
            }}
          >
            <VoiceScreen />
          </div>
        )}
        {tab === 'data' && <DataScreen />}
      </div>
      <TabBar tab={tab} setTab={changeTab} />
      {/* v0.33.0 항목11 — 개선요청 모달. 현재 화면 위 오버레이(탭 인터셉트 — setTab 없음).
          전송은 submitFeedback(경량 zip + 이중 업로드/큐)이 담당, 실패도 큐로 수렴하므로
          onSubmit은 항상 resolve → 모달은 완료 후 닫힌다. */}
      {typeof feedback === 'object' && (
        <FeedbackModal
          screenshot={feedback.shot}
          onSubmit={(text) =>
            submitFeedback({
              text,
              screenshot: feedback.shot,
              context: { tab, sessionPhase: useSessionStore.getState().phase },
            }).then(() => undefined)
          }
          onClose={() => {
            setFeedback('closed');
            // v0.34.0 A2 — 닫힘 신호 → useVoiceSession 구독이 STT 재개(세션 없으면 no-op).
            useSessionStore.getState().setUiModalOpen(null);
          }}
        />
      )}
    </div>
  );
}
