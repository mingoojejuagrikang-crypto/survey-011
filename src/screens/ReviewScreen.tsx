/**
 * v0.10.0 WS — 비교 탭. 시트의 과거 조사값을 **샘플(컬럼 조합 키) 단위 시간 변화**로 보는 뷰.
 *
 * 핵심 원칙(민구 확정): 비교탭은 "각 샘플이 시간 경과(baseline→target)에 따라 어떻게 변하는지"를
 * 보는 탭이다. **샘플을 더하거나 평균내서 섞지 않는다(집계·합계·평균 금지).** 공통 라벨(불변 키)만
 * 상단 1회 고정해 중복을 제거하고, 그 아래는 샘플별로 고유 라벨 + 측정항목의 baseline↔target 변화.
 *
 * v0.10.0 재설계:
 *  - AND 필터 바(차원 칩 교집합) + 회차(주차) 비교 칩(target 회차 + baseline N회차 전).
 *  - 사용자 행 선택(후보 중 표시할 행을 직접 체크, 후보 외 선택불가).
 *  - 보기 설정(그룹/측정 토글). 파생은 전부 src/lib/reviewQuery.buildReviewView(순수)가 SSOT.
 *
 * 데이터는 전부 pastValues(공유 인덱스)에서 온다 — 이 화면은 fetch를 직접 하지 않고
 * loadPastIndex/getCachedIndex만 쓴다(행 단위 재fetch 금지 규칙).
 *
 * 상태: 미로그인 / 시트 미설정 / 샘플키 0개 / 로딩 / fetch 실패 / 회차0 / baseline없음 / 필터0샘플 —
 * 전부 구분 렌더([LOAD-1] 교훈: "빈 목록"과 "로드 실패"를 섞지 않는다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useSettingsStore } from '../stores/settingsStore';
import { getAccessToken } from '../lib/googleAuth';
import { parseSpreadsheetId } from '../lib/sheets';
import { isTrendEligible, effectiveSampleKey } from '../lib/columnFlags';
import {
  keyColumns,
  getCachedIndex,
  loadPastIndex,
  type PastIndex,
} from '../lib/pastValues';
import { buildReviewView, type ReviewSettings } from '../lib/reviewQuery';
import type { Column } from '../types';
import { FS } from '../components/review/reviewShared';
import { StateCard } from '../components/review/StateCard';
import { FilterBar } from '../components/review/FilterBar';
import { FilterPickerSheet } from '../components/review/FilterPickerSheet';
import { RowSelector } from '../components/review/RowSelector';
import { GroupMeasurePanel } from '../components/review/GroupMeasurePanel';
import { KeyCard } from '../components/review/KeyCard';
import { PivotTable } from '../components/review/PivotTable';
import { SettingsPanel } from '../components/review/SettingsPanel';

const MONO = 'JetBrains Mono, ui-monospace, monospace';

function fmtTime(epoch: number): string {
  return new Date(epoch).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ReviewScreen() {
  const s = useSettingsStore();

  const [index, setIndex] = useState<PastIndex | null>(() => getCachedIndex());
  const [loadedAt, setLoadedAt] = useState<number | null>(() => (getCachedIndex() ? Date.now() : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triedAutoLoad = useRef(false);

  const signedIn = s.googleConnected || !!getAccessToken();
  const configured = !!parseSpreadsheetId(s.sheetUrl) && !!s.sheetTab;
  const keyCols = useMemo(() => keyColumns(s.columns), [s.columns]);
  const canLoad = signedIn && configured && keyCols.length > 0;

  // 인덱스 구성에 영향을 주는 설정(회차 컬럼 + 샘플키/이름/타입)의 지문.
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

  // 표시 설정(샘플키·조사시기) 변경 시 캐시가 stale → 강제 재로드 + 행 선택 리셋(후보 변동).
  useEffect(() => {
    if (firstFp.current) {
      firstFp.current = false;
      return;
    }
    if (s.reviewSelectedRows !== null) s.set({ reviewSelectedRows: null });
    if (!canLoad) return;
    void doLoad(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsFp]);

  // ── 비교 뷰 파생(순수 SSOT) ──
  const reviewSettings: ReviewSettings = {
    columns: s.columns,
    reviewFilters: s.reviewFilters,
    reviewTargetRound: s.reviewTargetRound,
    reviewBaselineBack: s.reviewBaselineBack,
    reviewGroupCols: s.reviewGroupCols,
    reviewMeasureCols: s.reviewMeasureCols,
    reviewSelectedRows: s.reviewSelectedRows,
  };
  const view = useMemo(
    () => (index ? buildReviewView(index, reviewSettings) : null),
    // 인덱스 + review 설정 + 컬럼이 바뀌면 재파생.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      index,
      s.columns,
      s.reviewFilters,
      s.reviewTargetRound,
      s.reviewBaselineBack,
      s.reviewGroupCols,
      s.reviewMeasureCols,
      s.reviewSelectedRows,
    ],
  );

  // 보기 설정 후보: 그룹=변동 키 차원(상수는 키 카드에 고정), 측정=적격 측정.
  const variableDimsAuto = useMemo(() => {
    if (!index || !view) return [] as Column[];
    return keyCols.filter((c) => {
      const vals = new Set(view.candidateRows.map((r) => (r.rec[c.id] ?? '').trim()));
      return vals.size > 1;
    });
  }, [index, view, keyCols]);
  const eligibleMeasures = useMemo(() => s.columns.filter((c) => isTrendEligible(c)), [s.columns]);
  // +필터 바텀시트의 차원 후보 = 키 컬럼(date 회차 컬럼 제외).
  const filterDimCols = useMemo(() => keyCols.filter((c) => c.type !== 'date'), [keyCols]);

  // 접이식 표시 설정(샘플키/조사시기) 패널 후보.
  const dateCols = useMemo(() => s.columns.filter((c) => c.type === 'date'), [s.columns]);
  const keyCandidates = useMemo(() => s.columns.filter((c) => c.type !== 'date'), [s.columns]);

  const caption = index && loadedAt ? `${fmtTime(loadedAt)} 기준 · ${index.rowCount}행` : null;

  // 필터/회차 변경은 후보를 바꾸므로 행 선택을 null로 리셋(스토어 자동 리셋 없음 — 호출자 책임).
  const resetRows = () => {
    if (s.reviewSelectedRows !== null) s.set({ reviewSelectedRows: null });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader
        sub="baseline→target 변화"
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
              <span style={{ display: 'flex', animation: loading ? 'spin 0.9s linear infinite' : 'none' }}>
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
            {/* 데드락 방지: 샘플키 0개여도 재지정 패널을 펼친 채 노출 */}
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
        ) : index && view ? (
          <>
            {/* 갱신 실패(기존 인덱스 유지) 안내 */}
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

            {/* AND 필터 바(차원 칩 + 회차 칩 + +필터) */}
            <FilterBar
              columns={s.columns}
              filters={s.reviewFilters}
              targetRound={view.targetRound}
              baselineRound={view.baselineRound}
              baselineBack={Math.max(1, s.reviewBaselineBack)}
              onRemoveFilter={(idx) => {
                s.set({ reviewFilters: s.reviewFilters.filter((_, i) => i !== idx) });
                resetRows();
              }}
              onClearTarget={() => {
                s.set({ reviewTargetRound: null });
                resetRows();
              }}
              onOpenPicker={() => setPickerOpen(true)}
            />

            {/* 접이식 표시 설정(샘플키/조사시기) */}
            <SettingsPanel
              keyCandidates={keyCandidates}
              dateCols={dateCols}
              roundDateColId={s.roundDateColId}
              onToggleKey={(col, on) => s.updateColumn(col.id, { ...col, sampleKey: on })}
              onRoundDateCol={(id) => s.set({ roundDateColId: id })}
            />

            {view.targetRound === null ? (
              <StateCard
                testId="review-state-norounds"
                icon={I.search(28, T.textMute)}
                title="비교할 회차가 없습니다"
                body={
                  index.unmappedColumns.length > 0
                    ? '위 경고의 항목명 불일치가 원인일 수 있습니다 — 시트 헤더명을 확인하세요.'
                    : '시트에 조사 데이터(회차)가 쌓이면 여기서 baseline→target 변화를 볼 수 있습니다.'
                }
              />
            ) : view.candidateRows.length === 0 ? (
              <StateCard
                testId="review-state-empty"
                icon={I.search(28, T.textMute)}
                title="조건에 맞는 샘플이 없습니다"
                body={
                  s.reviewFilters.length > 0
                    ? '필터 조건(AND)을 만족하는 기준 회차 샘플이 없습니다 — 필터를 줄여보세요.'
                    : '기준 회차에 업로드된 조사 데이터가 없습니다.'
                }
              />
            ) : (
              <>
                {/* 행 선택(후보 중 표시) */}
                <RowSelector
                  candidateRows={view.candidateRows}
                  rowDims={view.rowDims}
                  selected={s.reviewSelectedRows}
                  onChange={(next) => s.set({ reviewSelectedRows: next })}
                />

                {/* 보기 설정(그룹/측정 토글) */}
                <GroupMeasurePanel
                  groupColumns={variableDimsAuto}
                  measureColumns={eligibleMeasures}
                  groupSel={s.reviewGroupCols}
                  measureSel={s.reviewMeasureCols}
                  onGroupChange={(next) => s.set({ reviewGroupCols: next })}
                  onMeasureChange={(next) => s.set({ reviewMeasureCols: next })}
                />

                {/* sticky 키 카드(회차 축 + 불변 키 + 중복 배지) */}
                <KeyCard
                  targetRound={view.targetRound}
                  baselineRound={view.baselineRound}
                  baselineBack={Math.max(1, s.reviewBaselineBack)}
                  constantDims={view.constantDims}
                  rec={view.candidateRows[0]?.rec ?? {}}
                  duplicateCount={index.duplicateCount}
                />

                {view.baselineRound === null ? (
                  <StateCard
                    testId="review-state-nobaseline"
                    icon={I.search(28, T.textMute)}
                    title="비교할 이전 회차가 없습니다"
                    body={'기준 회차 앞에 비교할 회차가 부족합니다(N회차 전 없음).\n비교 칩에서 비교 대상(직전/2·3회차 전)이나 기준 회차를 조정하세요.'}
                  />
                ) : view.rows.length === 0 ? (
                  <StateCard
                    testId="review-state-norows"
                    icon={I.search(28, T.textMute)}
                    title="표시할 행이 없습니다"
                    body="위 “표시할 행”에서 보고 싶은 샘플을 선택하세요."
                  />
                ) : (
                  <PivotTable
                    rows={view.rows}
                    index={index}
                    rowDims={view.rowDims}
                    measures={view.measures}
                    targetRound={view.targetRound}
                    baselineRound={view.baselineRound}
                  />
                )}
              </>
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

      {/* +필터 바텀시트 */}
      {pickerOpen && index && (
        <FilterPickerSheet
          index={index}
          dimColumns={filterDimCols}
          rounds={index.rounds}
          targetRound={s.reviewTargetRound}
          baselineBack={Math.max(1, s.reviewBaselineBack)}
          onAddFilter={(colId, value) => {
            s.set({ reviewFilters: [...s.reviewFilters, { colId, value }] });
            resetRows();
          }}
          onSetTarget={(iso) => {
            s.set({ reviewTargetRound: iso });
            resetRows();
          }}
          onSetBaselineBack={(n) => {
            s.set({ reviewBaselineBack: n });
            resetRows();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
