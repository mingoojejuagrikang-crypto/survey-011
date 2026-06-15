/**
 * v0.8.0 WS4 — 조회 탭. 시트의 과거 조사값을 **샘플(컬럼 조합 키) 단위 시간 변화**로 보는 뷰.
 *
 * 핵심 원칙(민구 정정): 조회탭은 "각각의 샘플이 시간 경과(직전→최근)에 따라 어떻게 변하는지"를
 * 보는 탭이다. **샘플을 더하거나 평균내서 섞지 않는다(집계·합계·평균 금지).** 공통 라벨(불변 키)만
 * 상단 1회 고정해 중복을 제거하고, 그 아래는 샘플별로 고유 라벨 + 측정항목의 직전↔최근 변화를 표시.
 *
 * 데이터는 전부 pastValues(공유 인덱스)에서 온다 — 이 화면은 fetch를 직접 하지 않고
 * loadPastIndex/getCachedIndex만 쓴다(행 단위 재fetch 금지 규칙).
 *
 * 비교 기준: latestTwoRounds(index) — 인덱스 전역의 최근 2개 회차(직전→최근). 모든 샘플이 같은
 * 두 회차를 쓰고, 각 샘플은 그 두 회차에서 자기 값을 읽는다(없으면 '—'). (오늘 로컬 세션 오버레이는
 * v0.8.0에서 제거 — 시트에 업로드된 최근 회차가 "최근"을 대표한다.)
 *
 * 레이아웃(위→아래):
 *  1. 헤더: 조회 + 새로고침(force) + "HH:MM 기준 · N행" 캡션
 *  2. 경고 배너(시트 헤더 미매핑) / 중복 배지
 *  3. 접이식 설정 패널(<details>, 평소 접힘): 샘플키 컬럼 토글 + 조사시기(회차) 컬럼 select
 *  4. 회차 라벨 + 보기 토글(퍼센트 / 피봇 / 그룹) — 모두 샘플을 섞지 않는 보기 옵션
 *  5. 고정 키 카드(sticky): 범위 내 값이 불변인 키 컬럼(농가명·처리 등)을 칩으로 1회만
 *  6. 샘플 카드 목록(또는 피봇 매트릭스): 가변 키 라벨, 측정 컬럼별 직전값→최근값 + 변화(절대/%)
 *
 * 상태: 미로그인 / 시트 미설정 / 샘플키 0개(기능 비활성) / 로딩 / fetch 실패(재시도) /
 * 과거 기록 없음 — 전부 구분 렌더([LOAD-1] 교훈: "빈 목록"과 "로드 실패"를 섞지 않는다).
 *
 * 반응형: 픽셀 폰트 대신 clamp()로 portrait 스마트폰~태블릿까지 균형 유지. 가로 스크롤 0
 * (overflowX:'hidden', 측정 행은 grid). 디자인 디테일(피봇/그룹 시각 균형)은 Claude 디자인 웹 시안 후보.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Chip } from '../components/Chip';
import { useSettingsStore } from '../stores/settingsStore';
import { getAccessToken } from '../lib/googleAuth';
import { parseSpreadsheetId } from '../lib/sheets';
import { isTrendEligible, effectiveSampleKey } from '../lib/columnFlags';
import { checkAnomaly, parseNumeric } from '../lib/trendCheck';
import { isoWeek } from '../lib/isoWeek';
import {
  keyColumns,
  latestTwoRounds,
  pastValue,
  getCachedIndex,
  loadPastIndex,
  type PastIndex,
} from '../lib/pastValues';
import type { Column } from '../types';

const MONO = 'JetBrains Mono, ui-monospace, monospace';

/** 반응형 폰트 토큰(픽셀 고정 대신 clamp — portrait 스마트폰~태블릿 균형). */
const FS = {
  label: 'clamp(13px, 3.4vw, 16px)',
  value: 'clamp(15px, 4vw, 20px)',
  delta: 'clamp(12px, 3vw, 14px)',
  cardLabel: 'clamp(15px, 4.2vw, 18px)',
  small: 'clamp(12px, 3vw, 13px)',
} as const;

function fmtTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 회차 ISO → "YYYY. NN주차 (mm-dd ~ mm-dd)"(민구 v0.9.0 지시). 파싱 불가는 ISO 그대로. */
function roundLabel(iso: string | null): string {
  if (!iso) return '—';
  const w = isoWeek(iso);
  if (!w) return iso;
  const md = (s: string) => s.slice(5); // 'YYYY-MM-DD' → 'MM-DD' (toIso가 0-pad 보장)
  return `${w.year}. ${w.week}주차 (${md(w.start)} ~ ${md(w.end)})`;
}

interface SampleEntry {
  key: string;
  /** 가변 키 컬럼으로 만든 카드 라벨 (예: "조사나무 3 · 조사과실 2"). */
  label: string;
  /** 키 컬럼 값을 읽을 대표 레코드(키 값은 회차 불문 동일). */
  rec: Record<string, string>;
}

/** 인덱스에서 (불변 키 컬럼, 가변 키 컬럼, 샘플 목록)을 한 번에 유도. */
function deriveSamples(index: PastIndex, keyCols: Column[]) {
  const firstRecs: Array<{ key: string; rec: Record<string, string> }> = [];
  for (const [key, byRound] of index.samples) {
    const rec = byRound.values().next().value as Record<string, string> | undefined;
    if (rec) firstRecs.push({ key, rec });
  }
  const constant: Column[] = [];
  const variable: Column[] = [];
  for (const c of keyCols) {
    const vals = new Set(firstRecs.map((e) => (e.rec[c.id] ?? '').trim()));
    (vals.size <= 1 ? constant : variable).push(c);
  }
  const entries: SampleEntry[] = firstRecs.map(({ key, rec }) => ({
    key,
    rec,
    // 가변 키가 없으면(샘플 1개뿐) 키 전체를 라벨로 폴백.
    label:
      variable.length > 0
        ? variable.map((c) => `${c.name} ${(rec[c.id] ?? '').trim()}`).join(' · ')
        : key,
  }));
  entries.sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true }));
  return { constant, variable, entries };
}

/** 한 측정 셀의 직전→최근 변화 계산(표시 SSOT). 두 회차 값 모두 시트 인덱스에서 온다. */
interface CellChange {
  prev: string | null;
  latest: string | null;
  arrow: 'up' | 'down' | 'flat' | null;
  /** 절대 변화 표시 문자열(예 "+2.4", "−1.0", "±0"). 비교 불가면 null. */
  delta: string | null;
  /** 변동률 표시 문자열(예 "+12.5%"). prev===0이거나 비교 불가면 null. */
  pct: string | null;
  violation: boolean;
}

function computeChange(col: Column, prev: string | null, latest: string | null): CellChange {
  const decimals = col.type === 'float' ? col.decimals ?? 1 : 0;
  const prevN = parseNumeric(prev);
  const latestN = parseNumeric(latest);
  let arrow: CellChange['arrow'] = null;
  let delta: string | null = null;
  let pct: string | null = null;
  let violation = false;
  if (prevN !== null && latestN !== null) {
    const d = latestN - prevN;
    arrow = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    delta = d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(decimals)}`;
    // %변화 = (latest-prev)/|prev|*100 — prev===0 또는 subnormal prev로 인한 Infinity는
    // 계산 불가(null)로 처리해 'Infinity%' 누출을 막는다.
    if (prevN !== 0) {
      const p = (d / Math.abs(prevN)) * 100;
      if (Number.isFinite(p)) {
        pct = `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p).toFixed(1)}%`;
      }
    }
    // 위반 판정은 checkAnomaly가 SSOT — 여기서 규칙을 재구현하지 않는다(이상치 알람).
    if (isTrendEligible(col)) violation = checkAnomaly(col, prev, latest ?? '') !== null;
  }
  return { prev, latest, arrow, delta, pct, violation };
}

export function ReviewScreen() {
  const s = useSettingsStore();

  const [index, setIndex] = useState<PastIndex | null>(() => getCachedIndex());
  const [loadedAt, setLoadedAt] = useState<number | null>(() => (getCachedIndex() ? Date.now() : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const triedAutoLoad = useRef(false);

  const signedIn = s.googleConnected || !!getAccessToken();
  const configured = !!parseSpreadsheetId(s.sheetUrl) && !!s.sheetTab;
  const keyCols = useMemo(() => keyColumns(s.columns), [s.columns]);
  const canLoad = signedIn && configured && keyCols.length > 0;

  // 인덱스 구성에 영향을 주는 설정(회차 컬럼 + 샘플키/이름/타입)의 지문.
  // 접이식 표시 설정 패널에서 샘플키나 조사시기를 바꾸면 이 fp가 바뀌고, 캐시된 index는
  // 새 설정과 어긋난다(stale) → 아래 effect가 강제 재로드해 화면을 새 구성으로 갱신한다.
  // (pastValues 캐시 fp와 동일 축을 본다 — force 로드 시 캐시도 새로 빌드된다.)
  const settingsFp = useMemo(
    () =>
      JSON.stringify([
        s.roundDateColId,
        s.columns.map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
      ]),
    [s.roundDateColId, s.columns],
  );
  const firstFp = useRef(true);

  const doLoad = async (force: boolean) => {
    setLoading(true);
    setError(false);
    const idx = await loadPastIndex(force ? { force: true } : undefined);
    setLoading(false);
    if (idx) {
      setIndex(idx);
      setLoadedAt(Date.now());
    } else {
      setError(true);
    }
  };

  // 탭 진입 시 1회: 캐시가 신선하면 그대로, 아니면 자동 로드(전제 조건 충족 시에만).
  useEffect(() => {
    if (triedAutoLoad.current) return;
    triedAutoLoad.current = true;
    if (index) return;
    if (!canLoad) return;
    void doLoad(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 표시 설정(샘플키·조사시기) 변경 시 캐시가 stale → 강제 재로드. 마운트 첫 실행은
  // 위 자동 로드 effect가 담당하므로 firstFp 가드로 건너뛴다(이중 로드 방지). 의존성은 fp만 —
  // doLoad가 바꾸는 index/loading/loadedAt는 fp를 바꾸지 않으므로 재렌더 루프가 생기지 않는다.
  useEffect(() => {
    if (firstFp.current) {
      firstFp.current = false;
      return;
    }
    if (!canLoad) return;
    void doLoad(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsFp]);

  const measuredCols = useMemo(() => s.columns.filter((c) => c.input !== 'auto'), [s.columns]);
  const derived = useMemo(
    () => (index ? deriveSamples(index, keyCols) : null),
    [index, keyCols],
  );
  // 화면 전역 비교 기준: 최근 2개 회차(직전→최근). 모든 샘플이 동일한 두 회차를 쓴다(집계 아님).
  const { prev: prevRound, latest: latestRound } = useMemo(
    () => (index ? latestTwoRounds(index) : { prev: null, latest: null }),
    [index],
  );

  // date 타입 컬럼(조사시기 select 후보) — 접이 패널용.
  const dateCols = useMemo(() => s.columns.filter((c) => c.type === 'date'), [s.columns]);
  // 키 후보 컬럼(샘플키 토글 대상) = auto가 아니어도 토글 가능해야 하므로 date 제외 전체.
  const keyCandidates = useMemo(() => s.columns.filter((c) => c.type !== 'date'), [s.columns]);

  const caption = index && loadedAt ? `${fmtTime(loadedAt)} 기준 · ${index.rowCount}행` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        title="비교"
        sub="직전→최근 변화"
        right={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <button
              data-testid="review-refresh"
              aria-label="과거 조사 다시 불러오기"
              onClick={() => void doLoad(true)}
              disabled={loading || !canLoad}
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                border: `1px solid ${T.lineStrong}`,
                background: T.card,
                color: canLoad ? T.text : T.textMute,
                cursor: loading || !canLoad ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: loading || !canLoad ? 0.6 : 1,
              }}
            >
              <span
                style={{
                  display: 'flex',
                  animation: loading ? 'spin 0.9s linear infinite' : 'none',
                }}
              >
                {I.sync(18, 'currentColor')}
              </span>
            </button>
            {caption && (
              <div
                data-testid="review-caption"
                style={{ fontSize: 12, color: T.textMute, fontFamily: MONO, whiteSpace: 'nowrap' }}
              >
                {caption}
              </div>
            )}
          </div>
        }
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '0 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {!signedIn ? (
          <StateCard
            testId="review-state-signin"
            icon={I.cloud(28, T.textMute)}
            title="Google 로그인이 필요합니다"
            body="설정 탭에서 Google 로그인 후, 시트의 과거 조사값을 불러와 비교할 수 있어요."
          />
        ) : !configured ? (
          <StateCard
            testId="review-state-nosheet"
            icon={I.table(28, T.textMute)}
            title="스프레드시트가 연결되지 않았습니다"
            body="설정 탭에서 시트 주소와 탭(시트명)을 연결하면 과거 조사값을 불러옵니다."
          />
        ) : keyCols.length === 0 ? (
          <>
            {/* 데드락 방지: 샘플키 0개여도 재지정 패널을 펼친 채 노출(설정탭에서 이전됨) */}
            <SettingsPanel
              keyCandidates={keyCandidates}
              dateCols={dateCols}
              roundDateColId={s.roundDateColId}
              onToggleKey={(col, on) => s.updateColumn(col.id, { ...col, sampleKey: on })}
              onRoundDateCol={(id) => s.set({ roundDateColId: id })}
              defaultOpen
            />
            <StateCard
              testId="review-state-nokeys"
              icon={I.grip(28, T.textMute)}
              title="샘플키 항목이 없습니다"
              body={'위 “표시 설정”에서 샘플키 항목을 지정하세요.\n샘플키(예: 농가명·처리·조사나무)가 있어야 같은 샘플의 과거값을 찾을 수 있습니다.'}
            />
          </>
        ) : loading && !index ? (
          <StateCard
            testId="review-state-loading"
            icon={
              <span style={{ display: 'flex', animation: 'spin 0.9s linear infinite' }}>
                {I.sync(28, T.blue)}
              </span>
            }
            title="과거 조사값을 불러오는 중…"
            body="시트 전체를 한 번만 읽어 기기에 잠시 보관합니다."
          />
        ) : error && !index ? (
          <StateCard
            testId="review-state-error"
            icon={I.cloudOff(28, T.amber)}
            title="불러오지 못했습니다"
            body="네트워크 상태를 확인한 뒤 다시 시도하세요. 오프라인이면 연결 후 가능합니다."
            action={
              <button
                data-testid="review-retry"
                onClick={() => void doLoad(true)}
                style={{
                  height: 44,
                  padding: '0 20px',
                  borderRadius: 12,
                  border: 'none',
                  background: T.blue,
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                재시도
              </button>
            }
          />
        ) : index && derived ? (
          <>
            {/* 갱신 실패(기존 인덱스는 유지) 안내 */}
            {error && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(255,179,0,0.10)',
                  border: '1px solid rgba(255,179,0,0.30)',
                  fontSize: FS.small,
                  color: T.amber,
                }}
              >
                새로고침 실패 — 이전에 불러온 값을 표시 중입니다.
              </div>
            )}

            {/* 시트 헤더 미매핑 경고 배너 */}
            {index.unmappedColumns.length > 0 && (
              <div
                data-testid="review-banner-unmapped"
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(255,179,0,0.10)',
                  border: '1px solid rgba(255,179,0,0.30)',
                  fontSize: FS.small,
                  lineHeight: 1.5,
                  color: T.text,
                }}
              >
                <b style={{ color: T.amber }}>시트에 없는 항목:</b>{' '}
                {index.unmappedColumns.join(', ')}
                <div style={{ color: T.textDim, marginTop: 2, fontSize: 12 }}>
                  시트 헤더명과 앱 항목명이 정확히 일치해야 과거값을 찾습니다.
                </div>
              </div>
            )}

            {/* 접이식 표시 설정 패널: 샘플키 컬럼 / 조사시기 컬럼 (설정탭에서 이전) */}
            <SettingsPanel
              keyCandidates={keyCandidates}
              dateCols={dateCols}
              roundDateColId={s.roundDateColId}
              onToggleKey={(col, on) => s.updateColumn(col.id, { ...col, sampleKey: on })}
              onRoundDateCol={(id) => s.set({ roundDateColId: id })}
            />

            {/* v0.9.0 — 회차 축(직전→최근, 주차+조사일자) + 공통 키(불변, 상단 고정) */}
            <CompareHeader
              prevRound={prevRound}
              latestRound={latestRound}
              constant={derived.constant}
              rec={derived.entries[0]?.rec ?? {}}
              duplicateCount={index.duplicateCount}
            />

            {/* 샘플별 비교 표: 가변 키 앞열 + 측정값 직전/현재 뒷열(집계 없음) */}
            {derived.entries.length === 0 ? (
              <StateCard
                testId="review-state-empty"
                icon={I.search(28, T.textMute)}
                title="비교할 과거 조사 기록이 없습니다"
                body={
                  index.unmappedColumns.length > 0
                    ? '위 경고의 항목명 불일치가 원인일 수 있습니다 — 시트 헤더명을 확인하세요.'
                    : '시트에 업로드된 조사 데이터가 쌓이면 여기서 직전→최근 변화를 볼 수 있습니다.'
                }
              />
            ) : (
              <CompareTable
                entries={derived.entries}
                index={index}
                variable={derived.variable}
                measuredCols={measuredCols}
                prevRound={prevRound}
                latestRound={latestRound}
              />
            )}
          </>
        ) : (
          // 전제 조건은 충족인데 인덱스가 없는 잔여 상태(자동 로드 실패 직전 등) — 수동 로드 제공.
          <StateCard
            testId="review-state-idle"
            icon={I.search(28, T.textMute)}
            title="과거 조사값을 불러올 수 있습니다"
            body="오른쪽 위 새로고침을 누르면 시트에서 과거 조사값을 가져옵니다."
          />
        )}
      </div>
    </div>
  );
}

// ─── 접이식 표시 설정 패널 (샘플키 / 조사시기 — 설정탭에서 이전) ─────────────

function SettingsPanel({
  keyCandidates,
  dateCols,
  roundDateColId,
  onToggleKey,
  onRoundDateCol,
  defaultOpen = false,
}: {
  keyCandidates: Column[];
  dateCols: Column[];
  roundDateColId: string | null;
  onToggleKey: (col: Column, on: boolean) => void;
  onRoundDateCol: (id: string | null) => void;
  defaultOpen?: boolean;
}) {
  return (
    <details
      data-testid="review-settings-panel"
      open={defaultOpen}
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '11px 14px',
          fontSize: FS.label,
          fontWeight: 700,
          color: T.textDim,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          boxSizing: 'border-box',
        }}
      >
        <span aria-hidden style={{ color: T.textMute, display: 'flex' }}>
          {I.grip(16, 'currentColor')}
        </span>
        표시 설정 (샘플키 · 조사시기)
      </summary>

      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 샘플키 컬럼 토글 */}
        <div>
          <div style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, marginBottom: 8 }}>
            샘플키 항목 — 같은 샘플을 식별할 항목을 켜세요
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {keyCandidates.length === 0 ? (
              <span style={{ fontSize: FS.small, color: T.textMute }}>후보 항목 없음</span>
            ) : (
              keyCandidates.map((c) => {
                const on = effectiveSampleKey(c);
                return (
                  <button
                    key={c.id}
                    data-testid={`review-keycol-${c.id}`}
                    aria-pressed={on}
                    onClick={() => onToggleKey(c, !on)}
                    style={{
                      minHeight: 40,
                      padding: '0 14px',
                      borderRadius: 999,
                      border: `1px solid ${on ? T.blue : T.line}`,
                      background: on ? T.blueGlow : T.inputBg,
                      color: on ? '#BBD4FF' : T.textDim,
                      fontSize: FS.small,
                      fontWeight: on ? 700 : 600,
                      cursor: 'pointer',
                      letterSpacing: -0.1,
                    }}
                  >
                    {c.name}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 조사시기(회차) 컬럼 select */}
        <div>
          <label
            htmlFor="round-date-col"
            style={{ fontSize: FS.small, color: T.textMute, fontWeight: 700, display: 'block', marginBottom: 8 }}
          >
            조사시기(회차) 항목 — 시간 비교 기준 날짜
          </label>
          <select
            id="round-date-col"
            data-testid="round-date-col"
            value={roundDateColId ?? ''}
            onChange={(e) => onRoundDateCol(e.target.value || null)}
            style={{
              minHeight: 44,
              width: '100%',
              maxWidth: 320,
              borderRadius: 12,
              background: T.inputBg,
              border: `1px solid ${T.line}`,
              color: T.text,
              fontSize: FS.label,
              fontWeight: 600,
              outline: 'none',
              padding: '0 12px',
            }}
          >
            <option value="">자동 (조사일자 우선)</option>
            {dateCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}

// ─── 비교 헤더 (회차 축 + 공통 키, 상단 고정) ─────────────────────────────────

function CompareHeader({
  prevRound,
  latestRound,
  constant,
  rec,
  duplicateCount,
}: {
  prevRound: string | null;
  latestRound: string | null;
  constant: Column[];
  rec: Record<string, string>;
  duplicateCount: number;
}) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 5, background: T.bg, paddingBottom: 2 }}>
      <div
        data-testid="review-key-card"
        style={{
          background: T.card,
          border: `1px solid ${T.line}`,
          borderRadius: 14,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* 회차 축: 직전 → 최근 (주차 + 조사일자 기간) */}
        <div
          data-testid="review-rounds"
          style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: FS.small, color: T.textDim }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: T.textMute, fontWeight: 700, minWidth: 28 }}>직전</span>
            <span data-testid="review-round-prev" style={{ fontFamily: MONO }}>{roundLabel(prevRound)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: T.textMute, fontWeight: 700, minWidth: 28 }}>최근</span>
            <span
              data-testid="review-round-latest"
              style={{ fontFamily: MONO, color: T.text, fontWeight: 700 }}
            >
              {roundLabel(latestRound)}
            </span>
          </div>
        </div>

        {/* 공통 키(세션 내 불변) + 중복 배지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {constant.length === 0 ? (
            <span style={{ fontSize: FS.small, color: T.textMute }}>공통 키 없음</span>
          ) : (
            constant.map((c) => (
              <Chip key={c.id} strong color={T.text} bg="rgba(255,255,255,0.08)">
                <span style={{ color: T.textMute, fontWeight: 500 }}>{c.name}</span>
                {(rec[c.id] ?? '').trim()}
              </Chip>
            ))
          )}
          {duplicateCount > 0 && (
            <span
              data-testid="review-badge-duplicate"
              title="같은 샘플·같은 회차의 행이 시트에 2번 이상 있습니다. 마지막 행 값을 표시합니다."
              style={{
                marginLeft: 'auto',
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(255,179,0,0.13)',
                color: T.amber,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              중복 {duplicateCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 비교 표 (가변 키 앞열 + 측정값 직전/현재 뒷열, 집계 없음) ─────────────────

const cellBase = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function CompareTable({
  entries,
  index,
  variable,
  measuredCols,
  prevRound,
  latestRound,
}: {
  entries: SampleEntry[];
  index: PastIndex;
  variable: Column[];
  measuredCols: Column[];
  prevRound: string | null;
  latestRound: string | null;
}) {
  // 앞열 = 가변 키(샘플 라벨), 뒷열 = 측정 항목별 직전|현재 2열. 가로 스크롤 0(minmax(0,1fr) 압축).
  const template =
    `${variable.map(() => 'minmax(0, 1.2fr)').join(' ')} ` +
    `repeat(${measuredCols.length * 2}, minmax(0, 1fr))`;
  return (
    <div
      data-testid="review-table"
      role="table"
      aria-label="샘플별 직전→현재 비교 표"
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        padding: 8,
        overflowX: 'hidden',
      }}
    >
      {/* 헤더: 가변 키명(앞) + 측정 항목명(2열 span, 아래 직전/현재) */}
      <div
        role="row"
        style={{
          display: 'grid',
          gridTemplateColumns: template,
          columnGap: 4,
          alignItems: 'end',
          borderBottom: `1px solid ${T.line}`,
          paddingBottom: 4,
        }}
      >
        {variable.map((c) => (
          <span
            role="columnheader"
            key={c.id}
            style={{ ...cellBase, fontSize: FS.small, fontWeight: 700, color: T.textDim, padding: '0 2px' }}
          >
            {c.name}
          </span>
        ))}
        {measuredCols.map((c) => (
          <div role="columnheader" key={c.id} style={{ gridColumn: 'span 2', minWidth: 0 }}>
            <div
              style={{
                ...cellBase,
                fontSize: FS.small,
                fontWeight: 700,
                color: T.text,
                textAlign: 'center',
              }}
            >
              {c.name}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 4 }}>
              <span style={{ ...cellBase, fontSize: 11, color: T.textMute, fontWeight: 600, textAlign: 'center' }}>
                직전
              </span>
              <span style={{ ...cellBase, fontSize: 11, color: T.textMute, fontWeight: 600, textAlign: 'center' }}>
                현재
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 본문: 샘플 1행 (앞열 가변 키 값 + 측정 항목별 직전/현재 셀) */}
      {entries.map((e, i) => (
        <div
          role="row"
          key={e.key}
          data-testid="review-sample"
          data-key={e.key}
          style={{
            display: 'grid',
            gridTemplateColumns: template,
            columnGap: 4,
            alignItems: 'center',
            padding: '5px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${T.line}`,
            background: i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent',
          }}
        >
          {variable.map((c) => (
            <span
              role="cell"
              key={c.id}
              style={{ ...cellBase, fontSize: FS.label, fontWeight: 700, color: T.text, padding: '0 2px' }}
            >
              {(e.rec[c.id] ?? '').trim() || '—'}
            </span>
          ))}
          {measuredCols.map((col) => (
            <CompareValueCells
              key={col.id}
              col={col}
              prev={prevRound ? pastValue(index, e.key, prevRound, col.id) : null}
              latest={latestRound ? pastValue(index, e.key, latestRound, col.id) : null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 한 측정 항목의 직전/현재 2개 셀(Fragment로 표 그리드의 2열에 직접 배치). 최근 셀에 화살표·이상치
 *  강조와 testid(review-cell-<colId>)를 단다. 직전 셀은 review-prev-<colId>. */
function CompareValueCells({
  col,
  prev,
  latest,
}: {
  col: Column;
  prev: string | null;
  latest: string | null;
}) {
  const ch = computeChange(col, prev, latest);
  const arrowGlyph = ch.arrow === 'up' ? '↑' : ch.arrow === 'down' ? '↓' : '';
  const latestColor = ch.violation ? T.red : ch.latest === null ? T.textMute : T.text;
  return (
    <>
      <span
        role="cell"
        data-testid={`review-prev-${col.id}`}
        style={{
          ...cellBase,
          fontFamily: MONO,
          fontSize: FS.value,
          fontWeight: 700,
          color: ch.prev === null ? T.textMute : T.textDim,
          textAlign: 'center',
        }}
      >
        {ch.prev ?? '—'}
      </span>
      <span
        role="cell"
        data-testid={`review-cell-${col.id}`}
        data-arrow={ch.arrow ?? undefined}
        data-violation={ch.violation ? 'true' : undefined}
        style={{
          ...cellBase,
          fontFamily: MONO,
          fontSize: FS.value,
          fontWeight: 800,
          color: latestColor,
          textAlign: 'center',
          borderRadius: 6,
          background: ch.violation ? 'rgba(255,82,82,0.14)' : 'transparent',
        }}
      >
        {arrowGlyph}{ch.latest ?? '—'}
      </span>
    </>
  );
}

// ─── 상태 카드 (빈/안내/오류 공용) ───────────────────────────────────────────

function StateCard({
  testId,
  icon,
  title,
  body,
  action,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
        padding: '0 24px',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          background: T.card,
          border: `1px solid ${T.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{title}</div>
      <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
        {body}
      </div>
      {action}
    </div>
  );
}
