/**
 * v0.7.0 B3 — 조회 탭. 시트의 과거 조사값을 샘플(컬럼 조합 키) 단위로 비교하는
 * 세로모드 비교 뷰(그리드 아님).
 *
 * 데이터는 전부 pastValues(B2 공유 인덱스)에서 온다 — 이 화면은 fetch를 직접 하지 않고
 * loadPastIndex/getCachedIndex만 쓴다(행 단위 재fetch 금지 규칙).
 *
 * 레이아웃(위→아래):
 *  1. 헤더: 조회 + 새로고침(force) + "HH:MM 기준 · N행" 캡션
 *  2. 경고 배너(시트 헤더 미매핑) / 중복 배지
 *  3. 고정 키 카드(sticky): 범위 내 값이 불변인 키 컬럼(농가명·처리 등)을 칩으로 1회만
 *  4. 범위 칩: 직전 조사 / 작기 전체(+회차 선택)
 *  5. 샘플 카드 목록: 가변 키 라벨("조사나무 3 · 조사과실 2"), 측정 컬럼별
 *     직전값+회차일, 오늘 로컬 세션 매칭 시 현재값+증감 화살표, trendRule 위반 강조
 *
 * 상태: 미로그인 / 시트 미설정 / 샘플키 0개(기능 비활성) / 로딩 / fetch 실패(재시도) /
 * 과거 기록 없음 — 전부 구분 렌더([LOAD-1] 교훈: "빈 목록"과 "로드 실패"를 섞지 않는다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Chip } from '../components/Chip';
import { useSettingsStore } from '../stores/settingsStore';
import { useDataStore } from '../stores/dataStore';
import { getAccessToken } from '../lib/googleAuth';
import { parseSpreadsheetId } from '../lib/sheets';
import { isTrendEligible } from '../lib/columnFlags';
import { checkTrend, parseNumeric } from '../lib/trendCheck';
import {
  keyColumns,
  buildSampleKey,
  previousRound,
  pastValue,
  getCachedIndex,
  loadPastIndex,
  type PastIndex,
} from '../lib/pastValues';
import type { Column } from '../types';

const MONO = 'JetBrains Mono, ui-monospace, monospace';

/** 로컬(기기) 기준 오늘 ISO — toISOString()은 UTC라 자정 부근에 하루 어긋난다. */
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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

export function ReviewScreen() {
  const s = useSettingsStore();
  const sessions = useDataStore((d) => d.sessions);

  const [index, setIndex] = useState<PastIndex | null>(() => getCachedIndex());
  const [loadedAt, setLoadedAt] = useState<number | null>(() => (getCachedIndex() ? Date.now() : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const triedAutoLoad = useRef(false);

  const signedIn = s.googleConnected || !!getAccessToken();
  const configured = !!parseSpreadsheetId(s.sheetUrl) && !!s.sheetTab;
  const keyCols = useMemo(() => keyColumns(s.columns), [s.columns]);
  const canLoad = signedIn && configured && keyCols.length > 0;

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

  const today = localTodayISO();
  const measuredCols = useMemo(() => s.columns.filter((c) => c.input !== 'auto'), [s.columns]);
  const derived = useMemo(
    () => (index ? deriveSamples(index, keyCols) : null),
    [index, keyCols],
  );

  // 오늘 로컬 세션의 현재값: 샘플키 → colId→값. 늦게 기록된 세션/행이 이긴다(오래된 것부터 덮어쓰기).
  const todayLocal = useMemo(() => {
    const map = new Map<string, Record<string, string>>();
    if (keyCols.length === 0) return map;
    for (let i = sessions.length - 1; i >= 0; i--) {
      const sess = sessions[i];
      if (sess.date !== today) continue;
      for (const row of sess.rows) {
        const k = buildSampleKey(keyCols, row.values);
        if (k) map.set(k, row.values);
      }
    }
    return map;
  }, [sessions, keyCols, today]);

  // 작기 전체 모드의 회차 선택: 기본 = 최신 회차. 인덱스 갱신으로 사라진 회차면 리셋.
  const rounds = index?.rounds ?? [];
  const roundsNewestFirst = useMemo(() => [...rounds].reverse(), [rounds]);
  const activeRound =
    selectedRound && rounds.includes(selectedRound)
      ? selectedRound
      : roundsNewestFirst[0] ?? null;

  const caption = index && loadedAt ? `${fmtTime(loadedAt)} 기준 · ${index.rowCount}행` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        title="조회"
        sub="과거 조사와 비교"
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
          <StateCard
            testId="review-state-nokeys"
            icon={I.grip(28, T.textMute)}
            title="샘플키 항목이 없습니다"
            body={'설정 탭에서 샘플키 항목을 지정하세요.\n샘플키(예: 농가명·처리·조사나무)가 있어야 같은 샘플의 과거값을 찾을 수 있습니다.'}
          />
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
                  fontSize: 13,
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
                  fontSize: 13,
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

            {/* 고정 키 카드 — 범위 내 불변 키 값(농가명·처리 등) + 중복 배지 */}
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 5,
                background: T.bg,
                paddingBottom: 2,
              }}
            >
              <div
                data-testid="review-key-card"
                style={{
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: 14,
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                {derived.constant.length === 0 ? (
                  <span style={{ fontSize: 13, color: T.textMute }}>공통 키 없음</span>
                ) : (
                  derived.constant.map((c) => (
                    <Chip key={c.id} strong color={T.text} bg="rgba(255,255,255,0.08)">
                      <span style={{ color: T.textMute, fontWeight: 500 }}>{c.name}</span>
                      {(derived.entries[0]?.rec[c.id] ?? '').trim()}
                    </Chip>
                  ))
                )}
                {index.duplicateCount > 0 && (
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
                    중복 {index.duplicateCount}
                  </span>
                )}
              </div>
            </div>

            {/* 범위 칩: 직전 조사 / 작기 전체 */}
            <div
              data-testid="review-scope"
              role="group"
              aria-label="비교 범위"
              style={{
                display: 'inline-flex',
                background: T.inputBg,
                borderRadius: 12,
                padding: 3,
                border: `1px solid ${T.line}`,
                height: 44,
                alignSelf: 'flex-start',
              }}
            >
              {(
                [
                  { id: 'prevRound', label: '직전 조사' },
                  { id: 'season', label: '작기 전체' },
                ] as const
              ).map((o) => {
                const active = s.reviewScope === o.id;
                return (
                  <button
                    key={o.id}
                    aria-pressed={active}
                    onClick={() => s.set({ reviewScope: o.id })}
                    style={{
                      border: 'none',
                      background: active ? T.blue : 'transparent',
                      color: active ? '#fff' : T.textDim,
                      fontSize: 15,
                      fontWeight: active ? 700 : 600,
                      padding: '0 18px',
                      borderRadius: 9,
                      cursor: 'pointer',
                      letterSpacing: -0.1,
                      height: '100%',
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>

            {/* 작기 전체: 회차 선택(최신 우선) */}
            {s.reviewScope === 'season' && rounds.length > 0 && (
              <div
                data-testid="review-round-picker"
                role="group"
                aria-label="조사 회차 선택"
                style={{
                  display: 'flex',
                  gap: 6,
                  overflowX: 'auto',
                  paddingBottom: 2,
                  flexShrink: 0,
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {roundsNewestFirst.map((r) => {
                  const active = r === activeRound;
                  return (
                    <button
                      key={r}
                      data-testid={`round-chip-${r}`}
                      aria-pressed={active}
                      onClick={() => setSelectedRound(r)}
                      style={{
                        flexShrink: 0,
                        height: 36,
                        padding: '0 13px',
                        borderRadius: 999,
                        border: `1px solid ${active ? T.blue : T.line}`,
                        background: active ? T.blueGlow : T.card,
                        color: active ? '#BBD4FF' : T.textDim,
                        fontSize: 13,
                        fontWeight: active ? 700 : 500,
                        fontFamily: MONO,
                        cursor: 'pointer',
                      }}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 샘플 카드 목록 */}
            {derived.entries.length === 0 ? (
              <StateCard
                testId="review-state-empty"
                icon={I.search(28, T.textMute)}
                title="비교할 과거 조사 기록이 없습니다"
                body={
                  index.unmappedColumns.length > 0
                    ? '위 경고의 항목명 불일치가 원인일 수 있습니다 — 시트 헤더명을 확인하세요.'
                    : '시트에 업로드된 조사 데이터가 쌓이면 여기서 회차별로 비교할 수 있습니다.'
                }
              />
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {derived.entries.map((e) => (
                  <SampleCard
                    key={e.key}
                    entry={e}
                    index={index}
                    measuredCols={measuredCols}
                    scope={s.reviewScope}
                    activeRound={activeRound}
                    today={today}
                    current={todayLocal.get(e.key)}
                  />
                ))}
              </ul>
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

// ─── 샘플 카드 ─────────────────────────────────────────────────────────────

function SampleCard({
  entry,
  index,
  measuredCols,
  scope,
  activeRound,
  today,
  current,
}: {
  entry: SampleEntry;
  index: PastIndex;
  measuredCols: Column[];
  scope: 'prevRound' | 'season';
  activeRound: string | null;
  today: string;
  current?: Record<string, string>;
}) {
  const prev = scope === 'prevRound' ? previousRound(index, entry.key, today) : null;
  const round = scope === 'prevRound' ? prev : activeRound;

  return (
    <li
      data-testid="review-sample"
      data-key={entry.key}
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: T.text,
          letterSpacing: -0.2,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{entry.label}</span>
        {scope === 'prevRound' && (
          <span style={{ fontSize: 12, fontWeight: 500, color: T.textMute, fontFamily: MONO }}>
            {prev ?? '직전 기록 없음'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {measuredCols.map((col) => (
          <MeasureRow
            key={col.id}
            col={col}
            past={round ? pastValue(index, entry.key, round, col.id) : null}
            cur={scope === 'prevRound' ? current?.[col.id] : undefined}
            comparable={scope === 'prevRound'}
          />
        ))}
      </div>
    </li>
  );
}

/**
 * 측정 컬럼 한 줄: 과거값 (+ 오늘 현재값 → 증감 화살표 / trendRule 위반 강조).
 * 위반 판정은 B4 추세 검증과 동일 규칙 — 허용 오차 없음, 같음은 통과(isTrendEligible + trendRule).
 */
function MeasureRow({
  col,
  past,
  cur,
  comparable,
}: {
  col: Column;
  past: string | null;
  cur: string | undefined;
  comparable: boolean;
}) {
  const curTrim = (cur ?? '').trim();
  const pastN = parseNumeric(past);
  const curN = parseNumeric(curTrim);
  const decimals = col.type === 'float' ? col.decimals ?? 1 : 0;

  let arrow: 'up' | 'down' | 'flat' | null = null;
  let delta: string | null = null;
  let violation = false;
  if (comparable && pastN !== null && curN !== null) {
    const d = curN - pastN;
    arrow = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    delta = d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(decimals)}`;
    // 위반 판정은 B4 checkTrend가 SSOT — 여기서 규칙을 재구현하지 않는다.
    if (isTrendEligible(col)) violation = checkTrend(col.trendRule, past, curTrim) !== null;
  }
  const arrowGlyph = arrow === 'up' ? '↑' : arrow === 'down' ? '↓' : arrow === 'flat' ? '→' : '';
  const deltaColor = violation ? T.red : col.trendRule && arrow ? T.green : T.textDim;

  return (
    <div
      data-testid={`review-cell-${col.id}`}
      data-arrow={arrow ?? undefined}
      data-violation={violation ? 'true' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        borderRadius: 9,
        background: violation ? 'rgba(255,82,82,0.10)' : T.cardAlt,
        border: violation ? '1px solid rgba(255,82,82,0.40)' : '1px solid transparent',
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: T.textDim,
          fontWeight: 600,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {col.name}
      </span>

      {/* 과거값 */}
      <span
        style={{
          fontSize: 15,
          fontWeight: 700,
          fontFamily: MONO,
          color: past === null ? T.textMute : T.text,
        }}
      >
        {past ?? '—'}
      </span>

      {/* 오늘 현재값 + 증감 (직전 조사 모드에서 로컬 세션 매칭 시) */}
      {comparable && curTrim !== '' && (
        <>
          <span aria-hidden style={{ color: T.textMute, fontSize: 13 }}>→</span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 800,
              fontFamily: MONO,
              color: violation ? T.red : T.text,
            }}
          >
            {curTrim}
          </span>
          {delta && (
            <span
              aria-label={
                violation
                  ? `${col.name} 추세 위반: 직전 ${past}에서 ${curTrim}`
                  : `${col.name} 직전 대비 ${delta}`
              }
              style={{
                fontSize: 12,
                fontWeight: 800,
                fontFamily: MONO,
                color: deltaColor,
                background: violation ? 'rgba(255,82,82,0.14)' : 'rgba(255,255,255,0.05)',
                padding: '2px 7px',
                borderRadius: 999,
                whiteSpace: 'nowrap',
              }}
            >
              {arrowGlyph} {delta}
            </span>
          )}
        </>
      )}
    </div>
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
