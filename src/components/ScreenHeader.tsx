import { ReactNode } from 'react';
import { T } from '../tokens';

interface Props {
  /** v0.19.0 W1 — 탭 이름 큰 타이틀은 하단 TabBar 하이라이트와 중복이라 제거.
   *  title은 옵셔널로 남겨 두지만 더 이상 어디서도 전달하지 않는다. sub(기능 안내)와
   *  right(액션 슬롯)만 사용한다. title이 들어오면(레거시) 기존대로 렌더한다. */
  title?: string;
  sub?: string;
  right?: ReactNode;
}

export function ScreenHeader({ title, sub, right }: Props) {
  // 표시할 내용(title/sub/right)이 하나도 없으면 빈 헤더를 렌더하지 않는다.
  if (!title && !sub && !right) return null;
  return (
    <div
      style={{
        padding: '14px 18px 10px',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
        flexShrink: 0,
        minHeight: 0,
      }}
    >
      <div>
        {title && (
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.4, color: T.text }}>
            {title}
          </div>
        )}
        {sub && (
          <div style={{ fontSize: 15, color: T.textDim, letterSpacing: -0.1 }}>
            {sub}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}
