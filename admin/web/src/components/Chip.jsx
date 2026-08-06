import { Pane } from 'evergreen-ui';

const ACCENT = '#FF4C0B';

// Evergreen has no toggle-chip primitive — used for device lists, browser
// languages, and any other small multi-select set across the admin app.
export function Chip({ selected, disabled, onClick, children }) {
  return (
    <Pane
      is="button"
      type="button"
      disabled={disabled}
      onClick={onClick}
      paddingX={14}
      paddingY={7}
      borderRadius={999}
      border={selected ? '1px solid ' + ACCENT : '1px solid #D8DAE5'}
      background={selected ? ACCENT : 'white'}
      color={selected ? 'white' : '#474D66'}
      fontSize={13}
      fontWeight={selected ? 600 : 400}
      cursor={disabled ? 'not-allowed' : 'pointer'}
    >
      {children}
    </Pane>
  );
}
