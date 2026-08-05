'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { checkRegexSafety } = require('./regexSafety');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// §5.1 — legal is structural (§11.3.4): present at the top level of content
// only, never inside an override, and additionalProperties:false on the
// override object makes that structurally impossible rather than a
// convention someone can forget.
const legalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { enum: ['auto', 'off', 'custom'], default: 'auto' },
    off_reason: { type: 'string', maxLength: 200 },
    custom_text: { type: 'string', maxLength: 500 }
  },
  allOf: [
    { if: { properties: { mode: { const: 'off' } } }, then: { required: ['off_reason'] } },
    { if: { properties: { mode: { const: 'custom' } } }, then: { required: ['custom_text'] } }
  ]
};

const overrideSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hidden: { type: 'boolean' },
    heading: { type: 'string', maxLength: 80 },
    body: { type: 'string', maxLength: 200 },
    image_url: { type: 'string', pattern: '^https://cdn\\.libertex\\..*' }
  }
};

const IMAGE_HOST_PATTERN = '^https://cdn\\.libertex\\..*';
const HTTPS_ONLY_PATTERN = '^https://';

// Identical across every template that has a CTA at all, except modal_form
// (whose button submits the embedded llLanding widget, so no cta_url exists
// to validate) — spread this in rather than retyping the same two fields.
const CTA_FIELDS = {
  cta_label: { type: 'string', maxLength: 30 },
  cta_url: { type: 'string', pattern: HTTPS_ONLY_PATTERN }
};

// Every named pairing tokens.css defines (§4.2) — the three canonical
// Libertex identities (orange/black/white), the extended-spectrum pairings,
// and LBX's own three (blue/black/white, a separate palette for a separate
// brand — see tokens.css's LBX colour block). Validating against this list
// at ingestion is what actually stops a typo'd or invented theme name from
// reaching the SDK, not just documentation.
const VALID_THEMES = [
  'orange', 'black', 'white',
  'white-black', 'white-orange', 'black-white', 'black-orange',
  'orange-black', 'orange-white', 'orange-brown', 'brown-orange',
  'neon-black', 'offwhite-orange', 'orange200-black', 'silver-orange',
  'lbx-blue', 'lbx-black', 'lbx-white'
];

function withCommon(props, required) {
  return {
    type: 'object',
    additionalProperties: false,
    required: required,
    properties: Object.assign({
      theme: { enum: VALID_THEMES },
      show_logo: { type: 'boolean', default: false },
      legal: legalSchema,
      overrides: {
        type: 'object',
        additionalProperties: false,
        properties: { mobile: overrideSchema, tablet: overrideSchema, desktop: overrideSchema }
      }
    }, props)
  };
}

const CONTENT_SCHEMAS = {
  banner: withCommon(Object.assign({
    heading: { type: 'string', maxLength: 120 },
    position: { enum: ['top', 'bottom'], default: 'top' }
  }, CTA_FIELDS), ['heading']),

  modal: withCommon(Object.assign({
    heading: { type: 'string', maxLength: 80 },
    subheading: { type: 'string', maxLength: 100 },
    body: { type: 'string', maxLength: 400 },
    // Square (§4.7.2 "square or portrait formats") — logo/heading/subhead
    // grouped near the top, CTA and legal pinned to the bottom edge.
    shape: { enum: ['auto', 'square'], default: 'auto' }
  }, CTA_FIELDS), ['heading']),

  modal_media: withCommon(Object.assign({
    heading: { type: 'string', maxLength: 80 },
    body: { type: 'string', maxLength: 400 },
    image_url: { type: 'string', pattern: IMAGE_HOST_PATTERN },
    image_alt: { type: 'string', maxLength: 125 }
  }, CTA_FIELDS), ['heading', 'cta_label', 'cta_url']),

  // §9's rewrite: modal_form embeds the existing llLanding registration
  // widget rather than a per-popup field/forward_to/success_action model —
  // same shape as `modal`. Which fields exist, the consent wording, and
  // submission itself are resolved centrally (registration_domains /
  // consent_texts), never typed per popup — see popup-platform-spec.md §9.
  modal_form: withCommon({
    heading: { type: 'string', maxLength: 80 },
    body: { type: 'string', maxLength: 400 },
    cta_label: { type: 'string', maxLength: 30 }
  }, ['heading']),

  // §5.4 — button-only answers, capped at 3 questions. No free-text field
  // exists to validate, by design: nothing here can carry a payload.
  questionnaire: withCommon({
    heading: { type: 'string', maxLength: 80 },
    body: { type: 'string', maxLength: 200 },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'options'],
        properties: {
          id: { type: 'string', maxLength: 40, pattern: '^[a-z][a-z0-9_]*$' },
          text: { type: 'string', maxLength: 120 },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'value'],
              properties: {
                label: { type: 'string', maxLength: 40 },
                value: { type: 'string', maxLength: 40 }
              }
            }
          }
        }
      }
    },
    completion: {
      type: 'object',
      additionalProperties: false,
      properties: Object.assign({
        heading: { type: 'string', maxLength: 80 },
        body: { type: 'string', maxLength: 200 }
      }, CTA_FIELDS)
    }
  }, ['heading', 'questions']),

  // §5.5 — Market Prediction Challenge: pick an asset, predict higher/lower
  // vs. a client-simulated close. start_price is content the source system
  // supplies, never a live quote this platform fetches or invents — see the
  // spec section on why the rendered UI carries a persistent disclaimer
  // rather than a one-time footnote.
  gamification: withCommon(Object.assign({
    heading: { type: 'string', maxLength: 80 },
    body: { type: 'string', maxLength: 200 },
    duration_ms: { type: 'integer', minimum: 2000, maximum: 15000 },
    volatility_pct: { type: 'number', minimum: 0.05, maximum: 5 },
    win_body: { type: 'string', maxLength: 200 },
    lose_body: { type: 'string', maxLength: 200 },
    assets: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'label', 'start_price'],
        properties: {
          symbol: { type: 'string', maxLength: 12 },
          label: { type: 'string', maxLength: 24 },
          start_price: { type: 'number', exclusiveMinimum: 0 }
        }
      }
    }
  }, CTA_FIELDS), ['heading', 'assets'])
};

const validators = Object.fromEntries(
  Object.entries(CONTENT_SCHEMAS).map(([k, schema]) => [k, ajv.compile(schema)])
);

const ruleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['d', 'op'],
  properties: {
    // cookie/element_exists are client-only (document.cookie, DOM presence) —
    // the admin URL tester can't evaluate them for a hypothetical URL, so it
    // flags rules using either as unverifiable rather than silently treating
    // them as non-matching (lib/targeting.js).
    d: { enum: ['path', 'url', 'query', 'referrer', 'device', 'datalayer', 'language', 'country', 'cookie', 'element_exists'] },
    op: { enum: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'not_in', 'exists'] },
    a: { type: 'string', maxLength: 60 },
    v: {},
    negate: { type: 'boolean' }
  }
};
const validateRule = ajv.compile(ruleSchema);

const topLevelSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'template_id', 'content'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    template_id: { enum: Object.keys(CONTENT_SCHEMAS) },
    status: { enum: ['live', 'paused', 'draft'] },
    priority: { type: 'integer', minimum: 0, maximum: 1000 },
    starts_at: { type: ['string', 'null'], format: 'date-time' },
    ends_at: { type: ['string', 'null'], format: 'date-time' },
    devices: { type: 'array', items: { enum: ['desktop', 'tablet', 'mobile'] }, minItems: 1 },
    trigger: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        // value's unit depends on type: delay is milliseconds, scroll is
        // percent, inactivity is seconds — see sdk.js's arm().
        type: { enum: ['immediate', 'delay', 'scroll', 'exit_intent', 'element_click', 'inactivity'] },
        value: {},
        selector: { type: 'string', maxLength: 200 }
      }
    },
    frequency: {
      type: 'object',
      additionalProperties: false,
      properties: {
        max_impressions: { type: 'integer', minimum: 1 },
        per: { enum: ['session', 'day', 'lifetime'] },
        dismiss_ttl_days: { type: 'integer', minimum: 0 }
      }
    },
    content: { type: 'object' }, // validated separately, dispatched by template_id
    targeting: { type: 'array', items: { type: 'array', items: ruleSchema } }
  }
};
const validateTopLevel = ajv.compile(topLevelSchema);

function fieldErrors(ajvErrors, prefix) {
  return (ajvErrors || []).map((e) => ({
    path: (prefix ? prefix : '') + (e.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : '(root)'),
    message: e.message + (e.params && e.params.additionalProperty ? ': ' + e.params.additionalProperty : '')
  }));
}

// Returns { ok, details } for 400s, or throws nothing — 422 semantic checks
// are the caller's job since they depend on more than shape.
function validateUpsertBody(body) {
  const details = [];

  if (!validateTopLevel(body)) details.push(...fieldErrors(validateTopLevel.errors, ''));

  if (body && body.template_id && CONTENT_SCHEMAS[body.template_id] && body.content && typeof body.content === 'object') {
    const validate = validators[body.template_id];
    if (!validate(body.content)) details.push(...fieldErrors(validate.errors, 'content.'));
  }

  if (Array.isArray(body?.targeting)) {
    body.targeting.forEach((group, gi) => {
      (group || []).forEach((rule, ri) => {
        if (!validateRule(rule)) {
          details.push(...fieldErrors(validateRule.errors, 'targeting[' + gi + '][' + ri + '].'));
          return;
        }
        if (rule.op === 'regex') {
          const safe = checkRegexSafety(rule.v);
          if (!safe.ok) details.push({ path: 'targeting[' + gi + '][' + ri + '].v', message: safe.reason });
        }
      });
    });
  }

  return { ok: details.length === 0, details };
}

function validateSemantics(body) {
  const details = [];
  if (body.starts_at && body.ends_at && Date.parse(body.ends_at) <= Date.parse(body.starts_at)) {
    details.push({ path: 'ends_at', message: 'must be after starts_at' });
  }
  return { ok: details.length === 0, details };
}

module.exports = { validateUpsertBody, validateSemantics, CONTENT_SCHEMAS, VALID_THEMES };
