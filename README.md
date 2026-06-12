# Instant Pressure Washing Quote Tool

A customer-facing self-quoting page. A customer scans the QR code on your
postcard, lands here on their phone, and in about 60 seconds:

1. **Searches their address** on a full-screen map — it flies to their house
2. **Taps what needs cleaning** — driveway, patio, house wash, deck…
3. **Taps a size** ("2-car driveway") — or traces the area right on the
   satellite view of their own house for an exact square footage
4. **Sees their price instantly** — with an automatic bundle discount
5. **Requests a booking** — name, phone, preferred day → lands in your inbox

No app install, no account, no backend, no monthly fees.

---

## Change your prices

Open **`config.js`**. Everything you'd ever want to change is in that one
file, with comments: business name, phone, email, per-square-foot rates,
size presets, minimum job, bundle discount. Edit, save, done.

## Add your Google Maps key (required, ~5 minutes, free tier covers most use)

The map, address search, and on-map measuring all run on Google Maps. Until
you add a key, the app shows a friendly setup notice instead of the map.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create (or pick) a project, and enable **Maps JavaScript API**,
   **Places API**, and the **Geometry** library (it ships with Maps
   JavaScript — no separate enable needed).
2. Create an **API key** under *APIs & Services → Credentials*.
3. Paste it into `googleMapsApiKey: ""` in `config.js`.
4. **Restrict the key** so it can't be abused: set an
   *Application restriction → HTTP referrers* limited to your site
   (e.g. `https://<your-username>.github.io/*`), and an *API restriction*
   limited to Maps JavaScript API + Places API. Add billing to the project
   (Google requires it), but the free monthly credit covers typical traffic.

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
- [Google Maps JavaScript API](https://developers.google.com/maps/documentation/javascript)
  for the full-screen hybrid map, with the **Places** library for address
  autocomplete and the **Geometry** library for on-map area measurement
- Square footage computed with `geometry.spherical.computeArea`
  (geodesic, in m²) converted to sq ft
- Booking delivery via [Web3Forms](https://web3forms.com) with `mailto:` fallback
