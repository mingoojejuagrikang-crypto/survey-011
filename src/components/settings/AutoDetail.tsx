import { T } from '../../tokens';
import type { Column } from '../../types';
import { autoValue } from '../../lib/autoValue';
import { MiniInput } from './MiniInput';
import { SegmentToggle } from './SegmentToggle';

export function AutoDetail({ col, onChange }: { col: Column; onChange: (c: Column) => void }) {
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
