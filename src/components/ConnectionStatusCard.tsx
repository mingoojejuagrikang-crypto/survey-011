/**
 * v0.33.0 항목5 — 연결 3상태 분리 표시 (07-10 QA P1 #1).
 *
 * 종전엔 "연결" 상태가 googleConnected(persist) 하나로 뭉뚱그려져, 토큰 만료 후에도 '연결됨'을
 * 거짓 표시했고([AUTH-7] stale 표시), 이상치 알람의 실제 가용성(과거값 인덱스)은 아예 보이지
 * 않았다(07-13 §4: 알람 침묵을 사용자가 알 방법이 없음). 이 카드는 세 상태를 분리해 보인다:
 *
 *  1. Google 연결 — `getStoredToken()` **실시간 판정**(만료 반영). persist 값이 아니라 토큰
 *     스토리지를 직접 읽고, 30s 폴링 + onTokenSettled 구독으로 갱신 → stale 표시 해소.
 *  2. 시트 연결 — 시트 URL(파싱 성공) + 탭 선택 여부. 저장 목록의 파일명으로 표기.
 *  3. 과거값 준비 — pastValues 상태 스냅샷: "N행 · M회차 준비됨(x시간 전)". 신선 캐시(green) /
 *     영속 폴백(amber, 오래된 비교선) / 불러오는 중 / 미준비 + **재시도 버튼**(백오프 리셋).
 *
 * 설정탭 + 입력탭 시작 카드 양쪽에서 재사용. 텍스트에 '연결됨'을 쓰지 않는다 — 설정탭 Google
 * 버튼("연결됨 · email")과 `text=연결됨` 로케이터(auth-signin-timeout.spec) strict mode 충돌 방지.
 */
import { useEffect, useState } from 'react';
import { T } from '../tokens';
import { useSettingsStore } from '../stores/settingsStore';
import { getStoredToken, onTokenSettled } from '../lib/googleAuth';
import { parseSpreadsheetId } from '../lib/sheets';
import {
  getPastIndexStatus,
  prefetchPastIndex,
  resetPastIndexRetries,
  subscribePastIndexStatus,
} from '../lib/pastValues';
import { logger } from '../lib/logger';

/** epoch ms → "방금" / "N분 전" / "N시간 전" / "N일 전". */
export function formatAge(builtAt: number, now: number): string {
  const diff = Math.max(0, now - builtAt);
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

function StatusRow({ label, value, tone, testId, action }: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'off';
  testId: string;
  action?: React.ReactNode;
}) {
  const color = tone === 'ok' ? T.green : tone === 'warn' ? T.amber : T.textMute;
  return (
    <div data-testid={testId} data-tone={tone} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, minHeight: 28 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, flexShrink: 0, width: 64 }}>
        {label}
      </span>
      <span
        style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700,
          color, textAlign: 'right',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
        title={value}
      >
        {value}
      </span>
      {action}
    </div>
  );
}

export function ConnectionStatusCard() {
  const s = useSettingsStore();
  // 실시간 재평가 틱: 토큰 만료(시간 경과)·배지 나이 표기를 30s 주기로 갱신 +
  // 과거값 인덱스 상태 변화(fetch 시작/완료/폴백 하이드레이션)는 구독으로 즉시 반영.
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsubIndex = subscribePastIndexStatus(bump);
    const unsubToken = onTokenSettled(bump);
    const timer = window.setInterval(bump, 30_000);
    return () => { unsubIndex(); unsubToken(); window.clearInterval(timer); };
  }, []);

  // 1) Google 연결 — 토큰 실시간 판정([AUTH-7] 해소: persist가 아니라 지금 유효한 토큰).
  const token = getStoredToken();
  const knewAccount = !!(s.userEmail || s.googleConnected);
  const googleValue = token
    ? `로그인됨 · ${token.email ?? s.userEmail ?? ''}`
    : knewAccount ? '재로그인 필요' : '미로그인';
  const googleTone: 'ok' | 'warn' | 'off' = token ? 'ok' : knewAccount ? 'warn' : 'off';

  // 2) 시트 연결 — URL 파싱 + 탭 선택. 저장 목록의 파일명으로 표기(요약 팝업과 동일 규칙).
  const sheetId = parseSpreadsheetId(s.sheetUrl);
  const sheetName = sheetId ? s.savedSheets.find((x) => x.sheetId === sheetId)?.name ?? '시트' : null;
  const sheetValue = sheetId
    ? `${sheetName}${s.sheetTab ? ` · ${s.sheetTab}` : ''}`
    : '미선택';
  const sheetTone: 'ok' | 'warn' | 'off' = sheetId && s.sheetTab ? 'ok' : sheetId ? 'warn' : 'off';

  // 3) 과거값 준비 — 알람 비교선의 실제 가용성.
  const idx = getPastIndexStatus();
  const now = Date.now();
  const idxValue =
    idx.state === 'ready' || idx.state === 'stale'
      ? `${idx.rowCount}행 · ${idx.roundCount}회차 준비됨(${formatAge(idx.builtAt ?? now, now)})`
      : idx.state === 'loading' ? '불러오는 중…' : '미준비';
  const idxTone: 'ok' | 'warn' | 'off' =
    idx.state === 'ready' ? 'ok' : idx.state === 'stale' ? 'warn' : 'off';
  const showRetry = idx.state === 'stale' || idx.state === 'none';

  const retry = showRetry ? (
    <button
      type="button"
      data-testid="past-index-retry"
      onClick={() => {
        logger.log({ type: 'app', extra: 'past_index_retry:manual' });
        resetPastIndexRetries();
        prefetchPastIndex();
      }}
      style={{
        flexShrink: 0, minHeight: 28, padding: '0 10px', borderRadius: 999,
        border: `1px solid ${T.lineStrong}`, background: 'transparent',
        color: T.textDim, fontSize: 12, fontWeight: 800, cursor: 'pointer',
      }}
    >
      재시도
    </button>
  ) : undefined;

  return (
    <div
      data-testid="connection-status-card"
      style={{
        background: T.card, border: `1px solid ${T.line}`, borderRadius: 14,
        padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 4,
        width: '100%',
      }}
    >
      <StatusRow label="Google 연결" value={googleValue} tone={googleTone} testId="conn-google" />
      <StatusRow label="시트 연결" value={sheetValue} tone={sheetTone} testId="conn-sheet" />
      <StatusRow label="과거값 준비" value={idxValue} tone={idxTone} testId="conn-past" action={retry} />
    </div>
  );
}
