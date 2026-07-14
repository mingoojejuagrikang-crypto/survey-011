import { useEffect, useState } from 'react';
import { T, TYPE_LABELS, TYPE_COLORS } from '../tokens';
import { I, AuthMark } from '../components/icons';
import { Chip } from '../components/Chip';
import { ScreenHeader } from '../components/ScreenHeader';
import { makeSettingsDefaults, useSettingsStore } from '../stores/settingsStore';
import { saveSheetsRecord, deletePastIndexBackup } from '../lib/db';
import { prefetchPastIndex, resetPastIndexRetries } from '../lib/pastValues';
import { ConnectionStatusCard } from '../components/ConnectionStatusCard';
import type { Column, DataType } from '../types';
import {
  getCurrentEmail,
  getStoredToken,
  isConfigured as isGoogleConfigured,
  onTokenSettled,
  signIn as googleSignIn,
  signOut as googleSignOut,
  warmupGoogleAuth,
} from '../lib/googleAuth';
import {
  fetchHeaderAndSample,
  fetchSpreadsheetMeta,
  fetchColumnUniqueValues,
  inferColumns,
  preserveInferredColumnIds,
  parseSpreadsheetId,
  readonlySheetsAuth,
} from '../lib/sheets';
import { computeTotalRows, nestedAutoValue, buildCyclingValues, autoValue } from '../lib/autoValue';
import { buildSessionLabel, sessionConstantValue } from '../lib/sessionLabel';
import { getPickerApiKey, openDrivePicker } from '../lib/drivePicker';
import { getAccessToken } from '../lib/googleAuth';
import { getKoreanVoices, refreshVoices, setPreferredVoiceName, speak, warmupTts } from '../lib/speech';
import { previewBeep } from '../lib/beep';
import { BEEP_VARIANTS, type BeepPolarity } from '../lib/beepVariants';
import { logger } from '../lib/logger';
import { isTrendEligible } from '../lib/columnFlags';
import { usePwaUpdate, applyUpdate, checkForUpdateNow } from '../lib/pwaUpdate';
import { HelpButton, SettingsHelpModal } from '../components/settings/SettingsHelp';
import { COLUMN_HELP, DATA_TYPE_HELP, FIRST_ENTRY_TIP, SETTINGS_TIP_SEEN_KEY } from '../components/settings/helpCopy';

const TYPE_ORDER: DataType[] = ['date', 'text', 'int', 'float', 'options'];

/** 단일 컬럼에서 세션명 접미사로 쓸 값을 뽑는다(fixed 값 또는 단일 선택 옵션). 없으면 ''.
 *  명시 선택(pickedCol) 경로 전용 — 사용자가 세션명 컬럼을 직접 고른 경우 그 컬럼의 값을 그대로 쓴다. */
function colSessionValue(col: Column): string {
  if (col.auto.kind === 'fixed') return col.auto.value;
  if (col.auto.kind === 'options' && col.auto.selected.length === 1) return col.auto.selected[0];
  return '';
}

/**
 * 세션명 접미사로 쓸 값을 고른다.
 *  - 명시 선택(pickedCol): 그 컬럼 하나의 값(사용자 수동 선택 보존).
 *  - 자동(pickedCol 없음): **세션 상수**(농가명/라벨/처리 등 행마다 안 바뀌는 유효 자동입력값)를 전부
 *    공백 join한다. v0.22.0 — 판정을 `sessionLabel.sessionConstantValue`(SSOT)로 통일했다. 이로써
 *    기존에 누락되던 **단일선택 options 컬럼(라벨=[A] 등)**까지 포함된다(`2026-06-25 강남호 A`).
 *    이전 구현은 `auto.kind==='fixed'`만 봐 단일선택 options를 놓쳤다(P2 근인).
 */
function pickSessionLabelValue(columns: Column[], pickedCol: Column | null | undefined): string {
  if (pickedCol) return colSessionValue(pickedCol);
  return columns.map(sessionConstantValue).filter(Boolean).join(' ');
}

/** v0.18.0 1f — 설정 footer의 수동 업데이트 컨트롤. 새 SW 대기 중이면 "새로고침"(즉시 적용),
 *  아니면 "업데이트 확인"(능동 체크 → 새 버전 있으면 배너가 뜸). standalone에서 사용자가 직접
 *  새 버전을 반영하는 경로. 강제 리로드는 없다(적용은 탭 시에만). */
function UpdateControl() {
  const { needRefresh } = usePwaUpdate();
  const [checking, setChecking] = useState(false);
  const [checkedNoUpdate, setCheckedNoUpdate] = useState(false);

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {needRefresh ? (
        <button
          type="button"
          onClick={() => void applyUpdate()}
          style={{
            minHeight: 40, padding: '0 18px', borderRadius: 999,
            border: 'none', background: T.blue, color: '#fff',
            fontSize: 14, fontWeight: 800, letterSpacing: -0.2, cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          ✨ 새 버전으로 새로고침
        </button>
      ) : (
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            setCheckedNoUpdate(false);
            checkForUpdateNow();
            // 능동 체크는 비동기 — 새 SW가 곧 onNeedRefresh로 needRefresh를 켜면 위 분기로 전환된다.
            // 짧은 유예 후에도 needRefresh가 안 켜지면 "최신 버전" 안내를 보인다(no-op 피드백).
            window.setTimeout(() => {
              setChecking(false);
              setCheckedNoUpdate(true);
            }, 1800);
          }}
          style={{
            minHeight: 40, padding: '0 18px', borderRadius: 999,
            border: `1px solid ${T.lineStrong}`, background: 'transparent', color: T.textDim,
            fontSize: 14, fontWeight: 700, letterSpacing: -0.2,
            cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.6 : 1,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {checking ? '확인 중…' : '업데이트 확인'}
        </button>
      )}
      {checkedNoUpdate && !needRefresh && (
        <span style={{ fontSize: 12, color: T.textMute, fontFamily: 'system-ui, sans-serif' }}>
          최신 버전입니다
        </span>
      )}
    </div>
  );
}

// ─── small UI atoms ────────────────────────────────────────────
function MiniInput({
  value, onChange, placeholder, wide,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: wide ? 100 : 56, height: 36, borderRadius: 8,
        background: T.inputBg, border: `1px solid ${T.line}`,
        color: T.text, fontSize: 15, fontWeight: 600,
        textAlign: 'center', outline: 'none', padding: '0 6px',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      }}
    />
  );
}

/** v0.23.0 설정탭#2(Vance) — SegmentToggle의 선두 라벨 스타일 SSOT. 자동값 행("입력값") 라벨이
 *  입력방식/음성확인 행 라벨과 같은 폭·톤으로 정렬되도록 공유한다. */
const ROW_LABEL_STYLE = { fontSize: 12, color: T.textMute, fontWeight: 700, letterSpacing: 0.4 } as const;

function SegmentToggle<V extends string>({
  label, value, options, onChange, disabled, testId,
}: {
  label: string;
  value: V;
  options: { id: V; label: string }[];
  onChange: (v: V) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* v0.23.0 — label="" 이면 라벨 span 생략(날짜 토글은 "입력값" 선두 라벨 아래라 자체 라벨 불필요). */}
      {label !== '' && (
        <span style={ROW_LABEL_STYLE}>
          {label}
        </span>
      )}
      <div
        style={{
          display: 'inline-flex', background: T.inputBg, borderRadius: 10,
          padding: 3, border: `1px solid ${T.line}`, height: 36,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => !disabled && onChange(o.id)}
              style={{
                border: 'none', background: active ? T.blue : 'transparent',
                color: active ? '#fff' : T.textDim,
                fontSize: 14, fontWeight: active ? 700 : 600,
                padding: '0 14px', borderRadius: 8,
                cursor: disabled ? 'not-allowed' : 'pointer',
                letterSpacing: -0.1, height: '100%', whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── auto detail panels ────────────────────────────────────────
function AutoDetail({ col, onChange }: { col: Column; onChange: (c: Column) => void }) {
  // v0.21.0 설정탭#1 — 정수(int): 단일/순차 선택 + 순차 from~to 인라인 입력은 ColumnCard의
  //   "생성방식" 칩 행으로 일원화됐다(음성확인 아래줄). 따라서 여기 int 분기는 '단일값'일 때의
  //   값 입력만 담당한다(seq는 칩 행에서 from~to 노출).
  // v0.23.0 설정탭#2(Vance) — 내부 "단일값" span 제거. 선두 라벨 "입력값"(ColumnCard 자동값 행)이
  //   라벨 역할을 대신하므로 중복을 없앤다(int+seq는 wrapper에서 이미 제외 — 여기 도달 시 fixed).
  if (col.type === 'int') {
    if (col.auto.kind === 'seq') return null; // seq의 from~to는 ColumnCard 칩 행에서 노출
    return (
      <MiniInput
        value={col.auto.kind === 'fixed' ? col.auto.value : ''}
        placeholder="값"
        onChange={(v) => onChange({ ...col, auto: { kind: 'fixed', value: v } })}
        wide
      />
    );
  }

  // v0.21.0 설정탭#1 — 소수(float)는 자동입력 시 단일 고정값만 지원(순차 칩은 int 전용 spec).
  //   기존 int|float 공통 분기에서 float의 순차 토글을 의도적으로 제거 — 자동 float은 고정값 입력만.
  if (col.type === 'float') {
    return (
      <MiniInput
        value={col.auto.kind === 'fixed' ? col.auto.value : ''}
        placeholder="값"
        onChange={(v) => onChange({ ...col, auto: { kind: 'fixed', value: v } })}
        wide
      />
    );
  }

  // date type — v0.23.0 설정탭#3(Vance): 라디오 2개를 SegmentToggle(칩 하이라이트, 오늘|지정)로 교체.
  //   '지정' 선택 시 <input type="date">를 노출(기존 로직 유지). '오늘' 미리보기({autoValue(col,1)})
  //   보존. 모델은 그대로 auto:{kind:'fixed', value:'오늘' | 'YYYY-MM-DD'}. 결과: `입력값 [오늘] 지정 2026-06-26`.
  if (col.type === 'date') {
    const isToday = col.auto.kind !== 'fixed' || col.auto.value === '오늘' || col.auto.value === '';
    const todayPreview = isToday ? autoValue(col, 1) : '';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
        <SegmentToggle
          testId={`date-mode-${col.id}`}
          label=""
          value={isToday ? 'today' : 'fixed'}
          options={[
            { id: 'today', label: '오늘' },
            { id: 'fixed', label: '지정' },
          ]}
          onChange={(v) => {
            if (v === 'today') {
              if (isToday) return; // 이미 오늘 — no-op
              onChange({ ...col, auto: { kind: 'fixed', value: '오늘' } });
            } else {
              if (!isToday) return; // 이미 지정 — no-op
              const today = new Date().toISOString().slice(0, 10);
              onChange({ ...col, auto: { kind: 'fixed', value: today } });
            }
          }}
        />
        {isToday ? (
          // '오늘' 선택 시 실제 치환될 날짜 미리보기(muted). autoValue(col,1)로 ISO 변환(새 로직 없음).
          todayPreview && (
            <span style={{ fontSize: 13, color: T.textMute, fontWeight: 600, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
              {todayPreview}
            </span>
          )
        ) : (
          <input
            type="date"
            data-testid={`date-picker-${col.id}`}
            value={col.auto.kind === 'fixed' ? col.auto.value : ''}
            onChange={(e) => onChange({ ...col, auto: { kind: 'fixed', value: e.target.value } })}
            style={{
              height: 36, borderRadius: 8,
              background: T.inputBg, border: `1px solid ${T.line}`,
              color: T.text, fontSize: 15, fontWeight: 600,
              outline: 'none', padding: '0 10px',
            }}
          />
        )}
      </div>
    );
  }

  // text / name : fixed value only ('이름'은 동작상 텍스트와 동일, 라벨·세션명 픽업에만 차이)
  //   v0.23.0 설정탭#2 — 내부 "단일값" span 제거(선두 "입력값" 라벨이 대신함).
  if (col.type === 'text' || col.type === 'name') {
    return (
      <input
        type="text"
        value={col.auto.kind === 'fixed' ? col.auto.value : ''}
        placeholder="값"
        onChange={(v) => onChange({ ...col, auto: { kind: 'fixed', value: v.target.value } })}
        style={{
          flex: 1, height: 36, borderRadius: 8,
          background: T.inputBg, border: `1px solid ${T.line}`,
          color: T.text, fontSize: 15, fontWeight: 600,
          outline: 'none', padding: '0 10px', minWidth: 0,
        }}
      />
    );
  }

  // options - rendered separately
  return null;
}

// ─── options panel ─────────────────────────────────────────────
function OptionsPanel({ col, onChange }: { col: Column; onChange: (c: Column) => void }) {
  const [newOption, setNewOption] = useState('');
  if (col.auto.kind !== 'options') return null;
  const { available, selected } = col.auto;

  const toggle = (v: string) => {
    const isSel = selected.includes(v);
    const next = isSel ? selected.filter((x) => x !== v) : [...selected, v];
    onChange({ ...col, auto: { kind: 'options', available, selected: next } });
  };

  const addOption = () => {
    const v = newOption.trim();
    if (!v) return;
    if (available.includes(v)) {
      // already exists, just select
      if (!selected.includes(v))
        onChange({ ...col, auto: { kind: 'options', available, selected: [...selected, v] } });
    } else {
      onChange({
        ...col,
        auto: { kind: 'options', available: [...available, v], selected: [...selected, v] },
      });
    }
    setNewOption('');
  };

  return (
    <div
      style={{
        marginTop: 4,
        padding: '10px 12px',
        background: T.inputBg,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, letterSpacing: 0.4 }}>
          선택값 · {selected.length} / {available.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
        {available.length === 0 && (
          <span style={{ fontSize: 12, color: T.textMute, fontStyle: 'italic' }}>
            등록된 값이 없습니다. 아래에서 추가하세요.
          </span>
        )}
        {available.map((v) => {
          const sel = selected.includes(v);
          // 선택 순번(1부터) = 터치 순서 = 행별 자동입력 순서(auto.selected 순서를 autoValue가 소비).
          const order = sel ? selected.indexOf(v) + 1 : 0;
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              aria-pressed={sel}
              aria-label={
                sel
                  ? `${v}, 선택됨 · 자동 입력 ${order}번째. 누르면 해제`
                  : `${v}, 누르면 선택`
              }
              data-testid={`opt-chip-${col.id}-${v}`}
              style={{
                border: `1px solid ${sel ? T.blue : T.line}`,
                background: sel ? T.blueGlow : 'rgba(255,255,255,0.04)',
                color: sel ? T.text : T.textDim,
                fontSize: 14, fontWeight: 700,
                // 선택 시 좌측 뱃지 공간 확보(왼쪽 패딩 축소).
                padding: sel ? '6px 12px 6px 6px' : '8px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {sel ? (
                <span
                  aria-hidden="true"
                  data-testid={`opt-badge-${col.id}-${v}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: '50%',
                    background: T.blue, color: '#fff',
                    fontSize: 13, fontWeight: 800, lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {order}
                </span>
              ) : null}
              {v}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption();
            }
          }}
          placeholder="새 값 입력"
          style={{
            flex: 1, height: 36, borderRadius: 8,
            background: T.bg, border: `1px solid ${T.line}`,
            color: T.text, fontSize: 14, fontWeight: 600,
            outline: 'none', padding: '0 10px', minWidth: 0,
          }}
        />
        <button
          onClick={addOption}
          style={{
            height: 36, padding: '0 14px', borderRadius: 8,
            border: 'none', background: T.blue, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          + 추가
        </button>
      </div>
    </div>
  );
}

// ─── column card ───────────────────────────────────────────────
function ColumnCard({
  col,
  index,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  col: Column;
  index: number;
  onChange: (c: Column) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const typ = TYPE_COLORS[col.type];
  return (
    <div
      data-testid={`col-card-${col.id}`}
      style={{
        background: T.card,
        borderRadius: 14,
        border: `1px solid ${T.line}`,
        padding: '10px 12px 10px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
        transition: 'border 150ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            width: 32,
            alignItems: 'center',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={isFirst}
            style={{
              width: 28, height: 24, borderRadius: 6,
              border: `1px solid ${isFirst ? 'transparent' : T.line}`,
              background: isFirst ? 'transparent' : 'rgba(255,255,255,0.06)',
              color: isFirst ? T.textMute : T.text,
              fontSize: 12, fontWeight: 700,
              cursor: isFirst ? 'default' : 'pointer',
              opacity: isFirst ? 0.25 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity 150ms, background 150ms',
            }}
          >▲</button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={isLast}
            style={{
              width: 28, height: 24, borderRadius: 6,
              border: `1px solid ${isLast ? 'transparent' : T.line}`,
              background: isLast ? 'transparent' : 'rgba(255,255,255,0.06)',
              color: isLast ? T.textMute : T.text,
              fontSize: 12, fontWeight: 700,
              cursor: isLast ? 'default' : 'pointer',
              opacity: isLast ? 0.25 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'opacity 150ms, background 150ms',
            }}
          >▼</button>
        </div>
        <input
          value={col.name}
          onChange={(e) => onChange({ ...col, name: e.target.value })}
          style={{
            flex: 1, background: 'transparent', border: 'none',
            color: T.text, fontSize: 18, fontWeight: 700, outline: 'none',
            letterSpacing: -0.2, padding: '2px 2px', minWidth: 0,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textMute, letterSpacing: 0.2 }}>
          데이터 타입
        </span>
        <button
          data-testid={`type-btn-${col.id}`}
          style={{
            height: 32, borderRadius: 999, padding: '0 12px',
            border: 'none', background: typ.bg, color: typ.fg,
            fontSize: 14, fontWeight: 700, letterSpacing: 0.1,
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
          }}
          title="탭하여 데이터형 변경"
          onClick={() => {
            const next = TYPE_ORDER[(TYPE_ORDER.indexOf(col.type) + 1) % TYPE_ORDER.length];
            // When switching to options, init shape
            const auto =
              next === 'options'
                ? { kind: 'options' as const, available: [], selected: [] }
                : { kind: 'fixed' as const, value: '' };
            onChange({ ...col, type: next, auto });
          }}
        >
          {TYPE_LABELS[col.type]} {I.chevDown(12, typ.fg)}
        </button>
        <button
          onClick={onRemove}
          style={{
            width: 36, height: 36, borderRadius: 10,
            border: 'none', background: 'rgba(255,82,82,0.10)',
            color: T.red, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="항목 삭제"
        >
          {I.trash(16, T.red)}
        </button>
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 32,
          minHeight: 36, flexWrap: 'wrap',
        }}
      >
        <SegmentToggle
          label="입력방식"
          value={col.input}
          options={[
            { id: 'auto', label: '자동' },
            { id: 'voice', label: '음성' },
            { id: 'touch', label: '수동' },
          ]}
          onChange={(v) => {
            const updates: Partial<typeof col> = { input: v };
            if (v === 'voice') updates.ttsAnnounce = true;
            if (v === 'touch') updates.ttsAnnounce = false;
            onChange({ ...col, ...updates });
          }}
        />
        <SegmentToggle
          label="음성확인"
          value={col.ttsAnnounce ? 'on' : 'off'}
          options={[
            { id: 'on', label: '유' },
            { id: 'off', label: '무' },
          ]}
          onChange={(v) => {
            if (col.input === 'voice') return;
            onChange({ ...col, ttsAnnounce: v === 'on' });
          }}
          disabled={col.input === 'voice'}
        />
        {/* v0.8.0 — 샘플키 토글은 조회탭으로 이전(WS4). 자동 유추·effectiveSampleKey 로직은 유지. */}
        {/* v0.8.0 — 이상치 알람(의미 반전: 증가=커지면 알람, 감소=작아지면 알람). 적격(사용자 입력
            숫자) 컬럼만 노출; 부적격 전환 시 store가 trendRule/pctThreshold 클리어. */}
        {isTrendEligible(col) && (
          <>
            <SegmentToggle
              label="추세 알람"
              testId={`trend-rule-${col.id}`}
              value={col.trendRule ?? 'off'}
              options={[
                { id: 'off', label: '없음' },
                { id: 'increase', label: '증가' },
                { id: 'decrease', label: '감소' },
              ]}
              onChange={(v) =>
                onChange({ ...col, trendRule: v === 'off' ? undefined : v })
              }
            />
            {/* v0.23.0 설정탭#4(Vance) — 인라인 추세 설명을 카드 `?` 도움말 팝업(COLUMN_HELP)으로
                이전. 화면 밀도를 낮추고(장갑·소음 현장 가독), 설명은 필요할 때만 팝업으로 본다. */}
            {/* v0.8.0 — 변동률 % 임계값(방향 무관). 빈 값=undefined(off), 값 입력 시에만 활성. */}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.textDim }}
            >
              이상값 범위
              {/* v0.23.0 설정탭#1(Vance) — 단위 "%"를 입력칸 옆에 **항상** 보이게(placeholder만으론
                  값 입력 시 사라져 단위가 안 보였다). 입력칸과 % 접미를 한 묶음으로 감싸 정렬 유지. */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  data-testid={`pct-threshold-${col.id}`}
                  placeholder="선택"
                  value={col.pctThreshold ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const n = raw === '' ? undefined : Number(raw);
                    onChange({
                      ...col,
                      pctThreshold: n === undefined || !Number.isFinite(n) ? undefined : n,
                    });
                  }}
                  style={{
                    width: 76, height: 32, borderRadius: 8,
                    background: T.inputBg, border: `1px solid ${T.line}`,
                    color: T.text, fontSize: 14, fontWeight: 600,
                    padding: '0 8px', outline: 'none',
                  }}
                />
                <span
                  data-testid={`pct-unit-${col.id}`}
                  aria-hidden
                  style={{ fontSize: 14, fontWeight: 800, color: T.textDim }}
                >
                  %
                </span>
              </span>
            </label>
          </>
        )}
      </div>

      {/* v0.21.0 설정탭#1 — 단일/순차 선택 일원화. 자동입력+정수 컬럼에서 "음성확인" 행 아래줄에
          칩 하이라이트(SegmentToggle, 선택된 칩 강조)로 단일값/순차값을 고른다. 순차값 선택 시
          그 자리(아래)에 from~to 인라인 입력을 노출. updateColumn(settingsStore)의 isCycling 전이
          시 ttsAnnounce 자동 토글을 보존하려, onChange는 auto.kind만 바꾸고 ttsAnnounce는 건드리지
          않는다(fixed↔seq 전이를 store가 감지해 음성확인을 자동 조정). int 전용(spec). */}
      {col.input === 'auto' && col.type === 'int' && (col.auto.kind === 'seq' || col.auto.kind === 'fixed') && (
        <div
          data-testid={`seq-fixed-${col.id}`}
          style={{ paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
        >
          <SegmentToggle
            label="생성방식"
            value={col.auto.kind === 'seq' ? 'seq' : 'fixed'}
            options={[
              { id: 'fixed', label: '단일값' },
              { id: 'seq', label: '순차값' },
            ]}
            onChange={(v) => {
              if (v === 'seq') {
                if (col.auto.kind === 'seq') return; // 이미 순차 — no-op
                onChange({ ...col, auto: { kind: 'seq', from: 1, to: 50 } });
              } else {
                if (col.auto.kind === 'fixed') return; // 이미 단일 — no-op
                onChange({ ...col, auto: { kind: 'fixed', value: '' } });
              }
            }}
          />
          {col.auto.kind === 'seq' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: T.textMute }}>시작</span>
              <MiniInput
                value={col.auto.from}
                onChange={(v) =>
                  onChange({
                    ...col,
                    auto: { kind: 'seq', from: +v || 0, to: col.auto.kind === 'seq' ? col.auto.to : 0 },
                  })
                }
              />
              <span style={{ color: T.textMute, fontSize: 14 }}>~</span>
              <span style={{ fontSize: 13, color: T.textMute }}>끝</span>
              <MiniInput
                value={col.auto.to}
                onChange={(v) =>
                  onChange({
                    ...col,
                    auto: { kind: 'seq', from: col.auto.kind === 'seq' ? col.auto.from : 0, to: +v || 0 },
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {/* v0.23.0 설정탭#2(Vance) — 자동값 행에 선두 라벨 "입력값"을 추가해 입력방식·음성확인 행과
          정렬한다(이전엔 "단일값" span/무라벨로 3행이 어긋남). int+seq는 생성방식 칩 행에서 from~to를
          이미 보이고 AutoDetail이 null을 반환하므로 이 행 자체를 그린다(라벨만 남아 빈 행이 되지 않게
          AutoDetail이 콘텐츠를 갖는 분기에서만 노출 — int+seq는 건너뜀). */}
      {col.input === 'auto' && col.type !== 'options' && !(col.type === 'int' && col.auto.kind === 'seq') && (
        <div
          data-testid={`auto-value-row-${col.id}`}
          style={{ paddingLeft: 32, display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, flexWrap: 'wrap' }}
        >
          <span style={ROW_LABEL_STYLE}>입력값</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <AutoDetail col={col} onChange={onChange} />
          </div>
        </div>
      )}

      {col.type === 'options' && (
        <div style={{ paddingLeft: 32 }}>
          <OptionsPanel col={col} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ─── TTS voice selector ────────────────────────────────────────
function TtsVoiceSelector() {
  const s = useSettingsStore();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // ko-voice count observed by the LAST manual refresh — null until the button is used.
  // Drives the "iOS 플랫폼 제약" notice: only after the user explicitly refreshed and the
  // list is still thin do we surface the platform-limitation explanation.
  const [lastRefreshKo, setLastRefreshKo] = useState<number | null>(null);

  useEffect(() => {
    // v0.5.0 W1: re-poll getVoices() on mount AND whenever the app returns to foreground —
    // iOS Safari materializes newly-downloaded voices lazily, often only after the app
    // regains visibility (user installs a voice in 설정 → switches back to the PWA).
    const refresh = () => {
      refreshVoices();
      setVoices(getKoreanVoices());
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Sync preferred voice name into the speech module whenever it changes
  useEffect(() => {
    setPreferredVoiceName(s.preferredVoiceName);
  }, [s.preferredVoiceName]);

  // 음성 새로고침: warmupTts()는 사용자 제스처 안에서 엔진을 깨워 iOS가 음성 목록을
  // 채우도록 자극한다 → 300ms 뒤 재조회. (즉답이 아닌 이유: getVoices()가 warmup 직후
  // 비동기로 채워지는 iOS 동작 보호.)
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      warmupTts();
      await new Promise((r) => setTimeout(r, 300));
      const { ko } = refreshVoices();
      setVoices(getKoreanVoices());
      setLastRefreshKo(ko);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>안내 음성</div>
        <select
          value={s.preferredVoiceName}
          onChange={(e) => {
            const name = e.target.value;
            s.set({ preferredVoiceName: name });
            setPreferredVoiceName(name);
            speak('안녕하세요, 이 음성으로 안내합니다.', { interrupt: true, rate: 1.05 });
          }}
          disabled={voices.length === 0}
          style={{
            flex: 1, maxWidth: 220, height: 36, borderRadius: 8,
            background: T.inputBg, border: `1px solid ${T.line}`,
            color: T.text, fontSize: 13, fontWeight: 600,
            padding: '0 8px', outline: 'none',
          }}
        >
          <option value="">(기본)</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>{v.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div
          aria-live="polite"
          style={{ fontSize: 12, fontWeight: 700, color: lastRefreshKo !== null ? T.text : T.textDim }}
        >
          {lastRefreshKo !== null
            ? `새로고침 완료 — 한국어 음성 ${lastRefreshKo}개 감지`
            : `한국어 음성 ${voices.length}개 감지`}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          style={{
            height: 36, padding: '0 14px', borderRadius: 8,
            background: T.inputBg, border: `1px solid ${T.lineStrong}`,
            color: T.text, fontSize: 13, fontWeight: 700,
            cursor: refreshing ? 'wait' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? '확인 중…' : '음성 새로고침'}
        </button>
      </div>
      {lastRefreshKo !== null && lastRefreshKo <= 1 && (
        <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.5 }}>
          iOS는 기본 내장 음성만 웹 앱에 제공합니다. 설정에서 추가로 내려받은 고품질·Siri 음성은
          Apple 정책상 여기 표시되지 않습니다 — 새로고침을 반복해도 목록에 나타나지 않습니다.
        </div>
      )}
      <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
        iPhone <b>설정 → 손쉬운 사용 → 음성 콘텐츠 → 음성 → 한국어</b>에서 <b>기본 음성</b>을
        선택하면 안내가 또렷해질 수 있습니다. 단, 고품질(Enhanced/Premium)·Siri 음성은 웹 앱에
        제공되지 않으므로 위 목록에는 기본 내장 음성만 나타납니다.
      </div>
    </div>
  );
}

/** v0.33.0 항목10-C(Vance) — 비프음 선택. 긍정(값 수용)/부정(이상치 알람) 각 5칩, 탭 = 미리듣기 +
 *  선택(민구 확정). 칩은 aria-pressed 토글(옵션 순번 칩 접근성 패턴), 44px 터치 타깃(장갑). */
function BeepPicker() {
  const s = useSettingsStore();
  const rows: { polarity: BeepPolarity; label: string; selectedId: string; storeKey: 'beepPositiveId' | 'beepNegativeId' }[] = [
    { polarity: 'positive', label: '확인음 (값 저장)', selectedId: s.beepPositiveId, storeKey: 'beepPositiveId' },
    { polarity: 'negative', label: '경고음 (이상치)', selectedId: s.beepNegativeId, storeKey: 'beepNegativeId' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }} data-testid="beep-picker">
      {rows.map((row) => (
        <div key={row.polarity} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>{row.label}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {BEEP_VARIANTS.filter((v) => v.polarity === row.polarity).map((v) => {
              const active = row.selectedId === v.id;
              return (
                <button
                  key={v.id}
                  data-testid={`beep-chip-${v.id}`}
                  aria-pressed={active}
                  aria-label={`${row.label} ${v.label}${active ? ' (선택됨)' : ''}`}
                  onClick={() => {
                    previewBeep(v); // 탭 = 즉시 미리듣기(사용자 제스처 안 — AudioContext resume 안전)
                    if (!active) {
                      s.set({ [row.storeKey]: v.id } as Partial<{ beepPositiveId: string; beepNegativeId: string }>);
                      logger.log({ type: 'app', extra: `beep_changed:${row.polarity}=${v.id}` });
                    }
                  }}
                  style={{
                    minHeight: 44, padding: '0 14px', borderRadius: 12,
                    border: `1px solid ${active ? T.blue : T.lineStrong}`,
                    background: active ? 'rgba(41,121,255,0.14)' : T.inputBg,
                    color: active ? T.blue : T.textDim,
                    fontSize: 14, fontWeight: active ? 800 : 600,
                    cursor: 'pointer', letterSpacing: -0.1,
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
        칩을 누르면 소리를 미리 들려주고 그 소리로 선택됩니다. 확인음은 값이 저장될 때,
        경고음은 이상치 알람이 뜰 때 울립니다.
      </div>
    </div>
  );
}

/** S-2: result popup for "타입 검토" — lists columns whose saved type ≠ sheet's data type. */
function TypeReviewModal({
  checked, mismatches, onApplyAll, onClose,
}: {
  checked: number;
  mismatches: { id: string; name: string; saved: DataType; sheet: DataType }[];
  onApplyAll: () => void;
  onClose: () => void;
}) {
  const ok = mismatches.length === 0;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // v0.21.0 설정탭#2 — standalone PWA safe-area(노치/상태바/홈인디케이터 침범 방지). backdrop
        //   패딩에 safe-area 변수(global.css SSOT) 흡수. Safari 탭에선 0이라 기존 24px 유지.
        paddingTop: 'max(24px, var(--sat))',
        paddingBottom: 'max(24px, var(--sab))',
        paddingLeft: 'max(24px, var(--sal))',
        paddingRight: 'max(24px, var(--sar))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360, maxHeight: '80%', overflowY: 'auto',
          background: T.card, borderRadius: 20, border: `1px solid ${T.lineStrong}`, padding: '20px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>타입 검토</div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: 16, cursor: 'pointer',
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>

        {ok ? (
          <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.6 }}>
            저장된 데이터형이 시트와 <b style={{ color: T.green }}>일치</b>합니다.
            <div style={{ fontSize: 12, color: T.textMute, marginTop: 6 }}>검토한 컬럼 {checked}개</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12, lineHeight: 1.5 }}>
              저장된 타입과 시트의 실제 데이터형이 다른 컬럼이 <b style={{ color: T.amber }}>{mismatches.length}개</b> 있습니다
              <span style={{ color: T.textMute }}> (검토 {checked}개)</span>.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mismatches.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 10, background: T.inputBg,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{m.name}</span>
                  <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: T.textMute }}>{TYPE_LABELS[m.saved]}</span>
                    <span style={{ color: T.textMute }}>→</span>
                    <span style={{ color: T.amber, fontWeight: 800 }}>{TYPE_LABELS[m.sheet]}</span>
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={onApplyAll}
              style={{
                marginTop: 16, width: '100%', height: 44, borderRadius: 12, cursor: 'pointer',
                border: 'none', background: T.blue, color: '#fff', fontSize: 15, fontWeight: 800,
              }}
            >
              시트 데이터형으로 모두 변경
            </button>
            <div style={{ fontSize: 11, color: T.textMute, textAlign: 'center', marginTop: 8 }}>
              ('리스트' 타입은 검토에서 제외됩니다)
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── screen root ───────────────────────────────────────────────
/** S-2: a column whose saved type differs from the sheet's inferred data type. */
interface TypeMismatch { id: string; name: string; saved: DataType; sheet: DataType; }

export function SettingsScreen({ onNavigateToInput }: { onNavigateToInput?: () => void } = {}) {
  const s = useSettingsStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedUrl, setConfirmedUrl] = useState<string>(s.sheetUrl);
  // v0.32.0 설정탭 UX(Vance) B2/B3 — 설정 요약 팝업 + 초기화 확인 모달(설정탭 전용).
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // S-2: result of "타입 검토" (null = not run; checked = columns compared).
  const [typeReview, setTypeReview] = useState<{ mismatches: TypeMismatch[]; checked: number } | null>(null);
  const [tablePreviewOpen, setTablePreviewOpen] = useState(false);
  // v0.19.0 W3 — "입력 테이블 생성/재생성" 클릭 시 먼저 뜨는 '최종 설정값 확인' 게이트.
  const [generateGateOpen, setGenerateGateOpen] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  // v0.14.0 F — 저장된 시트 목록을 기본 접힌 드롭다운으로(세로 풀리스트가 시트 多 시 화면 점유 과다).
  const [savedSheetsOpen, setSavedSheetsOpen] = useState(false);
  // v0.23.0 설정탭#4(Vance) — `?` 도움말 팝업 열림 여부(카드별 `?` 또는 첫 진입 안내의 "자세히").
  const [helpOpen, setHelpOpen] = useState(false);
  // v0.23.0 설정탭#4 — 첫 진입 안내 배너(1회 dismissible). "본 적 있는지"는 localStorage에 영속
  //   (settingsStore version bump 회피 — settings-migration.spec의 version===11 단정 보호). 초기값은
  //   lazy로 읽어, 이미 본 적 있으면 처음부터 숨긴다. 테스트는 fresh context라 매번 뜨므로, 이 배너는
  //   fixed 오버레이가 아니라 스크롤 영역 내부 인라인 배너 → 기존 Playwright 클릭 흐름을 막지 않는다.
  const [tipDismissed, setTipDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(SETTINGS_TIP_SEEN_KEY) === '1'; } catch { return false; }
  });
  const dismissTip = () => {
    setTipDismissed(true);
    try { localStorage.setItem(SETTINGS_TIP_SEEN_KEY, '1'); } catch { /* private mode 등 */ }
  };
  const googleConfigured = isGoogleConfigured();
  const previewRowCount = computeTotalRows(s.columns);
  const pickerAvailable = s.googleConnected && !!getPickerApiKey();

  useEffect(() => {
    const t = getStoredToken();
    if (t && !s.googleConnected) {
      s.set({ googleConnected: true, userEmail: getCurrentEmail() });
    } else if (!t && s.googleConnected) {
      // v0.13.0 R1 — 토큰 만료/소실 시 googleConnected를 강등한다. 토큰은 ~1시간이면 만료되는데
      // (refresh token 없음, [AUTH-4]) googleConnected는 통째로 persist되어 true로 재하이드레이트
      // 됐다. 그래서 UI는 '연결됨'이라 거짓 표시하지만 모든 시트 읽기/쓰기는 토큰 없음으로 실패 →
      // 사용자가 '연결이 풀렸다'고 느끼고 매번 URL을 다시 붙여넣던 혼란의 근본. 정직하게 강등해
      // '재로그인 필요'를 노출하고, 재로그인 후엔 저장 URL을 자동 재연결(아래 onGoogleClick)한다.
      // v0.34.0 계측 갭① — 토큰 소실이 '발견'되는 유일한 지점(만료는 이벤트가 아니라 상태)이라
      // 여기서 token_expired를 남긴다. googleConnected=true→false 전이에서만 오므로 로그아웃
      // 상태의 매 마운트마다 반복되지 않는다. 수동 로그아웃은 signOut('manual'|...)이 별도 로깅.
      logger.log({ type: 'app', extra: 'auth_signout:token_expired' });
      s.set({ googleConnected: false });
    }
    // S-1: preload GIS + token client so the first 로그인 click opens the popup in one shot
    // (avoids the "popup_failed_to_open" that required a second click).
    void warmupGoogleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v0.29.0 (Mack, 2026-07-07 A5 finding #1) — late-success reconciliation. signIn()'s own
  // SIGNIN_TIMEOUT_MS can fire and reject BEFORE a slow real-world 2FA flow (~60s+ observed)
  // actually completes; the onGoogleClick catch block below then shows "로그인 응답이 지연되어
  // 취소되었습니다" even though the GIS callback lands moments later with a genuine token
  // (storeToken already ran — localStorage has it). Without this subscription the UI stayed
  // wrong ("로그인 실패") until the user remounted the tab (reload / tab-away-and-back), because
  // googleConnected only re-synced from getStoredToken() at mount. Subscribing here closes that
  // gap reactively — no remount needed — using the already-existing onTokenSettled broadcast
  // (googleAuth.ts now fires it for late arrivals too, decoupled from the timed-out promise).
  useEffect(() => {
    const unsubscribe = onTokenSettled(({ email }) => {
      setError(null);
      useSettingsStore.getState().set({ googleConnected: true, userEmail: email });
    });
    return unsubscribe;
  }, []);

  const onGoogleClick = async () => {
    setError(null);
    if (s.googleConnected) {
      await googleSignOut();
      s.set({ googleConnected: false, userEmail: null });
      return;
    }
    if (!googleConfigured) {
      setError('.env.local의 VITE_GOOGLE_CLIENT_ID를 설정해주세요');
      return;
    }
    try {
      setLoading('Google 로그인 중...');
      const { email } = await googleSignIn();
      s.set({ googleConnected: true, userEmail: email });
      // v0.13.0 R1 — 재로그인 직후, 직전에 쓰던 시트(sheetUrl)가 있으면 자동 재연결한다(사용자가
      // 매번 Drive에서 공유링크를 다시 붙여넣지 않도록). 토큰이 막 갱신됐으므로 authFetch가 성공한다.
      const prevUrl = useSettingsStore.getState().sheetUrl.trim();
      if (prevUrl) await onUrlConfirmWithUrl(prevUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  /** URL 입력은 상태만 갱신, 적용은 confirm 버튼에서 */
  const onUrlTyping = (url: string) => {
    s.set({ sheetUrl: url });
    setError(null);
  };

  /** "확인" 버튼: 현재 URL로 시트 정보 조회 시도 */
  const onUrlConfirm = async () => {
    setError(null);
    const url = s.sheetUrl.trim();
    if (!url) { setError('URL을 입력하세요.'); return; }
    if (!s.googleConnected) { setError('먼저 Google 로그인 후 다시 확인하세요.'); return; }
    await onUrlConfirmWithUrl(url);
  };

  const onSheetTabChange = async (newTab: string) => {
    s.set({ sheetTab: newTab });
    const id = parseSpreadsheetId(s.sheetUrl);
    if (id) await loadHeaders(id, newTab);
  };

  const loadHeaders = async (spreadsheetId: string, sheetTitle: string) => {
    try {
      setLoading('컬럼 분석 중...');
      const { headers, sample } = await fetchHeaderAndSample(spreadsheetId, sheetTitle);
      const inferred = preserveInferredColumnIds(
        inferColumns(headers, sample),
        useSettingsStore.getState().columns,
      );
      // For 'options' columns, fetch a richer set of unique values
      const enriched = await Promise.all(
        inferred.map(async (c, i) => {
          if (c.type !== 'options' || c.auto.kind !== 'options') return c;
          try {
            const uniq = await fetchColumnUniqueValues(spreadsheetId, sheetTitle, i, 500);
            return {
              ...c,
              auto: { kind: 'options' as const, available: uniq, selected: c.auto.selected },
            };
          } catch {
            return c;
          }
        }),
      );
      if (enriched.length) s.set({ columns: enriched, tableGenerated: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  // S-2: re-sample the connected sheet and compare each saved column type against the sheet's
  // inferred data type. 'options' is an app construct (not a sheet data type) so it's skipped on
  // either side — only date/int/float/text mismatches are surfaced. Reuses inferColumns (loadHeaders).
  const reviewTypes = async () => {
    setError(null);
    const id = parseSpreadsheetId(s.sheetUrl);
    if (!id || !s.sheetTab) {
      setError('먼저 스프레드시트와 탭을 연결한 뒤 검토할 수 있어요.');
      return;
    }
    try {
      setLoading('시트 데이터형 검토 중...');
      const { headers, sample } = await fetchHeaderAndSample(id, s.sheetTab);
      const inferred = inferColumns(headers, sample);
      const sheetTypeByName = new Map(inferred.map((c) => [c.name.trim(), c.type]));
      let checked = 0;
      const mismatches: TypeMismatch[] = [];
      for (const col of s.columns) {
        const sheetType = sheetTypeByName.get(col.name.trim());
        if (!sheetType) continue;                 // no matching header (auto/derived column)
        if (sheetType === 'options' || col.type === 'options') continue; // skip app-only 'options'
        if (sheetType === 'name' || col.type === 'name') continue;       // skip app-only 'name'
        checked++;
        if (sheetType !== col.type) {
          mismatches.push({ id: col.id, name: col.name, saved: col.type, sheet: sheetType });
        }
      }
      setTypeReview({ mismatches, checked });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const onPickerClick = async () => {
    setError(null);
    const token = getAccessToken();
    if (!token) {
      setError('먼저 Google 로그인 후 Drive에서 선택하세요.');
      return;
    }
    try {
      setLoading('Drive 파일 선택 중...');
      const result = await openDrivePicker(token);
      if (result) {
        s.set({ sheetUrl: result.url });
        setConfirmedUrl('');
        setError(null);
        await onUrlConfirmWithUrl(result.url);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  /** v0.13.0 R1 — 저장 목록에서 시트를 선택하면 활성 시트로 전환(URL 세팅 후 메타 재조회). 토큰이
   *  만료됐으면 onUrlConfirmWithUrl 내부 authFetch가 실패하므로, 그 경우 재로그인을 안내한다. */
  const onSelectSavedSheet = async (entry: { url: string }) => {
    setError(null);
    if (!s.googleConnected || !getAccessToken()) {
      // 연결이 풀린(토큰 만료) 상태 — URL만 세팅해 두고 재로그인을 유도한다(재로그인 후 자동 재연결).
      // availableSheets/sheetTab도 함께 비워, 저장목록의 'active 배지'(새 시트)와 아래 탭 셀렉터(직전
      // 시트의 탭 목록)가 어긋나지 않게 한다 — onUrlConfirmWithUrl의 선(先)리셋과 동일 처리.
      s.set({ sheetUrl: entry.url, availableSheets: [], sheetTab: '' });
      setConfirmedUrl('');
      setError('연결이 만료되었습니다. Google 로그인을 다시 하면 이 시트로 자동 연결됩니다.');
      return;
    }
    s.set({ sheetUrl: entry.url });
    setConfirmedUrl('');
    await onUrlConfirmWithUrl(entry.url);
  };

  const onUrlConfirmWithUrl = async (url: string) => {
    const id = parseSpreadsheetId(url);
    if (!id) { setError('스프레드시트 URL 형식이 올바르지 않습니다.'); return; }
    s.set({ availableSheets: [], sheetTab: '' });
    try {
      setLoading('시트 정보 조회 중...');
      const meta = await fetchSpreadsheetMeta(id);
      const tabs = meta.sheets.map((sh) => sh.title);
      s.set({ availableSheets: tabs, sheetTab: tabs[0] || '' });
      if (tabs[0]) await loadHeaders(id, tabs[0]);
      setConfirmedUrl(url);
      // v0.13.0 R1 — 연결에 성공한 시트를 '파일명'(meta.title)으로 저장 목록에 자동 등록한다(민구
      // 요청). sheetId 기준 dedupe(saveSheet) — 같은 시트 재연결 시 최근 사용으로 갱신만 된다.
      s.saveSheet({ name: meta.title || url, url, sheetId: id, addedAt: Date.now() });
      // v0.34.0 C9(b) — 시트 연결 확정 직후 프리페치. 이 함수는 Drive Picker 선택·저장목록 선택·
      // URL 확인·재로그인 자동 재연결의 공통 종점이라 여기 1곳 배선으로 전부 커버된다(단일 배선).
      // 컬럼은 위 loadHeaders가 방금 교체했을 수 있으므로 getState()로 최신을 읽는다.
      const st = useSettingsStore.getState();
      const anyRule = st.columns.some(
        (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
      );
      if (anyRule && readonlySheetsAuth()) { resetPastIndexRetries(); prefetchPastIndex(); }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  // v0.19.0 W3 — "입력 테이블 생성"/"재생성"은 더 이상 클릭 즉시 생성하지 않는다.
  //   클릭 → 먼저 '최종 설정값 확인' 게이트(TablePreviewModal에 confirmMode로 진입)를 띄우고,
  //   "확인(생성)"을 눌렀을 때만 실제 생성 부수효과(s.set 등)를 실행한다. "취소"면 미생성.
  //   요약(총 행수·세션 라벨)은 store의 (이미 생성됐을 수 있는) 값이 아니라 '현재 columns'에서
  //   파생해 stale을 피한다.
  // v0.22.0 — 세션명 우선순위: 사용자 자유입력(sessionCustomLabel) > (생성일 + 세션 상수들) >
  //   생성일 단독. SSOT는 sessionLabel.buildSessionLabel(입력탭 buildAutoLabel과 동일 결과).
  //   단, 사용자가 세션명 *컬럼*을 명시 선택(sessionLabelColId)한 경우는 그 컬럼 값만 접미로 쓰는
  //   기존 동작을 보존한다(자유입력이 없을 때만). 자유입력이 있으면 무엇보다 우선한다.
  const prospectiveSessionLabel = () => {
    const isoDate = new Date().toISOString().slice(0, 10);
    const custom = (s.sessionCustomLabel ?? '').trim();
    if (custom) return custom; // 자유입력 최우선(날짜 미접두)
    const pickedCol = s.sessionLabelColId
      ? s.columns.find((c) => c.id === s.sessionLabelColId)
      : null;
    if (pickedCol) {
      const colVal = pickSessionLabelValue(s.columns, pickedCol);
      return colVal ? `${isoDate} ${colVal}` : isoDate;
    }
    return buildSessionLabel(s.columns, { isoDate });
  };

  // 게이트 열기 — 생성/재생성 모두 동일 경로. 부수효과는 onGenerateConfirm까지 미룬다.
  const onGenerate = () => {
    // v0.33.0 B-10 — 생성 게이트 열림 계측(생성 퍼널 가시화 — 이전엔 무로깅).
    logger.log({ type: 'command', parsed: 'ui_open', extra: 'generate_gate' });
    setGenerateGateOpen(true);
  };

  // "확인(생성)" — 여기서만 실제 생성 부수효과 실행.
  const onGenerateConfirm = () => {
    const total = computeTotalRows(s.columns);
    const sessionAutoLabel = prospectiveSessionLabel();
    s.set({ tableGenerated: true, totalRows: total, sessionAutoLabel });
    // v0.33.0 항목5 — 테이블 생성 시점 프리페치(세션 시작 start()와 동일 조건). 생성 직후엔 대개
    // 토큰이 살아 있으므로 여기서 미리 당겨 두면, 세션 시작이 늦어져 토큰이 만료돼도 IDB
    // write-through 스냅샷이 폴백으로 남는다(07-13 §4 침묵 창 축소).
    const anyAnomalyRule = s.columns.some(
      (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
    );
    // v0.34.0 C9(a) — 토큰 조건을 (토큰 || API key)로 완화(readonlySheetsAuth SSOT). 공개 시트면
    // 미로그인 생성 직후에도 과거값이 준비된다(민구: "시트가 연결되면 자동으로 작동해야 함").
    if (anyAnomalyRule && readonlySheetsAuth()) { resetPastIndexRetries(); prefetchPastIndex(); }
    setGenerateGateOpen(false);
  };

  /** v0.32.0 설정탭 UX(Vance) B3 — 전체 초기화. 컬럼·행수·세션명·다이얼·음성/검토 옵션·생성 상태를
   *  기본값(makeSettingsDefaults SSOT)으로 되돌린다. Google 로그인·시트 URL·저장된 시트는 기본
   *  **보존**(민구 확정) — 모달 체크박스로만 opt-in 삭제. 세션 데이터·클립·로그(IDB)는 건드리지 않는다. */
  const onResetConfirm = async ({ clearLogin, clearSheets }: { clearLogin: boolean; clearSheets: boolean }) => {
    const d = makeSettingsDefaults();
    s.set({
      columns: d.columns, // fresh copy — makeSettingsDefaults가 호출마다 새 객체를 만든다
      tableGenerated: false,
      totalRows: d.totalRows,
      ttsRate: d.ttsRate,
      recognitionTolerance: d.recognitionTolerance,
      fastRecognition: d.fastRecognition,
      // v0.33.0 항목10 — 자동 캡처·비프음 선택도 기본값으로(초기화 SSOT = makeSettingsDefaults).
      autoScreenCapture: d.autoScreenCapture,
      beepPositiveId: d.beepPositiveId,
      beepNegativeId: d.beepNegativeId,
      manualMode: d.manualMode,
      preferredVoiceName: d.preferredVoiceName,
      sessionLabelColId: d.sessionLabelColId,
      sessionAutoLabel: d.sessionAutoLabel,
      sessionCustomLabel: d.sessionCustomLabel,
      roundDateColId: d.roundDateColId,
      reviewFilters: d.reviewFilters,
      reviewTargetRound: d.reviewTargetRound,
      reviewBaselineBack: d.reviewBaselineBack,
      reviewGroupCols: d.reviewGroupCols,
      reviewMeasureCols: d.reviewMeasureCols,
      reviewSelectedRows: d.reviewSelectedRows,
    });
    setPreferredVoiceName(''); // 라이브 speech 모듈도 스토어 기본값과 동기화
    setTypeReview(null);
    if (clearLogin) {
      await googleSignOut('settings_reset'); // 토큰 없으면 no-op(clearToken만) — 로그아웃 상태에서도 안전
      s.set({ googleConnected: false, userEmail: null });
    }
    if (clearSheets) {
      s.set({ sheetUrl: '', sheet: null, sheetTab: '', availableSheets: [], savedSheets: [] });
      // 전용 IDB 레코드(onRehydrateStorage 복원 경로)도 함께 비운다 — 안 비우면 다음 부팅에서 되살아남.
      void saveSheetsRecord({ savedSheets: [], sheetUrl: '', updatedAt: Date.now() });
      // v0.33.0 항목5 — 과거값 인덱스 영속 스냅샷도 함께 삭제(시트를 지웠으면 그 시트의 비교선도
      // 무의미 — fp 불일치로 어차피 안 쓰이지만 데이터 위생).
      void deletePastIndexBackup();
      setConfirmedUrl('');
    }
    // 첫 진입 안내 배너 재노출(초기화 = 처음부터 다시 시작하는 사용자).
    try { localStorage.removeItem(SETTINGS_TIP_SEEN_KEY); } catch { /* private mode 등 */ }
    setTipDismissed(false);
    logger.log({
      type: 'app',
      extra: `settings_reset:login=${clearLogin ? 'cleared' : 'kept'},sheet=${clearSheets ? 'cleared' : 'kept'}`,
    });
    setResetOpen(false);
  };

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
              gap: 10,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: T.textDim, letterSpacing: -0.2 }}>
              설정 요약
            </div>
            <SettingsSummary
              columns={s.columns}
              totalRows={computeTotalRows(s.columns)}
              sessionLabel={prospectiveSessionLabel()}
            />
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

// ─── table preview modal ───────────────────────────────────────
function TablePreviewModal({
  columns, totalRows, onClose, onConfirm, onOpenPreview, sessionLabel, regenerating,
}: {
  columns: import('../types').Column[];
  totalRows: number;
  onClose: () => void;
  /** v0.19.0 W3 — 주어지면 '최종 설정값 확인' 게이트 모드. v0.32.0 B1 — 게이트는 **무스크롤 요약
   *  전용**(테이블 본문 없음): SettingsSummary(카운트 pill + 세션명 + 압축 컬럼 목록)만 보여주고,
   *  푸터를 "취소 / 이대로 생성"으로 바꿔 확인 시에만 onConfirm을 호출한다.
   *  미주입 시(생성 후 '미리보기')는 기존대로 50행 테이블 + 닫기 전용. */
  onConfirm?: () => void;
  /** v0.32.0 B1 — 게이트 안 "생성될 테이블 미리보기" 버튼. 닫기 전용 미리보기를 게이트 위에 연다. */
  onOpenPreview?: () => void;
  sessionLabel?: string;
  regenerating?: boolean;
}) {
  const MAX_PREVIEW = 50;
  const displayRows = Math.min(totalRows, MAX_PREVIEW);
  const colWidths = columns.map((c) =>
    c.type === 'date' ? 110 : c.type === 'text' || c.type === 'name' || c.type === 'options' ? 100 : 70,
  );
  const isGate = !!onConfirm;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // v0.21.0 설정탭#2 — standalone PWA safe-area. position:fixed라 phoneStyle 셸 패딩을 벗어나므로
        //   노치/상태바/홈인디케이터를 침범했다. backdrop 패딩에 safe-area 변수(global.css SSOT)를
        //   흡수(중앙 정렬 카드가 inset만큼 안쪽으로 들어옴). 일반 Safari 탭에선 0이라 기존 16px 유지.
        paddingTop: 'max(16px, var(--sat))',
        paddingBottom: 'max(16px, var(--sab))',
        paddingLeft: 'max(16px, var(--sal))',
        paddingRight: 'max(16px, var(--sar))',
        animation: 'fade-up 200ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid={isGate ? 'gate-card' : 'table-preview-card'}
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
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
              {isGate ? (regenerating ? '재생성 — 설정값 확인' : '입력 테이블 생성 — 설정값 확인') : '테이블 미리보기'}
            </div>
            <div style={{ fontSize: 12, color: T.textMute, marginTop: 2 }}>
              {/* v0.32.0 B1 — 게이트엔 테이블 본문이 없으므로 '(처음 N행 표시)'를 붙이지 않는다. */}
              {isGate
                ? `총 ${totalRows}행 생성`
                : `총 ${totalRows}행${totalRows > MAX_PREVIEW ? ` (처음 ${MAX_PREVIEW}행 표시)` : ''}`}
            </div>
          </div>
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

        {/* v0.32.0 설정탭 UX(Vance) B1 — 게이트 = 무스크롤 '설정값 확인'. 카운트 pill·세션명·컬럼
            목록(SettingsSummary — 설정 요약 팝업과 공용)을 내부 스크롤 없이 전부 보여준다(≤12컬럼
            1줄씩 / >12컬럼 2열 그리드로 밀도 전환). 50행 테이블 본문은 게이트에서 제거 — 필요하면
            아래 "생성될 테이블 미리보기"로 닫기 전용 미리보기를 게이트 위에 연다. */}
        {isGate && (
          <div
            style={{
              padding: '12px 16px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            <SettingsSummary columns={columns} totalRows={totalRows} sessionLabel={sessionLabel} />
            {onOpenPreview && (
              <button
                type="button"
                onClick={onOpenPreview}
                style={{
                  minHeight: 44, borderRadius: 12,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 14, fontWeight: 700, letterSpacing: -0.2,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {I.table(16, T.textDim)} 생성될 테이블 미리보기
              </button>
            )}
          </div>
        )}

        {!isGate && (
        <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: 'max-content' }}>
            {/* Header */}
            <div
              style={{
                display: 'flex', position: 'sticky', top: 0, zIndex: 2,
                background: T.card, borderBottom: `1px solid ${T.line}`,
              }}
            >
              <div
                style={{
                  width: 36, padding: '8px 6px', fontSize: 11, fontWeight: 700,
                  color: T.textMute, textAlign: 'center', borderRight: `1px solid ${T.line}`,
                }}
              >
                #
              </div>
              {columns.map((c, ci) => (
                <div
                  key={c.id}
                  style={{
                    width: colWidths[ci], padding: '8px 8px',
                    fontSize: 12, fontWeight: 700, color: c.input === 'voice' ? T.blue : T.textDim,
                    borderRight: `1px solid ${T.line}`,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {c.name}
                  {c.input === 'voice' && (
                    <span style={{ marginLeft: 4, fontSize: 10, color: T.blue }}>음성</span>
                  )}
                </div>
              ))}
            </div>
            {/* Rows */}
            {Array.from({ length: displayRows }, (_, i) => {
              const rowIndex = i + 1;
              const auto = buildCyclingValues(columns, rowIndex);
              return (
                <div
                  key={rowIndex}
                  style={{ display: 'flex', borderBottom: `1px solid ${T.line}` }}
                >
                  <div
                    style={{
                      width: 36, padding: '7px 6px', fontSize: 12,
                      color: T.textMute, textAlign: 'center',
                      borderRight: `1px solid ${T.line}`,
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontWeight: 700,
                    }}
                  >
                    {rowIndex}
                  </div>
                  {columns.map((c, ci) => {
                    const val = c.input === 'voice'
                      ? <span style={{ color: T.textMute, opacity: 0.4 }}>—</span>
                      : (nestedAutoValue(columns, c, rowIndex) || auto[c.id] || (
                        <span style={{ color: T.textMute, opacity: 0.3 }}>빈값</span>
                      ));
                    return (
                      <div
                        key={c.id}
                        style={{
                          width: colWidths[ci], padding: '7px 8px',
                          fontSize: 13, fontWeight: 700,
                          color: c.input === 'voice' ? T.textMute : T.text,
                          borderRight: `1px solid ${T.line}`,
                          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {val}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        )}

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}` }}>
          {isGate ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1, height: 48, borderRadius: 14,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                onClick={onConfirm}
                style={{
                  flex: 2, height: 48, borderRadius: 14, border: 'none',
                  background: T.green, color: '#06200F',
                  fontSize: 15, fontWeight: 800, cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0,200,83,0.32)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {/* v0.32.0 B1 — '생성' → '이대로 생성'(요약을 확인하고 그대로 진행한다는 의미).
                    '생성' 부분문자열은 유지 + 게이트 내 마지막 '생성' 버튼(hasText .last() 헬퍼 호환). */}
                {I.check(18, '#06200F')} {regenerating ? '재생성' : '이대로 생성'}
              </button>
            </div>
          ) : (
            <button
              onClick={onClose}
              style={{
                width: '100%', height: 48, borderRadius: 14, border: 'none',
                background: T.blue, color: '#fff',
                fontSize: 15, fontWeight: 800, cursor: 'pointer',
                boxShadow: `0 4px 14px ${T.blueGlow}`,
              }}
            >
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** v0.20.0 설정탭#1 — 입력방식 라벨(자동/음성/수동). 설정탭 SegmentToggle 라벨과 일치. */
const INPUT_LABELS: Record<Column['input'], string> = {
  auto: '자동',
  voice: '음성',
  touch: '수동',
};

/** v0.32.0 — 컬럼의 값/범위 표기(ColumnDetailRow·ColumnGridCell 공용). 고정값 → 그 값,
 *  순차 → from~to, 옵션 → 선택값들, 음성/수동 → 입력대기 표시. */
function columnValueText(col: Column): string {
  if (col.input === 'voice') return '음성 입력';
  if (col.input === 'touch') return '직접 입력';
  if (col.auto.kind === 'seq') return `${col.auto.from} ~ ${col.auto.to}`;
  if (col.type === 'date') {
    // v0.21.0 설정탭#3 — 자동입력+날짜는 실제 치환될 날짜를 함께 보여준다. autoValue()(autoValue.ts)
    //   가 '오늘'→ISO 날짜 변환을 이미 보유 — 재사용. '오늘'(또는 빈값=오늘)이면 "오늘 (YYYY-MM-DD)"로,
    //   날짜 지정이면 그 날짜를 그대로 표시(이 분기는 col.auto.kind==='fixed' 전제).
    const resolved = autoValue(col, 1); // '오늘'/빈값 → 오늘 ISO, 지정일 → 그 날짜
    const isTodayDynamic =
      col.auto.kind === 'fixed' && (col.auto.value === '오늘' || col.auto.value === '');
    return isTodayDynamic ? `오늘 (${resolved})` : resolved || '(빈값)';
  }
  if (col.auto.kind === 'fixed') return col.auto.value || '(빈값)';
  if (col.auto.kind === 'options') {
    return col.auto.selected.length > 0 ? col.auto.selected.join(', ') : '(미선택)';
  }
  return '';
}

/** v0.20.0 설정탭#1 — 게이트 컬럼별 상세 한 줄. 값/범위·알람조건·이상값 범위를 columns에서 파생.
 *  v0.32.0 B1 — 무스크롤 게이트에 맞춰 밀도 압축(패딩 4px·본문 12px). ≤12컬럼 경로 전용. */
function ColumnDetailRow({ col }: { col: Column }) {
  const valueText = columnValueText(col);
  const trendText =
    col.trendRule === 'increase' ? '증가' : col.trendRule === 'decrease' ? '감소' : null;
  const pctText =
    typeof col.pctThreshold === 'number' && Number.isFinite(col.pctThreshold) && col.pctThreshold > 0
      ? `±${col.pctThreshold}%`
      : null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
      }}
    >
      <span
        style={{
          fontSize: 12, fontWeight: 800, color: T.text, flexShrink: 0,
          maxWidth: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={col.name}
      >
        {col.name || '(이름없음)'}
      </span>
      <span
        style={{
          fontSize: 10, fontWeight: 700, color: T.textMute, flexShrink: 0,
          padding: '1px 7px', borderRadius: 999, border: `1px solid ${T.line}`,
        }}
      >
        {INPUT_LABELS[col.input]}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: T.textDim,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
        }}
        title={valueText}
      >
        {valueText}
      </span>
      {trendText && (
        <span
          style={{
            fontSize: 10, fontWeight: 800, color: T.amber, flexShrink: 0,
            padding: '1px 7px', borderRadius: 999, background: 'rgba(255,179,0,0.12)',
          }}
        >
          추세 {trendText}
        </span>
      )}
      {pctText && (
        <span
          style={{
            fontSize: 10, fontWeight: 800, color: T.red, flexShrink: 0,
            padding: '1px 7px', borderRadius: 999, background: 'rgba(255,82,82,0.12)',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          {pctText}
        </span>
      )}
    </div>
  );
}

/** v0.32.0 B1 — >12컬럼용 2열 그리드 셀(무스크롤 유지를 위한 고밀도 모드).
 *  1행: 이름 + 입력방식 pill / 2행: 값·범위(ellipsis, title로 전체값). */
function ColumnGridCell({ col }: { col: Column }) {
  const valueText = columnValueText(col);
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0,
        padding: '3px 6px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span
          style={{
            flex: 1, minWidth: 0, fontSize: 11, fontWeight: 800, color: T.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
          title={col.name}
        >
          {col.name || '(이름없음)'}
        </span>
        <span
          style={{
            fontSize: 9, fontWeight: 700, color: T.textMute, flexShrink: 0,
            padding: '0 6px', borderRadius: 999, border: `1px solid ${T.line}`,
          }}
        >
          {INPUT_LABELS[col.input]}
        </span>
      </div>
      <span
        style={{
          fontSize: 11, fontWeight: 700, color: T.textDim, minWidth: 0,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={valueText}
      >
        {valueText}
      </span>
    </div>
  );
}

/** v0.32.0 설정탭 UX(Vance) B1/B2 공용 — 설정 요약 블록(무스크롤): 입력방식 카운트 pill + 세션명 +
 *  컬럼 목록. 내부 스크롤 금지 — 컬럼 ≤12는 한 줄씩(ColumnDetailRow), >12는 2열 그리드로 밀도 전환.
 *  게이트('설정값 확인')와 설정 요약 팝업이 같은 컴포넌트를 쓴다(표기 불일치 방지). */
function SettingsSummary({ columns, totalRows, sessionLabel }: {
  columns: Column[];
  totalRows: number;
  sessionLabel?: string | null;
}) {
  const voiceCount = columns.filter((c) => c.input === 'voice').length;
  const autoCount = columns.filter((c) => c.input === 'auto').length;
  const touchCount = columns.filter((c) => c.input === 'touch').length;
  const dense = columns.length > 12;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <SummaryPill label="음성입력" value={voiceCount} accent />
        <SummaryPill label="자동입력" value={autoCount} />
        <SummaryPill label="수동입력" value={touchCount} />
        <SummaryPill label="전체 항목" value={columns.length} />
        <SummaryPill label="총 행수" value={totalRows} />
      </div>
      {sessionLabel && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 10,
            background: 'rgba(0,200,83,0.10)', border: '1px solid rgba(0,200,83,0.30)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, flexShrink: 0 }}>
            세션명
          </span>
          <span
            style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: T.text,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
            }}
            title={sessionLabel}
          >
            {sessionLabel}
          </span>
        </div>
      )}
      <div
        style={{
          display: dense ? 'grid' : 'flex',
          ...(dense
            ? { gridTemplateColumns: '1fr 1fr', gap: 3 }
            : { flexDirection: 'column' as const, gap: 3 }),
          border: `1px solid ${T.line}`, borderRadius: 10, padding: 4,
          background: T.inputBg,
        }}
      >
        {columns.map((c) => (dense ? <ColumnGridCell key={c.id} col={c} /> : <ColumnDetailRow key={c.id} col={c} />))}
      </div>
    </div>
  );
}

/** v0.19.0 W3 — 게이트 요약 칩(라벨 + 숫자). 의미색 변경 없음(음성=blue accent).
 *  v0.32.0 B1 — 무스크롤 게이트/팝업에 맞춰 압축(패딩 4px·숫자 15px). */
function SummaryPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'baseline', gap: 5,
        padding: '4px 10px', borderRadius: 10,
        background: accent ? 'rgba(41,121,255,0.12)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${accent ? 'rgba(41,121,255,0.35)' : T.line}`,
      }}
    >
      <span style={{ fontSize: 11, color: accent ? T.blue : T.textDim, fontWeight: 700 }}>{label}</span>
      <span
        style={{
          fontSize: 15, fontWeight: 800, color: accent ? T.blue : T.text,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── v0.32.0 설정탭 UX(Vance) — 설정 요약 팝업 + 초기화 확인 모달 ─────────────

/** 요약 팝업의 상태 한 줄(라벨 + 값). ok=true면 값이 green, false면 dim. */
function SummaryStatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, flexShrink: 0, width: 52 }}>
        {label}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700,
          color: ok ? T.green : T.textMute, textAlign: 'right',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/** v0.32.0 B2 — 설정 요약 팝업(설정탭 전용, 닫기 전용, 375×812 무스크롤). 로그인·시트 연결 상태,
 *  SettingsSummary(게이트와 공용), 다이얼/토글 한 줄, 생성 상태를 한 화면에 모은다.
 *  '생성됨' 문구는 이 팝업이 열려 있을 때만 DOM에 존재(조건부 마운트) — 기존 text=생성됨 로케이터는
 *  액션바 버튼만 보는 흐름이라 충돌 없음. */
function SettingsSummaryModal({
  googleConnected, userEmail, sheetLabel, columns, totalRows, sessionLabel,
  recognitionTolerance, ttsRate, fastRecognition, tableGenerated, generatedRows, onClose,
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
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      data-testid="settings-summary-modal"
      role="dialog"
      aria-modal="true"
      aria-label="설정 요약"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingTop: 'max(16px, var(--sat))',
        paddingBottom: 'max(16px, var(--sab))',
        paddingLeft: 'max(16px, var(--sal))',
        paddingRight: 'max(16px, var(--sar))',
        animation: 'fade-up 200ms ease-out',
      }}
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

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
    </div>
  );
}

/** 초기화 모달의 체크박스 행(44px 터치 타깃, 라벨 전체가 탭 영역). */
function ResetOptionRow({ checked, onToggle, label, testid }: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  testid: string;
}) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
        padding: '0 12px', borderRadius: 12, cursor: 'pointer',
        background: checked ? 'rgba(255,82,82,0.10)' : T.inputBg,
        border: `1px solid ${checked ? 'rgba(255,82,82,0.45)' : T.line}`,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        data-testid={testid}
        style={{ width: 18, height: 18, accentColor: T.red, flexShrink: 0, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 14, fontWeight: 700, color: checked ? T.red : T.text, lineHeight: 1.4 }}>
        {label}
      </span>
    </label>
  );
}

/** v0.32.0 B3 — 초기화 확인 모달. 무엇이 초기화되고 무엇이 보존되는지 명시한 뒤 실행.
 *  기본: Google 로그인·시트 URL·저장된 시트 **보존**(민구 확정) — 체크박스로만 opt-in 삭제.
 *  버튼 문구는 '생성' 부분문자열 금지(hasText:'생성' .last() 헬퍼 보호) — 초기화 실행/취소는 안전. */
function SettingsResetModal({ onCancel, onConfirm }: {
  onCancel: () => void;
  onConfirm: (opts: { clearLogin: boolean; clearSheets: boolean }) => void;
}) {
  const [clearLogin, setClearLogin] = useState(false);
  const [clearSheets, setClearSheets] = useState(false);
  return (
    <div
      onClick={onCancel}
      data-testid="settings-reset-modal"
      role="dialog"
      aria-modal="true"
      aria-label="설정 초기화"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingTop: 'max(16px, var(--sat))',
        paddingBottom: 'max(16px, var(--sab))',
        paddingLeft: 'max(16px, var(--sal))',
        paddingRight: 'max(16px, var(--sar))',
        animation: 'fade-up 200ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 480, maxHeight: '84vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>설정 초기화</div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 2 }}>
            설정탭의 구성을 기본값으로 되돌립니다
          </div>
        </div>

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              padding: '10px 12px', borderRadius: 12,
              background: 'rgba(255,82,82,0.06)', border: '1px solid rgba(255,82,82,0.25)',
              fontSize: 13, color: T.text, lineHeight: 1.6, wordBreak: 'keep-all',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: T.red, marginBottom: 4 }}>
              기본값으로 되돌아감
            </div>
            컬럼 구성 → 기본 10항목 · 행수 50 · 세션명 설정 · 빠른 인식 OFF ·
            인식 허용범위 60% · 안내 속도 1.05x · 음성·검토 옵션 · 생성 상태 해제
          </div>
          <div
            style={{
              padding: '10px 12px', borderRadius: 12,
              background: 'rgba(0,200,83,0.06)', border: '1px solid rgba(0,200,83,0.25)',
              fontSize: 13, color: T.text, lineHeight: 1.6, wordBreak: 'keep-all',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: T.green, marginBottom: 4 }}>
              그대로 유지됨
            </div>
            Google 로그인 · 시트 URL·저장된 시트 (아래에서 함께 삭제 선택 가능) —
            세션 데이터·클립·로그는 영향 없음
          </div>
          <ResetOptionRow
            checked={clearLogin}
            onToggle={() => setClearLogin((v) => !v)}
            label="Google 로그인도 해제"
            testid="settings-reset-clear-login"
          />
          <ResetOptionRow
            checked={clearSheets}
            onToggle={() => setClearSheets((v) => !v)}
            label="시트 URL·저장된 시트도 삭제"
            testid="settings-reset-clear-sheets"
          />
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}`, display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            autoFocus
            style={{
              flex: 1, height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={() => onConfirm({ clearLogin, clearSheets })}
            data-testid="settings-reset-confirm"
            style={{
              flex: 2, height: 48, borderRadius: 14, border: 'none',
              background: T.red, color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(255,82,82,0.32)',
            }}
          >
            초기화 실행
          </button>
        </div>
      </div>
    </div>
  );
}
