// portal/lib.js — pure, DOM-free helpers + API client. Importable from the
// browser (app.js) and from node tests (test/lib.test.js).

export function apiFetch(base, path, { method = "GET", token, body } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  }).then(async (res) => {
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, data };
  });
}

/** Extract the 128-bit invite token from a portal URL (`…/p/<token>` or `…#/p/<token>`). */
export function parseInviteToken(urlOrHash) {
  const m = String(urlOrHash).match(/\/p\/([A-Za-z0-9_-]{22})/);
  return m ? m[1] : null;
}

/** "Sat 06:00 BRT · 10:00 your time" — dual timezone per docs/01 §4. */
export function fmtDual(iso, tzVenue, tzHome, lang = "en") {
  const locale = lang === "pt" ? "pt-BR" : "en-GB";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const at = (tz) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short"
    }).format(d);
  const venue = at(tzVenue || "UTC");
  if (!tzHome || tzHome === tzVenue) return venue;
  const home = at(tzHome);
  return lang === "pt" ? `${venue} · ${home} (seu fuso)` : `${venue} · ${home} (your time)`;
}

export function fmtDate(iso, tz, lang = "en") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-GB", {
    timeZone: tz || "UTC", weekday: "short", day: "2-digit", month: "short"
  }).format(d);
}

export const STATUS_LABELS = {
  en: { planned: "Scheduled", in_progress: "In progress", checked_out: "Checked out", overdue: "Overdue", scheduled: "Scheduled" },
  pt: { planned: "Agendada", in_progress: "Em andamento", checked_out: "Encerrada", overdue: "Atrasada", scheduled: "Agendada" }
};
export const RISK_LABELS = {
  en: { low: "Low risk", moderate: "Moderate risk", "semi-risky": "Semi-risky — full safeguards" },
  pt: { low: "Risco baixo", moderate: "Risco moderado", "semi-risky": "Semi-arriscado — proteções completas" }
};
export const VERIF_LABELS = {
  en: { pending: "verification pending", verified: "verified", unverified: "unverified", not_required: "routine" },
  pt: { pending: "verificação pendente", verified: "verificada", unverified: "não verificada", not_required: "rotina" }
};

export function statusLabel(status, lang) {
  return (STATUS_LABELS[lang] || STATUS_LABELS.en)[status] || status;
}
export function riskLabel(risk, lang) {
  return (RISK_LABELS[lang] || RISK_LABELS.en)[risk] || risk;
}
export function verifLabel(v, lang) {
  return (VERIF_LABELS[lang] || VERIF_LABELS.en)[v] || v;
}

/** Session persistence — sessionStorage in the browser (cleared on tab close),
 *  injectable in tests. Spec §1 wants httpOnly cookie in prod; the API issues
 *  Bearer tokens, so the cookie flow lands with the deployed portal host. */
export function createSessionStore(storage) {
  const KEY = "hl_portal_session";
  return {
    save(s) { storage.setItem(KEY, JSON.stringify(s)); },
    load() {
      try { return JSON.parse(storage.getItem(KEY)); } catch { return null; }
    },
    clear() { storage.removeItem(KEY); }
  };
}
