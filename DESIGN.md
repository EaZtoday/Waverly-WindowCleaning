# Waverly Pressure Washing — Design System

A small, opinionated system for the instant-quote app. Clean, airy,
Google-Material-adjacent: rounded corners, soft shadows, generous spacing,
a confident blue with a fresh "clean water" aqua accent. Every token below
lives in `:root` in `styles.css` — change it there and the whole app follows.

## Principles

1. **The map is the hero.** Everything else floats above it: a pill search
   bar on top, a draggable sheet below. Nothing ever fully covers the
   satellite view except the final confirmation.
2. **One decision per moment.** Each sheet step asks exactly one question
   with tap-sized answers. No forms until the price is already on screen.
3. **Drunk-granny simple, design-snob slick.** ≥44px targets, 16px+ body
   text, plain words ("Cut a hole", not "subtract polygon") — wrapped in
   premium type, motion, and color.

## Color tokens

| Token | Hex | Use |
|---|---|---|
| `--blue-600` | `#2563EB` | Primary actions, prices, traced areas |
| `--blue-700` | `#1D4ED8` | Primary pressed/hover |
| `--blue-500` | `#3B82F6` | Focus rings, polygon fill |
| `--blue-100` / `--blue-50` | `#DBEAFE` / `#EFF6FF` | Selected tints, icon chips |
| `--aqua-400` | `#22D3EE` | "Clean water" accent — progress, highlights |
| `--aqua-600` | `#0891B2` | Accent when used as text (AA-safe) |
| `--aqua-100` | `#CFFAFE` | Accent tint (savings badge) |
| `--ink-900` → `--ink-100` | `#0F172A` → `#F1F5F9` | Text & surface neutrals (slate) |
| `--green-600` | `#16A34A` | Success, discounts |
| `--red-600` / `--red-50` | `#DC2626` / `#FEF2F2` | Errors, "cut out" outlines |

Rules: color is never the only signal (icons + text accompany it); body text
on white is `--ink-700` or darker (≥4.5:1); raw hex never appears in
components — tokens only.

## Type scale

Headings **Lexend**, body **Source Sans 3**, system-ui fallback.

| Token | Size | Use |
|---|---|---|
| `--text-2xl` | 28px | The price, traced sq ft |
| `--text-xl` | 22px | Sheet titles |
| `--text-lg` | 17px | Buttons, list rows |
| `--text-md` | 16px | Body, inputs (≥16px avoids iOS zoom) |
| `--text-sm` | 13px | Captions, chips, helper text |
| `--text-xs` | 12px | Fine print only |

Numbers that change (prices, square footage) use `tabular-nums` so they
count up without wobbling.

## Shape, elevation, spacing, motion

- **Radius:** `--r-sm` 10 · `--r-md` 16 (buttons, cards, inputs) ·
  `--r-lg` 24 (sheet) · `--r-full` pills.
- **Elevation:** `--shadow-1` resting cards → `--shadow-2` floating
  controls → `--shadow-3` search dropdown/toast → `--shadow-up` the sheet.
  No other shadow values, ever.
- **Spacing:** 4pt grid, `--s-1`(4) … `--s-10`(40).
- **Motion:** `--dur-1` 150ms (presses) · `--dur-2` 250ms (reveals) ·
  `--dur-3` 400ms (sheet snaps), all on `--ease-out`
  `cubic-bezier(.16,1,.3,1)`. Map fly-to ~2.4s. Only `transform`/`opacity`
  animate. `prefers-reduced-motion` collapses everything to instant,
  including the fly-to and the price count-up.
- **Z-layers:** map 0 → trace HUD 20 → sheet 30 → search 40 → toast 100.

## Components

- **Buttons** — `.btn-primary` (filled blue, 56px, scales to .98 on press),
  `.btn-secondary` (white, outlined), `.btn-ghost` (text), `.icon-btn`
  (44px round). Disabled = `--ink-300` fill, no shadow.
- **Service card** (`.svc-card`) — 2-up grid, icon chip + name + blurb,
  selected = blue tint, blue border, spring-in checkmark badge.
- **Preset row** (`.preset`) — label + plain-language size left, price
  right. Tap = chosen, advance.
- **Chip** (`.chip`) — pill, 44px min, single-select rows for days and
  morning/afternoon.
- **Bottom sheet** (`#sheet`) — three detents: *peek* (132px), *half*
  (~46vh), *full* (92dvh). Drag the grip; flicks jump one detent. On
  desktop (≥1024px) it docks as a left panel, Google-Maps style.
- **Search bar** (`#search-bar`) — floating pill, leading search icon,
  spinner while geocoding, clear button, dropdown of suggestions.
- **Quote card** (`.quote-card`) — icon line items, dividers, discount row
  in green, count-up total in `--text-2xl` blue.
- **Trace HUD** — dark instruction pill (top), live sq-ft + ≈price readout,
  bottom dock with Undo / Add a section / Cut a hole / Use this size.
  Added areas: blue fill. Cut-outs: red dashed outline, white wash.

## States

- **Empty:** search dropdown offers "Use my current location" before any
  typing; services CTA reads "Pick at least one" while disabled.
- **Loading:** skeleton shimmer rows while addresses load; spinner in the
  search pill; "Sending…" with spinner inside the booking button (disabled
  during flight).
- **Error:** inline red banner under the form with the cause *and* the fix
  ("That phone number looks short — we need it to text you"); dark toast
  for transient hiccups (geolocation denied, outline too big, geocoder
  down) — every one names a recovery path. Booking falls back from
  Web3Forms to a pre-filled email automatically.
- **Success:** drawn-on checkmark, "You're on the books!", summary card,
  and the day/time echoed back.

## Voice

Warm, plain, confident. "Find my home", "Cut a hole", "You're saving $42
by bundling", "We double-check on arrival." Never: modal, polygon, submit,
invalid input.
