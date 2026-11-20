// Payload validation + sanitizing. Zero deps.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f]", "g");

function cleanString(value, max) {
  if (typeof value !== "string") return null;
  // strip control chars, trim
  const v = value.replace(CONTROL_CHARS, "").trim();
  if (v.length > max) return null;
  return v;
}

/**
 * Validate a waitlist entry coming from the landing page.
 * Returns { ok: true, value } or { ok: false, errors: [{field, message}] }.
 */
export function validateWaitlist(body) {
  const errors = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  }

  const name = cleanString(body.name, 120);
  if (!name) errors.push({ field: "name", message: "name is required (max 120 chars)" });

  const email = cleanString(body.email, 254);
  if (!email || !EMAIL_RE.test(email)) {
    errors.push({ field: "email", message: "valid email is required" });
  }

  let destination = null;
  if (body.destination !== undefined && body.destination !== null && body.destination !== "") {
    destination = cleanString(body.destination, 120);
    if (destination === null) errors.push({ field: "destination", message: "max 120 chars" });
  }

  let lang = "en";
  if (body.lang !== undefined && body.lang !== null && body.lang !== "") {
    const l = cleanString(body.lang, 5);
    if (l !== "en" && l !== "pt") errors.push({ field: "lang", message: "lang must be 'en' or 'pt'" });
    else lang = l;
  }

  let source = "landing";
  if (body.source !== undefined && body.source !== null && body.source !== "") {
    const s = cleanString(body.source, 40);
    if (s) source = s;
  }

  let ts = new Date().toISOString();
  if (body.ts !== undefined && body.ts !== null && body.ts !== "") {
    const t = cleanString(body.ts, 40);
    if (t && !Number.isNaN(Date.parse(t))) ts = new Date(t).toISOString();
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, email: email.toLowerCase(), destination, lang, source, ts } };
}
