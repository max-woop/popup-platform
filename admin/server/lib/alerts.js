'use strict';

/* §16.1's Alert table specifies six signals but wires none of them to an
   actual channel — a real publish failure or error-rate spike was silent
   until someone happened to check. This module is the missing "then what":
   a generic notify(), plus real hooks at the failure points that already
   exist in this codebase.

   Deliberately pluggable rather than hard-wired to one provider: set
   ALERT_WEBHOOK_URL to a real endpoint (Slack/Discord/Teams incoming
   webhooks all accept this shape; anything else can read the JSON body)
   and alerts post there. Leave it unset and alerts still land in the
   server log — never silently dropped, never blocking the request that
   triggered them, and never invented — this file ships no webhook URL of
   its own, because there isn't a real one to ship. */

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || null;

function notify(signal, message, detail) {
  const payload = { signal, message, detail: detail || null, at: new Date().toISOString() };
  console.error('[ALERT]', signal, '—', message, detail ? JSON.stringify(detail) : '');

  if (!WEBHOOK_URL) return;
  // Slack-compatible {text} shape — the lowest common denominator most
  // webhook receivers (Slack, Discord w/ a thin adapter, generic HTTP
  // logging endpoints) can do something with unmodified.
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '[' + signal + '] ' + message, payload })
  }).catch((e) => {
    // The alert itself failing to send must never take down the request
    // that triggered it, and must never throw somewhere nobody awaits it.
    console.error('[ALERT] webhook delivery failed:', e.message);
  });
}

module.exports = { notify };
