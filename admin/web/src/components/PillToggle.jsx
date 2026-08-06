import { Pane } from 'evergreen-ui';

// Matches the black active-pill from the original design tokens (not the
// orange accent — that's reserved for chip/choice selection state, this is
// a plain range switcher). Evergreen has no segmented-control export.
export function PillToggle({ options, value, onChange, labelFor }) {
  return (
    <Pane display="inline-flex" border="1px solid #E7E2DF" borderRadius={999} padding={2}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pane key={opt} is="button" type="button" onClick={() => onChange(opt)}
            paddingX={12} paddingY={5} borderRadius={999} border="none"
            background={active ? '#0A0A0A' : 'transparent'}
            color={active ? 'white' : '#474D66'}
            fontSize={12.5} fontWeight={active ? 600 : 400} cursor="pointer">
            {labelFor ? labelFor(opt) : opt}
          </Pane>
        );
      })}
    </Pane>
  );
}
