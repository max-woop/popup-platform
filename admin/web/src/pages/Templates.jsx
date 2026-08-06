import { Text, Code, Button } from 'evergreen-ui';
import { Card } from '../components/Card.jsx';

// Dev serves this from the separate static harness (`npx serve` on :8080);
// a real deployment serves it from admin/server's own /demo mount instead
// (see admin/server/index.js), same-origin with this admin UI.
const GALLERY_URL = import.meta.env.PROD ? '/demo/templates.html' : 'http://localhost:8080/templates.html';

export default function Templates() {
  return (
    <Card
      title="Templates"
      subtitle={<>Style guide for all six templates (§5) — rendered through the real SDK, not mockups. Open <Code>{GALLERY_URL}</Code> directly if this frame is blank.</>}
      right={<Button is="a" href={GALLERY_URL} target="_blank" rel="noopener noreferrer" whiteSpace="nowrap">Open in new tab ↗</Button>}
      bodyPadding={0}
    >
      <iframe
        src={GALLERY_URL}
        title="Popup templates style guide"
        style={{ width: '100%', height: '80vh', border: 0, display: 'block' }}
      />
    </Card>
  );
}
