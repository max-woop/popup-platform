'use strict';

const crypto = require('crypto');
const store = require('./store');
const publisher = require('./publisher');

// Simulated identity (§10.4: real deployment uses corporate SSO/OIDC with
// Viewer/Operator roles, plus Compliance for the legal registry per §11.3.6).
// The frontend's role switcher sends the headers index.js reads into
// req.actor; there is no real auth here, which is fine for a local admin
// prototype and not fine for anything that touches real popups.
const ROLE_RANK = { viewer: 0, operator: 1, compliance: 2 };

function requireRole(minRole) {
  return function (req, res, next) {
    const rank = ROLE_RANK[req.actor.role] ?? -1;
    // Compliance can do everything Operator can (audit/read/pause), except
    // where a route explicitly wants Operator-or-Compliance vs Compliance-only.
    if (minRole === 'compliance-only') {
      if (req.actor.role !== 'compliance') {
        return res.status(403).json({ error: 'forbidden', message: 'Requires the Compliance role.' });
      }
      return next();
    }
    if (rank < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: 'forbidden', message: 'Requires ' + minRole + ' role or above.' });
    }
    next();
  };
}

function audit(db, req, action, entityType, entityId, before, after) {
  db.audit_log.unshift({
    id: 'aud-' + crypto.randomUUID().slice(0, 8),
    actor: req.actor.email,
    role: req.actor.role,
    action: action,
    entity_type: entityType,
    entity_id: entityId,
    before: before,
    after: after,
    timestamp: new Date().toISOString()
  });
}

function popupSummary(p) {
  return {
    id: p.external_id, external_id: p.external_id, name: p.name, template: p.template,
    status: p.status, priority: p.priority, starts_at: p.starts_at, ends_at: p.ends_at,
    devices: p.devices, trigger: p.trigger, updated_at: p.updated_at,
    legal_mode: p.content && p.content.legal && p.content.legal.mode
  };
}

function popupDetail(p) {
  // Admin/web treats "id" as the human-facing external_id throughout — the
  // internal uuid (§3.1's real primary key) never needs to leave the server.
  return Object.assign({}, p, { id: p.external_id });
}

function republish() { return publisher.publish(store.load()); }

module.exports = { requireRole, audit, popupSummary, popupDetail, republish };
