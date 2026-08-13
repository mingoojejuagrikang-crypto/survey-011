import { T } from '../../tokens';
import { I } from '../icons';
import type { Column } from '../../types';
import { SettingsSummary, SummaryStatusRow } from './SettingsSummary';
import { ModalBase } from '../ModalBase';
import { getCachedIndex, getFallbackIndex, previousSurveyRound } from '../../lib/pastValues';
import { localTodayIso } from '../../lib/weekTuesday';

/**
 * v0.49.0 W3(FB-3) — 「이전 조사」 행의 3상태. 민구 원문(08-13): *"'설정요약' 팝업시 이전 조사일
 * 정보도 표기 해줄 것. 조사전 이전 조사일을 사용자가 알아야 할 경우가 있음."*
 *
 * `null`·`undefined`로 「기록 없음」과 「미확인」을 구분하지 않는다 — 호출부가 뒤바꿔 넘겨도
 * 타입이 잡아주지 못하고, 두 상태의 의미가 서로 다르기 때문이다(전자는 조회 결과, 후자는 미조회).
 */
export type PrevSurveyState =
  | { kind: 'unknown' }             // 과거값 인덱스 미로드 — 오프라인·미로그인·시트 미설정
  | { kind: 'none' }                // 인덱스는 있으나 이 세션 고정 키와 일치하는 과거 기록 0건
  | { kind: 'date'; iso: string };  // 직전 조사일(오늘 미만 최신 회차)

/** 🔴 v0.49 r2 A5(codex F4) — 「기록 없음」은 **조회 결과**일 때만 쓴다. 조회가 성립하지 않는
 *  상태(고정 키 0개·헤더 미매핑)는 「미확인」이다 — 그걸 「기록 없음」이라고 말하면 사용자가
 *  "과거 기록이 없구나"라는 **틀린 결론**을 내리고, 그 화면은 스키마를 고치기 전까지 영구 고정된다.
 *  두 상태의 판정은 `pastValues.previousSurveyRound`가 소유한다(여기서 다시 추론하지 않는다). */
function prevSurveyText(s: PrevSurveyState): string {
  if (s.kind === 'date') return s.iso;
  return s.kind === 'none' ? '기록 없음' : '미확인';
}

/**
 * 팝업을 여는 시점에 **동기로** 읽는 「이전 조사」 상태.
 *
 * 🔴 여기서 fetch하지 않는다 — 팝업 열림을 인덱스 로드가 막으면 안 된다. 프리페치가 채운 신선
 * 캐시를 보고, 없으면 IDB 영속 폴백을 본다(`trendEvaluate`와 같은 폴백 체인). 둘 다 없으면
 * 「미확인」으로 정직하게 그린다 — 재시도 nudge(`ensurePastIndex`)도 렌더 중엔 부르지 않는다.
 *
 * 기준일은 `localTodayIso` — `toISOString()`은 UTC라 KST 새벽에 하루 밀리고, strictly-< 규칙에서
 * 어제 조사분이 잘못 제외된다(농가의 아침 작업 시간대에 정확히 틀리는 값이 된다).
 */
export function readPrevSurveyState(
  columns: Column[],
  roundDateColId: string | null,
): PrevSurveyState {
  const index = getCachedIndex() ?? getFallbackIndex();
  if (!index) return { kind: 'unknown' };
  const round = previousSurveyRound(index, columns, roundDateColId, localTodayIso());
  // 조회 불가(고정 키 0개·헤더 미매핑)는 인덱스 미로드와 **같은 계열**이다 — 둘 다 「이 화면은
  // 답을 모른다」이지 「과거가 없다」가 아니다(A5). 사유 자체는 순수층이 들고 있다.
  if (round.kind === 'unqueryable') return { kind: 'unknown' };
  return round;
}

export function SettingsSummaryModal({
  googleConnected, userEmail, sheetLabel, columns, totalRows, sessionLabel,
  recognitionTolerance, ttsRate, fastRecognition, tableGenerated, generatedRows,
  prevSurvey, onClose,
}: {
  googleConnected: boolean;
  userEmail: string | null;
  sheetLabel: string | null;
  columns: Column[];
  totalRows: number;
  sessionLabel: string;
  recognitionTolerance: number;
  ttsRate: number;
  fastRecognition: boolean;
  tableGenerated: boolean;
  generatedRows: number;
  prevSurvey: PrevSurveyState;
  onClose: () => void;
}) {
  return (
    <ModalBase
      onClose={onClose}
      testid="settings-summary-modal"
      role="dialog"
      ariaModal
      ariaLabel="설정 요약"
      blur
      animation="fade-up 200ms ease-out"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="settings-summary-card"
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 480, maxHeight: '84vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>설정 요약</div>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              width: 36, height: 36, borderRadius: 18,
              border: 'none', background: 'rgba(255,255,255,0.06)',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>

        {/* v0.49.0 W3 — 「이전 조사」 행이 늘면서 375×812 무스크롤 예산(카드 maxHeight 84vh)을
            5px 초과했다. 세로 gap을 조여 회수한다(10→8 · 6→4). 무스크롤은 팝업의 계약이다. */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SummaryStatusRow
              label="Google"
              value={googleConnected ? `연결됨 · ${userEmail ?? ''}` : '미연결'}
              ok={googleConnected}
            />
            <SummaryStatusRow label="시트" value={sheetLabel ?? '미연결'} ok={!!sheetLabel} />
            <SummaryStatusRow
              label="테이블"
              value={tableGenerated ? `생성됨 · 총 ${generatedRows}행` : '미생성'}
              ok={tableGenerated}
            />
            {/* v0.49.0 W3(FB-3) — 조사 시작 전에 "직전에 언제 조사했는지"를 알아야 하는 경우가 있다.
                세션 고정 샘플키 조합 기준(pastValues.previousSurveyRound). */}
            <SummaryStatusRow
              label="이전 조사"
              value={prevSurveyText(prevSurvey)}
              ok={prevSurvey.kind === 'date'}
            />
          </div>
          <SettingsSummary columns={columns} totalRows={totalRows} sessionLabel={sessionLabel} />
          {/* 다이얼·토글 한 줄 요약(입력탭 다이얼 값 포함 — 설정을 한눈에). */}
          <div
            style={{
              textAlign: 'center', fontSize: 12, fontWeight: 700, color: T.textDim,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
            }}
          >
            인식 {Math.round(recognitionTolerance * 100)}% · 안내 {ttsRate}x · 빠른 인식 {fastRecognition ? 'ON' : 'OFF'}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}` }}>
          <button
            onClick={onClose}
            style={{
              width: '100%', height: 48, borderRadius: 14, border: 'none',
              background: T.blue, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: `0 4px 14px ${T.blueGlow}`,
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </ModalBase>
  );
}

/** 초기화 모달의 체크박스 행(44px 터치 타깃, 라벨 전체가 탭 영역). */
