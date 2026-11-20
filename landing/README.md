# landing/ — public landing page + waitlist (static, PT/EN)

First buildable artifact of the 90-day plan (weeks 1–2). Implements the approved copy in `docs/03-landing-page-copy.md`, PT + EN with a header toggle (persisted in `localStorage`, defaults from browser language).

Deliberately dependency-free: plain HTML/CSS/JS, system fonts, **no third-party scripts or trackers** (privacy-by-design; analytics stay internal per the master plan).

## Run locally

```bash
cd landing
python3 -m http.server 8123
# open http://localhost:8123
```

Any static host works (GitHub Pages, Netlify, Cloudflare Pages, S3…). No build step.

> **Port note:** use **8123**, not 8080. If another local app already owns 8080
> (on IPv4), `http://localhost:8080/` may resolve to it and you'll see a JSON
> error like `{"error":{"code":"not_found","message":"Rota não encontrada"}}`
> instead of this page. To hit our server specifically on 8080, use the IPv6
> loopback: `http://[::1]:8080/` — or just use 8123 as above.

## Files

- `index.html` — structure; every user-facing string carries a `data-i18n` key
- `styles.css` — calm, anti-addictive styling (warm paper + deep green, serif headings)
- `app.js` — i18n dictionary (EN/PT), language toggle, waitlist form logic

## Waitlist wiring

`app.js` has `const WAITLIST_ENDPOINT = ""` at the top.

- **Pre-backend (now):** leave empty. Submissions are queued in `localStorage` (`hl_waitlist_queue`) — offline-first, on brand — and shown a success state. Export the queue from the browser console when needed. Alternatively set the constant to a form-backend URL (e.g. Formspree) to collect emails immediately.
- **When the backend lands:** set `WAITLIST_ENDPOINT` to e.g. `https://api.horslign.earth/api/waitlist`. The form POSTs JSON `{name, email, destination, lang, source, ts}`; queued entries retry automatically on next visit.

The form has a honeypot field (`company`) — silently drop submissions that fill it.

## Demo video

The `#demo` section is a placeholder frame. In week 7 (per `docs/02-demo-script-30min.md` + `docs/09-metrics-timeline.md`) the 3-min walkthrough is recorded; replace the `.demo-frame` div in `index.html` with the video embed, keep the caption.

## Copy changes

Edit the strings in the `I18N` dictionary in `app.js` — do not edit `index.html` text directly (it gets overwritten by the dictionary on load). Source of truth for wording: `docs/03-landing-page-copy.md`.
