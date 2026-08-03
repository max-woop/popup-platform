/* ============================================================================
   mock-landing-api.js — LOCAL DEV / DEMO ONLY. NOT PART OF THE SDK.

   Stands in for the real third-party widget already live on production
   Libertex domains: lib.libertex.com/landing/js/landing-api.min.2.5.0.js and
   lib.libertex.org/landing/js/landing-api.min.2.6.0.js (see popup-platform-
   spec.md §9). That script POSTs real credentials to a real registration
   backend using a real per-domain apiKey — this file exists so local
   previews (templates.html) and tests never do that by accident.

   Implements just enough of the real interface —
   `llLanding.create({ form, apiKey, registrationCallback })` — for the SDK's
   registration-domain integration code (sdk.js's buildForm) to exercise the
   exact same call shape it would use against the real script. Swap the
   registration_domains registry entry's `script_src` to the real URL and
   this file is never loaded — nothing else changes.

   Whatever this fakes: no network call, no real CAPTCHA, no real backend.
   Submitting always "succeeds" after a short delay, with a made-up
   clientID, so the embedding page's registrationCallback → utag.view()
   wiring can be verified end-to-end without touching anything real.
   ========================================================================= */

(function () {
  'use strict';

  function uuid() {
    return 'mock-' + Math.random().toString(36).slice(2, 10);
  }

  window.llLanding = {
    create: function (opts) {
      opts = opts || {};
      var form = typeof opts.form === 'string' ? document.querySelector(opts.form) : opts.form;
      if (!form) {
        console.warn('[mock-landing-api] form not found for selector:', opts.form);
        return null;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var submitBtn = form.querySelector('[type="submit"]');
        var originalLabel = submitBtn ? submitBtn.value : null;
        if (submitBtn) submitBtn.value = submitBtn.dataset.wait || 'Please wait...';

        setTimeout(function () {
          if (submitBtn && originalLabel != null) submitBtn.value = originalLabel;

          var fakeResult = { data: { clientID: uuid() } };
          function goFurther() {
            console.log('[mock-landing-api] goFurther() — no real redirect in this mock');
          }

          if (typeof opts.registrationCallback === 'function') {
            opts.registrationCallback(fakeResult, goFurther);
          } else {
            goFurther();
          }
        }, 400);
      });

      return { destroy: function () {} };
    }
  };
})();
