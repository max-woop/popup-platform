// Loads the real popup SDK into the admin app itself, so PopupList can preview
// a popup with window.LxPopup.renderInline() — the same preview API the
// templates gallery uses. Singleton: every caller shares one script load and
// one config fetch instead of re-injecting <script> per preview.
let sdkPromise = null;

export function loadSdk() {
  if (sdkPromise) return sdkPromise;

  sdkPromise = fetch('/demo/tokens.css')
    .then((r) => r.text())
    .then((css) => {
      window.LxPopup = window.LxPopup || {};
      window.LxPopup.__css = css;
      window.LxPopup.config = {
        configUrl: '/dist/config.json',
        dataLayer: { page_type: 'promo', country: 'ME', language: 'en' },
        env: 'dev'
      };
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/demo/sdk.js';
        s.onload = () => resolve(window.LxPopup);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    });

  return sdkPromise;
}
