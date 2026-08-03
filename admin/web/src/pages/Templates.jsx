// Dev serves this from the separate static harness (`npx serve` on :8080);
// a real deployment serves it from admin/server's own /demo mount instead
// (see admin/server/index.js), same-origin with this admin UI.
const GALLERY_URL = import.meta.env.PROD ? '/demo/templates.html' : 'http://localhost:8080/templates.html';

export default function Templates() {
  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Templates</h2>
            <p>
              Style guide for all six templates (§5) — rendered through the real SDK, not mockups.
              Open <code>{GALLERY_URL}</code> directly if this frame is blank.
            </p>
          </div>
          <a className="btn btn-sm" href={GALLERY_URL} target="_blank" rel="noopener noreferrer" style={{ whiteSpace: 'nowrap' }}>Open in new tab ↗</a>
        </div>
        <iframe
          src={GALLERY_URL}
          title="Popup templates style guide"
          style={{ width: '100%', height: '80vh', border: 0, display: 'block' }}
        />
      </div>
    </div>
  );
}
