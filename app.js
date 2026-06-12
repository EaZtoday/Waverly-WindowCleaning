/* Waverly instant-quote app.
   One persistent satellite map underneath; a draggable bottom sheet drives the
   flow: welcome → services → size (per service) → quote → book → done.
   All logic client-side; prices and business info live in config.js. */

(function () {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DESKTOP = () => window.matchMedia("(min-width: 1024px)").matches;

  const ICONS = {
    driveway: "i-car", patio: "i-umbrella", walkway: "i-path",
    house: "i-home", deck: "i-fence",
  };
  const svgIcon = (sym, cls) =>
    '<svg class="icon' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#' + (sym || "i-sparkles") + '"/></svg>';

  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
  }

  // ---------- state ----------
  const state = {
    address: "",
    latlng: null,             // [lat, lng] of the home
    selected: [],             // chosen service ids, in order
    sizes: {},                // serviceId -> { label, sqft|null, price }
    sizeIndex: 0,             // which selected service is being sized
    day: "Any day",
    timeOfDay: "Either",
  };

  // ---------- business info ----------
  $("biz-name").textContent = CONFIG.business.name;
  $("biz-area").textContent = "Serving " + CONFIG.business.serviceArea;
  $("quote-disclaimer").textContent = CONFIG.disclaimer;

  // ---------- map ----------
  const map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView([39.5, -98.35], 5); // continental US until we know the address
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Several free aerial photo sources of the same places — when clouds block
  // one (satellite passes aren't always clear), the customer hops to the next.
  // USGS aerials are flown on clear days, so they're the cloud-free rescue.
  const IMAGERY = [
    {
      name: "Newest satellite photo",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      opts: { maxNativeZoom: 19, maxZoom: 21, attribution: "Imagery © Esri" },
    },
    {
      name: "USGS aerial photo — usually cloud-free",
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
      opts: { maxNativeZoom: 16, maxZoom: 21, attribution: "Imagery courtesy of the USGS" },
    },
    {
      name: "Older satellite photo",
      url: "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      opts: { maxNativeZoom: 18, maxZoom: 21, attribution: "Imagery © Esri" },
    },
  ];
  let imageryIdx = 0;
  let baseLayer = null;
  let autoHops = 0;

  function setImagery(idx, announce) {
    imageryIdx = ((idx % IMAGERY.length) + IMAGERY.length) % IMAGERY.length;
    if (baseLayer) baseLayer.remove();
    const src = IMAGERY[imageryIdx];
    baseLayer = L.tileLayer(src.url, src.opts).addTo(map);

    // if this source has no photos here, hop to the next one (once around, max)
    let errs = 0;
    const started = Date.now();
    baseLayer.on("tileerror", () => {
      if (++errs >= 6 && Date.now() - started < 6000 && autoHops < IMAGERY.length - 1) {
        autoHops++;
        baseLayer.off("tileerror");
        toast("No photo from that source here — trying the next one.");
        setImagery(imageryIdx + 1, false);
      }
    });
    if (announce) toast(src.name);
  }
  setImagery(0, false);

  $("btn-layers").addEventListener("click", () => {
    autoHops = 0;
    setImagery(imageryIdx + 1, true);
  });

  let homeMarker = null;
  function dropHomePin(latlng) {
    if (homeMarker) homeMarker.remove();
    const icon = L.divIcon({
      className: "home-pin drop",
      iconSize: [44, 52], iconAnchor: [22, 50],
      html:
        '<svg width="44" height="52" viewBox="0 0 44 52">' +
        '<path d="M22 50C22 50 6 31 6 18a16 16 0 1 1 32 0c0 13-16 32-16 32Z" fill="#2563EB" stroke="#fff" stroke-width="3"/>' +
        '<path d="M22 10s7 7.6 7 12.4a7 7 0 0 1-14 0C15 17.6 22 10 22 10Z" fill="#fff"/></svg>',
    });
    homeMarker = L.marker(latlng, { icon, interactive: false }).addTo(map);
  }

  function flyHome(latlng, then) {
    if (REDUCED) {
      map.setView(latlng, 19);
      dropHomePin(latlng);
      if (then) then();
      return;
    }
    map.once("moveend", () => {
      dropHomePin(latlng);
      if (then) setTimeout(then, 350); // let the pin land first
    });
    map.flyTo(latlng, 19, { duration: 2.4 });
  }

  // ---------- floating search + autocomplete ----------
  const searchInput = $("search-input");
  const resultsEl = $("search-results");
  let searchTimer = null;
  let searchSeq = 0;

  function showSpinner(on) {
    $("search-spinner").classList.toggle("hidden", !on);
  }
  function clearResults() {
    resultsEl.innerHTML = "";
    resultsEl.classList.add("hidden");
  }

  function shortLabel(hit) {
    const a = hit.address || {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    return street || hit.display_name.split(",")[0];
  }
  function restLabel(hit) {
    const a = hit.address || {};
    return [a.city || a.town || a.village || a.hamlet, a.state, a.postcode]
      .filter(Boolean).join(", ") || hit.display_name.split(",").slice(1, 4).join(",").trim();
  }

  function renderResults(items, query) {
    resultsEl.innerHTML = "";
    if (!items.length) {
      resultsEl.innerHTML =
        '<li><p class="result-empty">No matches for “' + query +
        '” — try adding your city or ZIP.</p></li>';
    }
    items.forEach((hit) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "result-btn";
      btn.setAttribute("role", "option");
      btn.innerHTML =
        svgIcon("i-pin") +
        '<span><span class="result-main">' + shortLabel(hit) + "</span>" +
        '<span class="result-sub">' + restLabel(hit) + "</span></span>";
      btn.addEventListener("click", () => {
        chooseAddress([parseFloat(hit.lat), parseFloat(hit.lon)],
          shortLabel(hit) + ", " + restLabel(hit));
      });
      li.appendChild(btn);
      resultsEl.appendChild(li);
    });
    resultsEl.classList.remove("hidden");
  }

  function renderLocateRow() {
    resultsEl.innerHTML =
      '<li><button type="button" class="result-btn locate">' + svgIcon("i-locate") +
      '<span><span class="result-main">Use my current location</span>' +
      '<span class="result-sub">We’ll center the map on you</span></span></button></li>';
    resultsEl.querySelector(".locate").addEventListener("click", geolocateMe);
    resultsEl.classList.remove("hidden");
  }

  function renderSkeleton() {
    resultsEl.innerHTML =
      '<li><div class="result-skel"><div class="skeleton"></div><div class="skeleton"></div></div></li>' +
      '<li><div class="result-skel"><div class="skeleton"></div><div class="skeleton"></div></div></li>';
    resultsEl.classList.remove("hidden");
  }

  async function runSearch(query) {
    const seq = ++searchSeq;
    showSpinner(true);
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=" +
        encodeURIComponent(query);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (seq !== searchSeq) return; // a newer search superseded this one
      showSpinner(false);
      if (!res.ok) throw new Error("geocoder " + res.status);
      renderResults(await res.json(), query);
    } catch (_) {
      if (seq !== searchSeq) return;
      showSpinner(false);
      resultsEl.innerHTML =
        '<li><p class="result-empty">Hmm, the address lookup hiccuped. ' +
        "Check your signal and try again — or skip ahead and we’ll confirm by text.</p></li>";
      resultsEl.classList.remove("hidden");
    }
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    $("search-clear").classList.toggle("hidden", !q);
    clearTimeout(searchTimer);
    if (q.length < 3) { q.length ? clearResults() : renderLocateRow(); return; }
    renderSkeleton();
    searchTimer = setTimeout(() => runSearch(q), 400);
  });
  searchInput.addEventListener("focus", () => {
    if (!searchInput.value.trim()) renderLocateRow();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = resultsEl.querySelector(".result-btn:not(.locate)");
      if (first) first.click();
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("#search-shell, #btn-find-home")) return;
    clearResults();
  });
  $("search-clear").addEventListener("click", () => {
    searchInput.value = "";
    $("search-clear").classList.add("hidden");
    searchInput.focus();
    renderLocateRow();
  });

  function geolocateMe() {
    clearResults();
    if (!navigator.geolocation) { toast("Your phone wouldn’t share its location — try typing the address."); return; }
    showSpinner(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        showSpinner(false);
        chooseAddress([pos.coords.latitude, pos.coords.longitude], "My location");
      },
      () => {
        showSpinner(false);
        toast("No worries — just type your address instead.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function chooseAddress(latlng, label) {
    state.latlng = latlng;
    state.address = label;
    searchInput.value = label;
    searchInput.blur();
    $("search-clear").classList.add("hidden");
    clearResults();
    setSheet("peek"); // give the fly-to the whole screen
    flyHome(latlng, () => {
      if (current === "welcome") goStep("services");
      setSheet("half");
    });
  }

  // ---------- bottom sheet (drag + detents) ----------
  const sheet = $("sheet");
  const grip = $("sheet-grip");
  let sheetPos = "half";

  function detentOffsets() {
    const h = sheet.getBoundingClientRect().height;
    return {
      full: 0,
      half: Math.max(h - window.innerHeight * 0.46, 0),
      peek: Math.max(h - 132, 0),
    };
  }
  function applyOffset(px, animate) {
    sheet.classList.toggle("gliding", !!animate && !REDUCED);
    sheet.style.transform = "translate(-50%, " + px + "px)";
    // the sheet hangs below the viewport when not full — pad the scroll area
    // by the same amount so the last button can always scroll into view
    $("sheet-body").style.paddingBottom = px + 32 + "px";
  }
  function setSheet(pos, animate = true) {
    sheetPos = pos;
    if (DESKTOP()) { sheet.style.transform = ""; $("sheet-body").style.paddingBottom = ""; return; }
    applyOffset(detentOffsets()[pos], animate);
  }

  let drag = null;
  grip.addEventListener("pointerdown", (e) => {
    if (DESKTOP()) return;
    drag = { startY: e.clientY, startOffset: detentOffsets()[sheetPos], moved: false, lastY: e.clientY, lastT: e.timeStamp, vel: 0 };
    sheet.classList.remove("gliding");
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 4) drag.moved = true;
    const max = detentOffsets().peek;
    const next = Math.min(Math.max(drag.startOffset + dy, 0), max);
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.vel = (e.clientY - drag.lastY) / dt; // px per ms, + = downward
    drag.lastY = e.clientY; drag.lastT = e.timeStamp;
    applyOffset(next, false);
  });
  grip.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = detentOffsets();
    const current = Math.min(Math.max(drag.startOffset + (e.clientY - drag.startY), 0), d.peek);
    let target;
    if (Math.abs(drag.vel) > 0.5) {
      // flick: go one detent in the flick direction
      const order = ["full", "half", "peek"];
      const idx = order.indexOf(sheetPos);
      target = order[Math.min(Math.max(idx + (drag.vel > 0 ? 1 : -1), 0), 2)];
    } else {
      target = Object.keys(d).reduce((best, k) =>
        Math.abs(d[k] - current) < Math.abs(d[best] - current) ? k : best, "half");
    }
    drag = null;
    setSheet(target);
  });
  window.addEventListener("resize", () => setSheet(sheetPos, false));

  // ---------- step machine ----------
  const STEPS = {
    welcome:  { dot: -1, back: null },
    services: { dot: 0,  back: "welcome" },
    size:     { dot: 1,  back: null /* computed */ },
    quote:    { dot: 2,  back: "size" },
    book:     { dot: 3,  back: "quote" },
    done:     { dot: -1, back: null },
  };
  let current = "welcome";

  function setHeader(title, sub) {
    $("sheet-title").textContent = title;
    $("sheet-sub").textContent = sub || "";
  }

  function goStep(name) {
    current = name;
    document.querySelectorAll(".step").forEach((s) => s.classList.remove("active"));
    $("step-" + name).classList.add("active");
    $("sheet-body").scrollTop = 0;

    const meta = STEPS[name];
    $("sheet-back").classList.toggle("hidden", name === "welcome" || name === "done");
    const dots = $("dots");
    dots.classList.toggle("hidden", meta.dot < 0);
    dots.querySelectorAll(".dot").forEach((dot, i) => {
      dot.classList.toggle("on", i === meta.dot);
      dot.classList.toggle("done", i < meta.dot);
    });

    if (name === "welcome") {
      setHeader("Get an instant price", "Takes about a minute — no phone call");
    } else if (name === "services") {
      setHeader("What needs cleaning?", "Tap everything that applies — bundles save " + CONFIG.bundleDiscountPercent + "%");
      $("topbar").classList.remove("tucked");
    } else if (name === "size") {
      renderSizeStep();
    } else if (name === "quote") {
      renderQuote();
      setHeader("Your price", state.address || "Instant estimate — no obligation");
    } else if (name === "book") {
      setHeader("Almost done!", "No payment now — we text you to confirm");
    } else if (name === "done") {
      $("topbar").classList.add("tucked");
    }
  }

  $("sheet-back").addEventListener("click", () => {
    if (current === "size") {
      if (state.sizeIndex > 0) { state.sizeIndex--; renderSizeStep(); }
      else goStep("services");
    } else if (STEPS[current].back) {
      goStep(STEPS[current].back);
    }
  });

  // ---------- step: welcome ----------
  $("btn-find-home").addEventListener("click", () => {
    setSheet("peek");
    searchInput.focus();
    if (!searchInput.value.trim()) renderLocateRow();
  });
  $("btn-skip-address").addEventListener("click", () => goStep("services"));

  // ---------- step: services ----------
  const cardsEl = $("service-cards");
  CONFIG.services.forEach((svc) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "svc-card";
    card.setAttribute("aria-pressed", "false");
    card.innerHTML =
      '<span class="svc-icon">' + svgIcon(ICONS[svc.id]) + "</span>" +
      '<span><span class="svc-name">' + svc.name + '</span>' +
      '<span class="svc-blurb">' + svc.blurb + "</span></span>" +
      '<span class="svc-tick">' + svgIcon("i-check") + "</span>";
    card.addEventListener("click", () => {
      const i = state.selected.indexOf(svc.id);
      if (i === -1) state.selected.push(svc.id);
      else { state.selected.splice(i, 1); delete state.sizes[svc.id]; }
      card.classList.toggle("selected", i === -1);
      card.setAttribute("aria-pressed", String(i === -1));
      refreshServicesCta();
    });
    cardsEl.appendChild(card);
  });

  function refreshServicesCta() {
    const n = state.selected.length;
    const btn = $("btn-services-next");
    btn.disabled = n === 0;
    $("services-next-label").textContent =
      n === 0 ? "Pick at least one" :
      n === 1 ? "Next — size it up" :
      "Next — size up " + n + " services (save " + CONFIG.bundleDiscountPercent + "%)";
  }

  $("btn-services-next").addEventListener("click", () => {
    state.sizeIndex = 0;
    goStep("size");
  });

  // ---------- step: size ----------
  const currentService = () =>
    CONFIG.services.find((s) => s.id === state.selected[state.sizeIndex]);

  function priceFor(svc, sqft) {
    return Math.max(sqft * svc.rate, svc.min || 0);
  }
  const presetPrice = (svc, p) => (p.price != null ? p.price : priceFor(svc, p.sqft));

  function renderSizeStep() {
    const svc = currentService();
    const n = state.selected.length;
    setHeader(
      svc.name + " — how big?",
      (n > 1 ? "Service " + (state.sizeIndex + 1) + " of " + n + " · " : "") + "Best guess is fine"
    );

    const list = $("size-options");
    list.innerHTML = "";
    svc.presets.forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset";
      btn.innerHTML =
        '<span><span class="preset-label">' + preset.label + '</span>' +
        '<span class="preset-sub">' + preset.sub + "</span></span>" +
        '<span class="preset-price">' + fmt(presetPrice(svc, preset)) + "</span>";
      btn.addEventListener("click", () => {
        state.sizes[svc.id] = {
          label: preset.label,
          sqft: preset.sqft || null,
          price: presetPrice(svc, preset),
        };
        nextSizeOrQuote();
      });
      list.appendChild(btn);
    });

    $("btn-trace").classList.toggle("hidden", !svc.mappable);
    goStepQuiet("size");
  }

  // switch panels without re-running goStep side effects (used by renderSizeStep)
  function goStepQuiet(name) {
    current = name;
    document.querySelectorAll(".step").forEach((s) => s.classList.remove("active"));
    $("step-" + name).classList.add("active");
    $("sheet-body").scrollTop = 0;
    $("sheet-back").classList.remove("hidden");
    const dots = $("dots");
    dots.classList.remove("hidden");
    dots.querySelectorAll(".dot").forEach((dot, i) => {
      dot.classList.toggle("on", i === 1);
      dot.classList.toggle("done", i < 1);
    });
  }

  function nextSizeOrQuote() {
    if (state.sizeIndex + 1 < state.selected.length) {
      state.sizeIndex++;
      renderSizeStep();
    } else {
      goStep("quote");
      setSheet("half");
    }
  }

  // ---------- trace mode ----------
  // Shapes: [{ mode: 'add'|'cut', pts: L.LatLng[] }]. The last one is being drawn.
  let shapes = [];
  let traceLayers = [];      // committed polygons + corner markers, rebuilt each refresh
  let tracing = false;

  const SQM_TO_SQFT = 10.7639;
  const MAX_REASONABLE_SQFT = 25000; // bigger means they outlined the neighborhood

  // Geodesic polygon area (spherical excess), m².
  function areaSqM(pts) {
    if (pts.length < 3) return 0;
    const R = 6378137, rad = Math.PI / 180;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sum += (b.lng - a.lng) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
    }
    return Math.abs((sum * R * R) / 2);
  }

  function tracedSqft() {
    let total = 0;
    shapes.forEach((s) => {
      const a = areaSqM(s.pts) * SQM_TO_SQFT;
      total += s.mode === "cut" ? -a : a;
    });
    return Math.max(total, 0);
  }

  const ADD_STYLE = { color: "#2563EB", weight: 3, fillColor: "#3B82F6", fillOpacity: 0.28 };
  const CUT_STYLE = { color: "#DC2626", weight: 3, dashArray: "7 7", fillColor: "#FFFFFF", fillOpacity: 0.55 };

  function redrawTrace() {
    traceLayers.forEach((l) => l.remove());
    traceLayers = [];
    shapes.forEach((shape, si) => {
      const isLast = si === shapes.length - 1;
      const style = shape.mode === "cut" ? CUT_STYLE : ADD_STYLE;
      if (shape.pts.length >= 2) {
        traceLayers.push(L.polygon(shape.pts, style).addTo(map));
      }
      if (isLast) {
        shape.pts.forEach((p) => {
          traceLayers.push(L.circleMarker(p, {
            radius: 9, color: "#fff", weight: 3,
            fillColor: shape.mode === "cut" ? "#DC2626" : "#2563EB", fillOpacity: 1,
          }).addTo(map));
        });
      }
    });
    refreshTraceHud();
  }

  function refreshTraceHud() {
    const svc = currentService();
    const cur = shapes[shapes.length - 1];
    const sqft = tracedSqft();
    const surface = svc.name.toLowerCase();

    let tip;
    if (cur.pts.length === 0) {
      tip = (cur.mode === "cut" ? "Now tap the corners of the part to skip (like a pool)"
                                : "Tap each corner of your " + surface);
    } else if (cur.pts.length < 3) {
      tip = "Keep going — " + (3 - cur.pts.length) + " more corner" + (cur.pts.length === 2 ? "" : "s");
    } else {
      tip = "Looking good! Adjust, or tap “Use this size”";
    }
    $("trace-tip").textContent = tip;

    const hasArea = sqft > 0 && cur.pts.length >= 3 || (shapes.length > 1 && sqft > 0);
    $("trace-readout").classList.toggle("hidden", !hasArea);
    if (hasArea) {
      $("trace-sqft").textContent = Math.round(sqft).toLocaleString();
      $("trace-price").textContent = "≈ " + fmt(priceFor(svc, sqft));
    }
    $("trace-done").disabled = !hasArea;
    $("trace-undo").disabled = cur.pts.length === 0 && shapes.length === 1;
  }

  function onTraceTap(e) {
    shapes[shapes.length - 1].pts.push(e.latlng);
    redrawTrace();
  }

  function enterTrace() {
    tracing = true;
    shapes = [{ mode: "add", pts: [] }];
    sheet.classList.add("offstage");
    $("topbar").classList.add("tucked");
    $("trace-hud").classList.remove("hidden");
    map.on("click", onTraceTap);

    if (state.latlng) {
      map.setView(state.latlng, Math.max(map.getZoom(), 19));
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 19),
        () => toast("Pinch and drag the map to find your house, then tap its corners.")
      );
    }
    redrawTrace();
  }

  function exitTrace() {
    tracing = false;
    map.off("click", onTraceTap);
    traceLayers.forEach((l) => l.remove());
    traceLayers = [];
    shapes = [];
    $("trace-hud").classList.add("hidden");
    sheet.classList.remove("offstage");
    $("topbar").classList.remove("tucked");
  }

  function commitOrComplain(mode) {
    const cur = shapes[shapes.length - 1];
    if (cur.pts.length === 0) { cur.mode = mode; refreshTraceHud(); return; } // just re-arm the empty shape
    if (cur.pts.length < 3) { toast("Finish this shape first — tap at least 3 corners."); return; }
    shapes.push({ mode, pts: [] });
    redrawTrace();
  }

  $("btn-trace").addEventListener("click", enterTrace);
  $("trace-cancel").addEventListener("click", exitTrace);
  $("trace-add").addEventListener("click", () => commitOrComplain("add"));
  $("trace-cut").addEventListener("click", () => commitOrComplain("cut"));
  $("trace-undo").addEventListener("click", () => {
    const cur = shapes[shapes.length - 1];
    if (cur.pts.length > 0) cur.pts.pop();
    else if (shapes.length > 1) shapes.pop().pts.pop();
    redrawTrace();
  });
  $("trace-done").addEventListener("click", () => {
    const svc = currentService();
    const sqft = tracedSqft();
    if (sqft > MAX_REASONABLE_SQFT) {
      toast("That outline covers " + Math.round(sqft).toLocaleString() +
        " sq ft — zoom in until you can see your " + svc.name.toLowerCase() + " clearly.");
      return;
    }
    state.sizes[svc.id] = { label: "Traced on the photo", sqft, price: priceFor(svc, sqft) };
    exitTrace();
    nextSizeOrQuote();
  });

  // ---------- quote ----------
  function buildLines() {
    const lines = state.selected.map((id) => {
      const svc = CONFIG.services.find((s) => s.id === id);
      const size = state.sizes[id];
      return {
        icon: ICONS[id],
        name: svc.name,
        sub: size.sqft
          ? size.label + " · about " + Math.round(size.sqft).toLocaleString() + " sq ft"
          : size.label,
        amount: size.price,
      };
    });

    let total = lines.reduce((sum, l) => sum + l.amount, 0);
    let saved = 0;

    if (CONFIG.bundleDiscountPercent > 0 && lines.length >= 2) {
      saved = total * (CONFIG.bundleDiscountPercent / 100);
      lines.push({
        icon: "i-tag", name: "Bundle discount",
        sub: lines.length + " services together — nice",
        amount: -saved, discount: true,
      });
      total -= saved;
    }

    if (total < CONFIG.minimumJob) {
      lines.push({
        icon: "i-droplet", name: "Minimum visit",
        sub: "covers the trip & setup",
        amount: CONFIG.minimumJob - total,
      });
      total = CONFIG.minimumJob;
    }

    return { lines, total, saved };
  }

  function renderLineItems(listEl, lines) {
    listEl.innerHTML = "";
    lines.forEach((l) => {
      const li = document.createElement("li");
      if (l.discount) li.className = "discount";
      li.innerHTML =
        '<span class="line-icon">' + svgIcon(l.icon) + "</span>" +
        '<span class="line-body"><span class="line-name">' + l.name + '</span>' +
        '<span class="line-sub">' + l.sub + "</span></span>" +
        '<span class="line-amount">' + (l.amount < 0 ? "−" + fmt(-l.amount) : fmt(l.amount)) + "</span>";
      listEl.appendChild(li);
    });
  }

  function countUp(el, to) {
    if (REDUCED) { el.textContent = fmt(to); return; }
    const dur = 650, t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function renderQuote() {
    const { lines, total, saved } = buildLines();
    renderLineItems($("quote-lines"), lines);
    countUp($("quote-total"), total);
    const sv = $("quote-savings");
    sv.classList.toggle("hidden", saved <= 0);
    if (saved > 0) sv.textContent = "You’re saving " + fmt(saved) + " by bundling";
  }

  $("btn-edit-quote").addEventListener("click", () => goStep("services"));
  $("btn-to-booking").addEventListener("click", () => {
    goStep("book");
    setSheet("full");
  });

  // ---------- step: book ----------
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayChipsEl = $("day-chips");
  (function buildDayChips() {
    const opts = [{ label: "Any day", value: "Any day" }];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(Date.now() + i * 864e5);
      opts.push({
        label: i === 1 ? "Tomorrow" : DAY_NAMES[d.getDay()] + " " + d.getDate(),
        value: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      });
    }
    opts.forEach((opt, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (i === 0 ? " selected" : "");
      chip.textContent = opt.label;
      chip.addEventListener("click", () => {
        dayChipsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        state.day = opt.value;
      });
      dayChipsEl.appendChild(chip);
    });
  })();

  document.querySelectorAll("#tod-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#tod-chips .chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      state.timeOfDay = chip.dataset.tod;
    });
  });

  // friendly US phone formatting as they type
  $("book-phone").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 10);
    e.target.value =
      d.length > 6 ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) :
      d.length > 3 ? "(" + d.slice(0, 3) + ") " + d.slice(3) : d;
  });

  function bookingSummaryText() {
    const { lines, total } = buildLines();
    return [
      "NEW BOOKING REQUEST — " + CONFIG.business.name,
      "",
      "Name: " + $("book-name").value.trim(),
      "Phone: " + $("book-phone").value.trim(),
      "Address: " + (state.address || "(not given)"),
      "Preferred: " + state.day + " — " + state.timeOfDay,
      "",
      "Services:",
      ...lines.map((l) => "  • " + l.name + " (" + l.sub + "): " +
        (l.amount < 0 ? "-" : "") + fmt(Math.abs(l.amount))),
      "",
      "TOTAL ESTIMATE: " + fmt(total),
    ].join("\n");
  }

  function showBookError(msg) {
    const el = $("book-error");
    el.innerHTML = svgIcon("i-alert") + "<span>" + msg + "</span>";
    el.classList.remove("hidden");
  }

  async function sendBooking() {
    const name = $("book-name").value.trim();
    const phone = $("book-phone").value.replace(/\D/g, "");
    $("book-error").classList.add("hidden");
    $("book-name").classList.toggle("invalid", !name);
    $("book-phone").classList.toggle("invalid", phone.length < 10);
    if (!name || phone.length < 10) {
      showBookError(!name ? "Add your name so we know who to ask for."
                          : "That phone number looks short — we need it to text you.");
      (!name ? $("book-name") : $("book-phone")).focus();
      return;
    }

    const btn = $("btn-send");
    btn.disabled = true;
    $("send-label").textContent = "Sending…";
    $("send-spinner").classList.remove("hidden");

    let delivered = false;
    if (CONFIG.web3formsKey) {
      try {
        const res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            access_key: CONFIG.web3formsKey,
            subject: "New booking request: " + name,
            from_name: CONFIG.business.name + " Instant Quote",
            message: bookingSummaryText(),
          }),
        });
        delivered = res.ok;
      } catch (_) { /* fall through to mailto */ }
    }

    if (!delivered) {
      // No form key (or it failed): open their email app pre-filled instead.
      window.location.href =
        "mailto:" + CONFIG.business.email +
        "?subject=" + encodeURIComponent("Booking request — " + name) +
        "&body=" + encodeURIComponent(bookingSummaryText());
    }

    btn.disabled = false;
    $("send-label").textContent = "Request my booking";
    $("send-spinner").classList.add("hidden");

    const { lines, total } = buildLines();
    renderLineItems($("done-lines"), lines);
    $("done-total").textContent = fmt(total);
    $("done-message").textContent = delivered
      ? "We’ll text " + $("book-phone").value + " shortly to lock in " +
        state.day.toLowerCase() + " (" + state.timeOfDay.toLowerCase() + ")."
      : "One more tap: hit Send in the email that just opened, and we’ll text you to confirm.";
    $("done-contact").textContent =
      "Questions? Call " + CONFIG.business.phone + " · " + CONFIG.business.serviceArea;
    setHeader("See you soon!", CONFIG.business.name);
    goStep("done");
    setSheet("full");
  }

  $("btn-send").addEventListener("click", sendBooking);

  // ---------- boot ----------
  refreshServicesCta();
  goStep("welcome");
  setSheet("half", false);
})();
