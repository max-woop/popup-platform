import { Pane, Heading, Paragraph } from 'evergreen-ui';

// Evergreen ships layout primitives (Pane) but no opinionated "card with a
// header" component — this is the one wrapper shared across every admin
// page so header/body spacing can't drift between pages the way the old
// .card/.card-header/.card-pad CSS classes eventually would have (that's
// exactly how EntitySelect's `lbx` entity went missing from three
// hand-copied forms — see EntitySelect.jsx).
export function Card({ title, subtitle, right, bodyPadding = 20, children, ...rest }) {
  return (
    <Pane background="white" borderRadius={8} border="default" {...rest}>
      {(title || right) && (
        <Pane display="flex" alignItems="flex-start" justifyContent="space-between" padding={20} borderBottom="1px solid #EDF0F5">
          <Pane>
            {title && <Heading size={500}>{title}</Heading>}
            {subtitle && <Paragraph size={400} color="muted" marginTop={4}>{subtitle}</Paragraph>}
          </Pane>
          {right}
        </Pane>
      )}
      <Pane padding={bodyPadding}>{children}</Pane>
    </Pane>
  );
}
