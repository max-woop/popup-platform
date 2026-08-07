const IDENTITIES = {
  viewer: { email: 'viewer@libertex.com', role: 'viewer', label: 'Viewer' },
  operator: { email: 'o.petrov@libertex.com', role: 'operator', label: 'Operator' },
  compliance: { email: 'm.ivanova@libertex.com', role: 'compliance', label: 'Compliance' }
};

function currentIdentity() {
  const key = localStorage.getItem('lx_admin_role') || 'operator';
  return IDENTITIES[key] || IDENTITIES.operator;
}

async function request(path, options = {}) {
  const identity = currentIdentity();
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Lx-Role': identity.role,
      'X-Lx-Actor': identity.email,
      ...(options.headers || {})
    }
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((body && body.message) || (body && body.error) || 'request_failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  identities: IDENTITIES,
  currentIdentity,

  popups: {
    list: () => request('/popups'),
    get: (id) => request('/popups/' + id),
    update: (id, patch) => request('/popups/' + id, { method: 'PATCH', body: JSON.stringify(patch) }),
    pause: (id) => request('/popups/' + id + '/pause', { method: 'POST' }),
    archive: (id) => request('/popups/' + id, { method: 'DELETE' })
  },

  urlTester: (payload) => request('/url-tester', { method: 'POST', body: JSON.stringify(payload) }),

  stats: (params) => request('/stats?' + new URLSearchParams(params).toString()),
  statsOverview: (params) => request('/stats/overview?' + new URLSearchParams(params).toString()),

  questionnaire: {
    popups: () => request('/questionnaire-popups'),
    stats: (popupId) => request('/questionnaire-stats?' + new URLSearchParams({ popup_id: popupId }).toString())
  },

  legalTexts: {
    get: () => request('/legal-texts'),
    publish: (payload) => request('/legal-texts', { method: 'POST', body: JSON.stringify(payload) }),
    saveDomain: (payload) => request('/entity-domains', { method: 'POST', body: JSON.stringify(payload) })
  },

  registration: {
    domains: () => request('/registration-domains'),
    saveDomain: (payload) => request('/registration-domains', { method: 'POST', body: JSON.stringify(payload) }),
    consentTexts: () => request('/consent-texts'),
    publishConsent: (payload) => request('/consent-texts', { method: 'POST', body: JSON.stringify(payload) })
  },

  settings: {
    get: () => request('/settings'),
    update: (patch) => request('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    createApiKey: (name) => request('/settings/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    revokeApiKey: (id) => request('/settings/api-keys/' + id, { method: 'DELETE' })
  },

  auditLog: () => request('/audit-log'),

  experiments: {
    list: () => request('/experiments'),
    resolve: (group, winnerId) => request('/experiments/' + group + '/resolve', { method: 'POST', body: JSON.stringify({ winner_id: winnerId }) })
  }
};
