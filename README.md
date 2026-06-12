# Waverly Pressure Washing — Instant Quote

A customer-facing self-quoting page that feels like Google Maps. A customer
scans the QR code on your postcard, lands here on their phone, and in about
60 seconds:

1. **Types their address** in the floating search bar — autocomplete
   suggests it and the satellite map flies to their house
2. **Taps what needs cleaning** in the bottom sheet — driveway, patio,
   house wash, deck…
3. **Taps a size** ("2-car driveway") — or **traces the actual surface**
   on the satellite photo, corner by corner, with live square footage.
   They can add extra sections and cut out holes (like a pool) too.
4. **Watches their price count up** — line items plus an automatic
   bundle discount
5. **Requests a booking** — name, phone, preferred day → lands in your inbox

No app install, no account, no backend, no monthly fees.

---

## Change your prices

Open **`config.js`**. Everything you'd ever want to change is in that one
file, with comments: business name, phone, email, per-square-foot rates,
size presets, minimum job, bundle discount. Edit, save, done.

## Change the look

Open **`DESIGN.md`** for the full design system. Every color, font size,
radius, and shadow is a token at the top of `styles.css` — change it once,
it changes everywhere.

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
- [Leaflet](https://leafletjs.com) + Esri World Imagery for the always-on satellite map
- [Nominatim](https://nominatim.org) (OpenStreetMap) for address autocomplete
- Square footage computed with a geodesic spherical-excess formula (exact, no libraries);
  cut-out shapes subtract from the total
- Draggable bottom sheet with three snap points (peek / half / full); docks
  as a left panel on desktop
- Booking delivery via [Web3Forms](https://web3forms.com) with `mailto:` fallback
- Inline SVG icon sprite (Lucide-style strokes) — no icon font, no emoji
