const GALLERY_URL = 'http://localhost:8080/templates.html';

export default function Templates() {
  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Templates</h2>
            <p>
              Style guide for all six templates (§5) — rendered through the real SDK, not mockups.
              Served by the separate static harness at <code>{GALLERY_URL}</code>; open it directly if this frame is blank.
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
