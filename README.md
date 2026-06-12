# Instant Pressure Washing Quote Tool

A customer-facing self-quoting page. A customer scans the QR code on your
postcard, lands here on their phone, and in about 60 seconds:

1. **Types their address** (so you know where the job is)
2. **Taps what needs cleaning** — driveway, patio, house wash, deck…
3. **Taps a size** ("2-car driveway") — or outlines the area on a
   satellite photo of their own house for an exact square footage
4. **Sees their price instantly** — with an automatic bundle discount
5. **Requests a booking** — name, phone, preferred day → lands in your inbox

No app install, no account, no backend, no monthly fees.

---

## Change your prices

Open **`config.js`**. Everything you'd ever want to change is in that one
file, with comments: business name, phone, email, per-square-foot rates,
size presets, minimum job, bundle discount. Edit, save, done.

## Get booking requests in your inbox (5 minutes, free)

1. Go to [web3forms.com](https://web3forms.com), enter your email, copy the access key
2. Paste it into `web3formsKey: ""` in `config.js`

Until then the app falls back to opening the customer's email app
pre-filled — it still works, it's just one extra tap for them.

## Put it online (free, via GitHub Pages)

1. Merge this branch into `main`
2. On GitHub: **Settings → Pages → Deploy from a branch → `main`** → Save
3. Your site goes live at `https://<your-username>.github.io/<repo-name>/`

## Make the postcard QR code

Point any QR generator (e.g. the one built into Chrome's share menu) at
your GitHub Pages URL above. Tip: add `?src=postcard` to the URL so you
can later tell postcard traffic apart in analytics if you add any.

---

## Tech notes

- Plain HTML/CSS/JS, mobile-first — no build step, no framework
- [Leaflet](https://leafletjs.com) + Esri World Imagery for the satellite measuring tool
- [Nominatim](https://nominatim.org) (OpenStreetMap) for one-shot address lookup
- Square footage computed with a geodesic spherical-excess formula (exact, no libraries)
- Booking delivery via [Web3Forms](https://web3forms.com) with `mailto:` fallback
