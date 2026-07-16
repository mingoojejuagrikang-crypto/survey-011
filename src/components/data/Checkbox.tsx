import { T } from '../../tokens';
import { I } from '../icons';

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 24, height: 24, borderRadius: 6,
        border: `2px solid ${checked ? T.blue : T.lineStrong}`,
        background: checked ? T.blue : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 150ms, border 150ms',
      }}
    >
      {checked && I.check(14, '#fff')}
    </div>
  );
}
