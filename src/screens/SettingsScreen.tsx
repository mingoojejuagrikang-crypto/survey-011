import { useEffect, useState } from 'react';
import { T, TYPE_LABELS, TYPE_COLORS } from '../tokens';
import { I, AuthMark } from '../components/icons';
import { Chip } from '../components/Chip';
import { ScreenHeader } from '../components/ScreenHeader';
import { useSettingsStore } from '../stores/settingsStore';
import type { Column, DataType } from '../types';
import {
  getCurrentEmail,
  getStoredToken,
  isConfigured as isGoogleConfigured,
  signIn as googleSignIn,
  signOut as googleSignOut,
  warmupGoogleAuth,
} from '../lib/googleAuth';
import {
  fetchHeaderAndSample,
  fetchSpreadsheetMeta,
  fetchColumnUniqueValues,
  inferColumns,
  parseSpreadsheetId,
} from '../lib/sheets';
import { computeTotalRows, nestedAutoValue, buildCyclingValues } from '../lib/autoValue';
import { getPickerApiKey, openDrivePicker } from '../lib/drivePicker';
import { getAccessToken } from '../lib/googleAuth';
import { getKoreanVoices, refreshVoices, setPreferredVoiceName, speak, warmupTts } from '../lib/speech';
import { logger } from '../lib/logger';
import { isTrendEligible } from '../lib/columnFlags';
import { usePwaUpdate, applyUpdate, checkForUpdateNow } from '../lib/pwaUpdate';

const TYPE_ORDER: DataType[] = ['date', 'text', 'int', 'float', 'options'];

/** 단일 컬럼에서 세션명 접미사로 쓸 값을 뽑는다(fixed 값 또는 단일 선택 옵션). 없으면 ''. */
function colSessionValue(col: Column): string {
  if (col.auto.kind === 'fixed') return col.auto.value;
  if (col.auto.kind === 'options' && col.auto.selected.length === 1) return col.auto.selected[0];
  return '';
}

/**
 * 세션명 접미사로 쓸 값을 고른다.
 *  - 명시 선택(pickedCol): 그 컬럼 하나의 값(사용자 수동 선택 보존).
 *  - 자동(pickedCol 없음, v0.20.0 설정탭#4): **자동입력 고정값(auto.kind==='fixed') 컬럼들을 전부**
 *    공백으로 join한다(날짜 컬럼·'오늘' 제외). 농가명/라벨/처리 등 그 세션을 식별하는 고정값을 모두
 *    세션명에 담아, "생성일 + 고정값 항목들"이 기본 세션명이 되게 한다. 값이 없으면 ''.
 */
function pickSessionLabelValue(columns: Column[], pickedCol: Column | null | undefined): string {
  if (pickedCol) return colSessionValue(pickedCol);
  const parts = columns
    .filter(
      (c) =>
        c.input === 'auto' &&
        c.type !== 'date' &&
        c.auto.kind === 'fixed' &&
        !!c.auto.value &&
        c.auto.value !== '오늘',
    )
    .map((c) => c.auto.kind === 'fixed' ? c.auto.value.trim() : '')
    .filter(Boolean);
  return parts.join(' ');
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
      <span style={{ fontSize: 12, color: T.textMute, fontWeight: 700, letterSpacing: 0.4 }}>
        {label}
      </span>
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
  // Numeric types support fixed or sequential
  if (col.type === 'int' || col.type === 'float') {
    if (col.auto.kind === 'seq') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: T.textMute }}>순차</span>
          <MiniInput
            value={col.auto.from}
            onChange={(v) =>
              onChange({ ...col, auto: { kind: 'seq', from: +v || 0, to: col.auto.kind === 'seq' ? col.auto.to : 0 } })
            }
          />
          <span style={{ color: T.textMute, fontSize: 14 }}>~</span>
          <MiniInput
            value={col.auto.to}
            onChange={(v) =>
              onChange({ ...col, auto: { kind: 'seq', from: col.auto.kind === 'seq' ? col.auto.from : 0, to: +v || 0 } })
            }
          />
          <button
            onClick={() => onChange({ ...col, auto: { kind: 'fixed', value: '' } })}
            style={linkButton}
          >
            단일값
          </button>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: T.textMute }}>단일값</span>
        <MiniInput
          value={col.auto.kind === 'fixed' ? col.auto.value : ''}
          placeholder="값"
          onChange={(v) => onChange({ ...col, auto: { kind: 'fixed', value: v } })}
          wide
        />
        <button
          onClick={() => onChange({ ...col, auto: { kind: 'seq', from: 1, to: 50 } })}
          style={{ ...linkButton, color: T.blue, fontWeight: 700 }}
        >
          순차로 변경
        </button>
      </div>
    );
  }

  // date type: "오늘" radio or date picker
  if (col.type === 'date') {
    const isToday = col.auto.kind !== 'fixed' || col.auto.value === '오늘' || col.auto.value === '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13, color: T.text }}>
            <input
              type="radio"
              checked={isToday}
              onChange={() => onChange({ ...col, auto: { kind: 'fixed', value: '오늘' } })}
              style={{ accentColor: T.blue }}
            />
            오늘
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13, color: T.text }}>
            <input
              type="radio"
              checked={!isToday}
              onChange={() => {
                const today = new Date().toISOString().slice(0, 10);
                onChange({ ...col, auto: { kind: 'fixed', value: today } });
              }}
              style={{ accentColor: T.blue }}
            />
            날짜 지정
          </label>
        </div>
        {!isToday && (
          <input
            type="date"
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
  if (col.type === 'text' || col.type === 'name') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        <span style={{ fontSize: 13, color: T.textMute }}>단일값</span>
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
      </div>
    );
  }

  // options - rendered separately
  return null;
}

const linkButton: React.CSSProperties = {
  border: 'none', background: 'transparent', color: T.textMute, fontSize: 13,
  cursor: 'pointer', textDecoration: 'underline',
};

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
          return (
            <button
              key={v}
              onClick={() => toggle(v)}
              style={{
                border: `1px solid ${sel ? T.blue : T.line}`,
                background: sel ? T.blueGlow : 'rgba(255,255,255,0.04)',
                color: sel ? T.text : T.textDim,
                fontSize: 14, fontWeight: 700,
                padding: '8px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {sel ? I.check(14, T.text) : null}
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
        {/* v0.20.0 설정탭#3 — 순차/단일 하이라이트 칩. 자동입력 정수 컬럼이 순차(seq)인지 단일(fixed)인지
            를 컬럼 카드 전단에서 즉시 식별. 읽기 전용 표시(실제 전환은 아래 AutoDetail '순차로 변경/단일값').
            "음성확인 유/무" SegmentToggle과 동일한 라벨+pill 톤. int 전용(spec). */}
        {col.input === 'auto' && col.type === 'int' && (col.auto.kind === 'seq' || col.auto.kind === 'fixed') && (
          <div data-testid={`seq-fixed-${col.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: T.textMute, fontWeight: 700, letterSpacing: 0.4 }}>
              생성방식
            </span>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 14px',
                borderRadius: 10, fontSize: 14, fontWeight: 700, letterSpacing: -0.1,
                border: `1px solid ${col.auto.kind === 'seq' ? 'rgba(41,121,255,0.35)' : T.line}`,
                background: col.auto.kind === 'seq' ? T.blueGlow : 'rgba(255,255,255,0.05)',
                color: col.auto.kind === 'seq' ? T.text : T.textDim,
              }}
            >
              {col.auto.kind === 'seq' ? '순차' : '단일'}
            </span>
          </div>
        )}
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
            {/* v0.8.0 — 증가/감소 = "이상치로 볼 변화 방향"(삭제된 전역 토글 설명을 컬럼 카드로 이전). */}
            <div style={{ fontSize: 11, color: T.textMute, lineHeight: 1.4, paddingLeft: 2 }}>
              직전 조사보다 그 방향으로 변하면 추세 알림을 띄웁니다.
              증가=커지면 · 감소=작아지면. 이상값 범위(%)를 적으면 방향과 무관하게 그만큼 변할 때도 알립니다.
            </div>
            {/* v0.8.0 — 변동률 % 임계값(방향 무관). 빈 값=undefined(off), 값 입력 시에만 활성. */}
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.textDim }}
            >
              이상값 범위
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                data-testid={`pct-threshold-${col.id}`}
                placeholder="% (선택)"
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
                  width: 96, height: 32, borderRadius: 8,
                  background: T.inputBg, border: `1px solid ${T.line}`,
                  color: T.text, fontSize: 14, fontWeight: 600,
                  padding: '0 8px', outline: 'none',
                }}
              />
            </label>
          </>
        )}
      </div>

      {col.input === 'auto' && col.type !== 'options' && (
        <div style={{ paddingLeft: 32 }}>
          <AutoDetail col={col} onChange={onChange} />
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
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
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

export function SettingsScreen() {
  const s = useSettingsStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmedUrl, setConfirmedUrl] = useState<string>(s.sheetUrl);
  // S-2: result of "타입 검토" (null = not run; checked = columns compared).
  const [typeReview, setTypeReview] = useState<{ mismatches: TypeMismatch[]; checked: number } | null>(null);
  const [tablePreviewOpen, setTablePreviewOpen] = useState(false);
  // v0.19.0 W3 — "입력 테이블 생성/재생성" 클릭 시 먼저 뜨는 '최종 설정값 확인' 게이트.
  const [generateGateOpen, setGenerateGateOpen] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  // v0.14.0 F — 저장된 시트 목록을 기본 접힌 드롭다운으로(세로 풀리스트가 시트 多 시 화면 점유 과다).
  const [savedSheetsOpen, setSavedSheetsOpen] = useState(false);
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
      s.set({ googleConnected: false });
    }
    // S-1: preload GIS + token client so the first 로그인 click opens the popup in one shot
    // (avoids the "popup_failed_to_open" that required a second click).
    void warmupGoogleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const inferred = inferColumns(headers, sample);
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
  const prospectiveSessionLabel = () => {
    const isoDate = new Date().toISOString().slice(0, 10);
    const pickedCol = s.sessionLabelColId
      ? s.columns.find((c) => c.id === s.sessionLabelColId)
      : null;
    const colVal = pickSessionLabelValue(s.columns, pickedCol);
    return colVal ? `${isoDate} ${colVal}` : isoDate;
  };

  // 게이트 열기 — 생성/재생성 모두 동일 경로. 부수효과는 onGenerateConfirm까지 미룬다.
  const onGenerate = () => {
    setGenerateGateOpen(true);
  };

  // "확인(생성)" — 여기서만 실제 생성 부수효과 실행.
  const onGenerateConfirm = () => {
    const total = computeTotalRows(s.columns);
    const sessionAutoLabel = prospectiveSessionLabel();
    s.set({ tableGenerated: true, totalRows: total, sessionAutoLabel });
    setGenerateGateOpen(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader sub="오늘의 측정 항목과 시트 연결" />

      <div
        style={{
          flex: 1, minHeight: 0,
          overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 12,
        }}
      >
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
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textDim }}>
                세션명
              </div>
              <select
                value={s.sessionLabelColId ?? ''}
                onChange={(e) => {
                  const newColId = e.target.value || null;
                  const isoDate = new Date().toISOString().slice(0, 10);
                  const pickedCol = newColId
                    ? s.columns.find((c) => c.id === newColId)
                    : null;
                  const colVal = pickSessionLabelValue(s.columns, pickedCol);
                  s.set({
                    sessionLabelColId: newColId,
                    sessionAutoLabel: colVal ? `${isoDate} ${colVal}` : isoDate,
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
            {s.sessionAutoLabel && (
              <div style={{ fontSize: 12, color: T.textMute }}>
                세션명 미리보기: <span style={{ color: T.text, fontWeight: 700 }}>{s.sessionAutoLabel}</span>
              </div>
            )}
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

            {/* v0.8.0 — 추세 검증 전역 마스터 토글 제거(이상치 알람은 컬럼별 규칙 유무로 활성).
                조사시기(회차) 컬럼 선택은 조회탭으로 이전(WS4) — roundDateColId 필드는 유지. */}

            <TtsVoiceSelector />

          </div>
        </div>

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
                onClick={() => setTablePreviewOpen(true)}
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
      </div>

      {/* 생성 후 '미리보기' — 닫기 전용(부수효과 없음). */}
      {tablePreviewOpen && (
        <TablePreviewModal
          columns={s.columns}
          totalRows={s.totalRows}
          onClose={() => setTablePreviewOpen(false)}
        />
      )}

      {/* v0.19.0 W3 — '최종 설정값 확인' 게이트. 요약/미리보기는 현재 columns에서 파생(stale 방지).
          "확인(생성)" = onGenerateConfirm에서만 실제 생성, "취소" = 미생성. */}
      {generateGateOpen && (
        <TablePreviewModal
          columns={s.columns}
          totalRows={computeTotalRows(s.columns)}
          sessionLabel={prospectiveSessionLabel()}
          regenerating={s.tableGenerated}
          onConfirm={onGenerateConfirm}
          onClose={() => setGenerateGateOpen(false)}
        />
      )}
    </div>
  );
}

// ─── table preview modal ───────────────────────────────────────
function TablePreviewModal({
  columns, totalRows, onClose, onConfirm, sessionLabel, regenerating,
}: {
  columns: import('../types').Column[];
  totalRows: number;
  onClose: () => void;
  /** v0.19.0 W3 — 주어지면 '최종 설정값 확인' 게이트 모드: 컬럼 구성·총 행수·세션 라벨 요약을
   *  헤더에 표시하고, 푸터를 "취소 / 확인(생성)"으로 바꿔 확인 시에만 onConfirm을 호출한다.
   *  미주입 시(생성 후 '미리보기')는 기존대로 닫기 전용. */
  onConfirm?: () => void;
  sessionLabel?: string;
  regenerating?: boolean;
}) {
  const MAX_PREVIEW = 50;
  const displayRows = Math.min(totalRows, MAX_PREVIEW);
  const colWidths = columns.map((c) =>
    c.type === 'date' ? 110 : c.type === 'text' || c.type === 'name' || c.type === 'options' ? 100 : 70,
  );
  const isGate = !!onConfirm;
  const voiceCount = columns.filter((c) => c.input === 'voice').length;
  const autoCount = columns.filter((c) => c.input === 'auto').length;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
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
              총 {totalRows}행
              {totalRows > MAX_PREVIEW ? ` (처음 ${MAX_PREVIEW}행 표시)` : ''}
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

        {/* v0.20.0 설정탭#1 — 게이트 요약을 카운트 Pill에서 **컬럼별 상세 행**으로 교체. 각 컬럼의
            입력방식·값/범위(고정값/순차 from~to/선택옵션)·이상치 알람 조건(추세 증가/감소)·이상값
            범위(%)를 한 줄씩 스캔 가능하게 보여준다. 현재 columns prop에서 파생(stale 없음). 게이트
            헤더 스트립은 비스크롤이므로 컬럼이 많아도 모달을 넘지 않게 자체 maxHeight+overflowY. */}
        {isGate && (
          <div
            style={{
              padding: '12px 16px', borderBottom: `1px solid ${T.line}`,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <SummaryPill label="음성입력" value={voiceCount} accent />
              <SummaryPill label="자동입력" value={autoCount} />
              <SummaryPill label="전체 항목" value={columns.length} />
              <SummaryPill label="총 행수" value={totalRows} />
            </div>
            <div
              style={{
                maxHeight: 196, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
                display: 'flex', flexDirection: 'column', gap: 4,
                border: `1px solid ${T.line}`, borderRadius: 10, padding: 4,
                background: T.inputBg,
              }}
            >
              {columns.map((c) => (
                <ColumnDetailRow key={c.id} col={c} />
              ))}
            </div>
            {sessionLabel && (
              <div style={{ fontSize: 13, color: T.textDim }}>
                세션명:{' '}
                <span style={{ color: T.text, fontWeight: 700, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
                  {sessionLabel}
                </span>
              </div>
            )}
          </div>
        )}

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
                {I.check(18, '#06200F')} {regenerating ? '재생성' : '생성'}
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

/** v0.20.0 설정탭#1 — 게이트 컬럼별 상세 한 줄. 값/범위·알람조건·이상값 범위를 columns에서 파생. */
function ColumnDetailRow({ col }: { col: Column }) {
  // 값/범위: 고정값 → 그 값, 순차 → from~to, 옵션 → 선택값(개수), 음성/수동 → 입력대기 표시.
  let valueText: string;
  if (col.input === 'voice') {
    valueText = '음성 입력';
  } else if (col.input === 'touch') {
    valueText = '직접 입력';
  } else if (col.auto.kind === 'seq') {
    valueText = `${col.auto.from} ~ ${col.auto.to}`;
  } else if (col.auto.kind === 'fixed') {
    valueText = col.auto.value || '(빈값)';
  } else if (col.auto.kind === 'options') {
    valueText = col.auto.selected.length > 0 ? col.auto.selected.join(', ') : '(미선택)';
  } else {
    valueText = '';
  }
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
        padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.02)',
      }}
    >
      <span
        style={{
          fontSize: 13, fontWeight: 800, color: T.text, flexShrink: 0,
          maxWidth: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={col.name}
      >
        {col.name || '(이름없음)'}
      </span>
      <span
        style={{
          fontSize: 11, fontWeight: 700, color: T.textMute, flexShrink: 0,
          padding: '1px 7px', borderRadius: 999, border: `1px solid ${T.line}`,
        }}
      >
        {INPUT_LABELS[col.input]}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: T.textDim,
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
            fontSize: 11, fontWeight: 800, color: T.amber, flexShrink: 0,
            padding: '1px 7px', borderRadius: 999, background: 'rgba(255,179,0,0.12)',
          }}
        >
          추세 {trendText}
        </span>
      )}
      {pctText && (
        <span
          style={{
            fontSize: 11, fontWeight: 800, color: T.red, flexShrink: 0,
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

/** v0.19.0 W3 — 게이트 요약 칩(라벨 + 큰 숫자). 의미색 변경 없음(음성=blue accent). */
function SummaryPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        padding: '6px 12px', borderRadius: 10,
        background: accent ? 'rgba(41,121,255,0.12)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${accent ? 'rgba(41,121,255,0.35)' : T.line}`,
      }}
    >
      <span style={{ fontSize: 12, color: accent ? T.blue : T.textDim, fontWeight: 700 }}>{label}</span>
      <span
        style={{
          fontSize: 18, fontWeight: 800, color: accent ? T.blue : T.text,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', letterSpacing: -0.5,
        }}
      >
        {value}
      </span>
    </div>
  );
}
