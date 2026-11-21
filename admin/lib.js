// admin/lib.js — pure helpers for the admin console (self-contained, like
// portal/lib.js). Importable from app.js and from node tests.

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

export function createTokenStore(storage) {
  const KEY = "hl_admin_token";
  return {
    save(t) { storage.setItem(KEY, t); },
    load() { return storage.getItem(KEY); },
    clear() { storage.removeItem(KEY); }
  };
}

export function fmtTs(iso, lang = "en") {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(d);
}

export function fmtMoney(cents) {
  return `R$ ${(Number(cents || 0) / 100).toFixed(2)}`;
}

export const BOOKING_STATUS = {
  en: { pending_payment: "Pending payment", paid: "Paid", waitlisted: "Waitlisted", cancelled: "Cancelled", no_show: "No-show" },
  pt: { pending_payment: "Pagamento pendente", paid: "Pago", waitlisted: "Lista de espera", cancelled: "Cancelada", no_show: "No-show" }
};
export const RUN_STATUS = {
  en: { in_progress: "In progress", checked_out: "Checked out", overdue: "OVERDUE" },
  pt: { in_progress: "Em andamento", checked_out: "Encerrada", overdue: "ATRASADA" }
};
export function bookingStatusLabel(s, lang) { return (BOOKING_STATUS[lang] || BOOKING_STATUS.en)[s] || s; }
export function runStatusLabel(r, lang) { const s = r.overdue ? "overdue" : r.status; return (RUN_STATUS[lang] || RUN_STATUS.en)[s] || s; }
