'use strict';

// Admin-side image upload — closes the gap where a new asset had no path
// onto cdn.libertex.* from inside this platform at all (image_url could
// only ever point at something that already existed there). Deliberately
// separate from the source-system ingestion contract (§13): a source
// system still just sends a real CDN URL in content.image_url as always;
// this exists purely so an operator editing image_url by hand (§10.1's one
// deliberate content exception, routes/popups.js) has somewhere to put a
// new file rather than needing a separate CDN pipeline outside this tool.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { requireRole } = require('../lib/adminHelpers');

const router = express.Router();

// Sibling of data/db.json and data/dist/ (§3.1's storage note) — inside
// data/ specifically so it survives on the same Railway Volume the SQLite
// file already depends on, not baked into the image.
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — generous for a popup image, not for abuse
// Raster only, deliberately no image/svg+xml: an SVG is executable markup
// (can carry <script>/event-handler XSS, §10.2), not just pixels — the
// exact class of risk this codebase's "never trust content" posture exists
// to rule out. Rejecting it at upload is simpler and safer than trying to
// sanitize SVG markup after the fact.
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    // Server-generated name, never the client-supplied original filename —
    // that's the actual control against path traversal / weird characters
    // / collisions, not the extension allowlist below (which is about
    // content type, a different concern).
    const ext = ALLOWED_TYPES[file.mimetype];
    cb(null, crypto.randomUUID() + '.' + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: function (req, file, cb) {
    cb(null, Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, file.mimetype));
  }
});

router.post('/uploads', requireRole('operator'), function (req, res) {
  upload.single('file')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5MB limit' : err.message;
      return res.status(422).json({ error: 'validation_failed', details: [{ path: 'file', message: message }] });
    }
    if (err) return res.status(500).json({ error: 'upload_failed', message: err.message });
    if (!req.file) {
      return res.status(422).json({ error: 'validation_failed', details: [{ path: 'file', message: 'required, and must be image/jpeg, image/png, image/webp, or image/gif' }] });
    }
    // Absolute URL, built from this request's own host — never a relative
    // path — so the value written into content.image_url is a complete,
    // ready-to-render URL the moment it's saved, with no separate
    // resolve-against-config-origin logic needed on the SDK side. In local
    // dev (plain http) the popup itself still won't actually render this
    // image — sdk.js's safeUrl() (§10.2) requires https on every rendered
    // URL, on purpose, and that's correct, not a bug to chase: req.protocol
    // reflects real https once this runs behind Railway's proxy (trust
    // proxy is already set in index.js), which is the only place a visitor
    // ever sees it.
    const url = req.protocol + '://' + req.get('host') + '/uploads/' + req.file.filename;
    res.status(201).json({ url: url, bytes: req.file.size });
  });
});

module.exports = router;
module.exports.UPLOADS_DIR = UPLOADS_DIR;
