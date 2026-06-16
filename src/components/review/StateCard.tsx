/**
 * 비교탭 공용 상태 카드 — 빈/안내/오류/로딩 상태를 한 컴포넌트로 표현([LOAD-1] 교훈:
 * "빈 목록"과 "로드 실패"를 섞지 않고 testId로 구분 렌더). 기존 ReviewScreen 인라인
 * StateCard를 추출(표준 0: 공용 컴포넌트는 한 파일로).
 */
import type { ReactNode } from 'react';
import { T } from '../../tokens';

export function StateCard({
  testId,
  icon,
  title,
  body,
  action,
}: {
  testId: string;
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
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
