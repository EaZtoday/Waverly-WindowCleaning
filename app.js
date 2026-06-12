/* Customer self-quote wizard. All logic client-side; config lives in config.js. */

(function () {
  "use strict";

  // ---------- state ----------
  const state = {
    address: "",
    latlng: null,            // [lat, lng] from geocoder, used to center the map
    selected: [],            // service ids in the order chosen
    sizes: {},               // serviceId -> { label, sqft?, price? }
    sizeIndex: 0,            // which selected service we're sizing right now
    timeOfDay: "Either",
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => "$" + Math.round(n).toLocaleString("en-US");

  // ---------- business info ----------
  $("biz-name").textContent = CONFIG.business.name;
  $("biz-tagline").textContent = CONFIG.business.tagline;
  const phoneLink = $("biz-phone-link");
  phoneLink.href = "tel:" + CONFIG.business.phone.replace(/[^+\d]/g, "");
  phoneLink.textContent = "Rather talk to a human? Call " + CONFIG.business.phone;
  $("quote-disclaimer").textContent = CONFIG.disclaimer;

  // ---------- screen routing ----------
  const STEP_ORDER = ["address", "services", "sizes", "quote", "book"];
  function show(screen, progressStep) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $("screen-" + screen).classList.add("active");
    const progress = $("progress");
    if (!progressStep) {
      progress.classList.add("hidden");
    } else {
      progress.classList.remove("hidden");
      const idx = STEP_ORDER.indexOf(progressStep);
      progress.querySelectorAll(".dot").forEach((dot, i) => {
        dot.classList.toggle("current", i === idx);
        dot.classList.toggle("done", i < idx);
      });
    }
    window.scrollTo(0, 0);
  }

  // ---------- welcome ----------
  $("btn-start").addEventListener("click", () => {
    show("address", "address");
    $("address-input").focus();
  });

  // ---------- address autocomplete (Photon — free, built for typeahead) ----------
  const addrInput = $("address-input");
  const suggBox = $("address-suggestions");
  let acTimer = null;
  let acController = null;
  let suggestions = []; // current Photon features shown in the dropdown

  // Turn a Photon feature into { lat, lng, line1, line2, full }.
  function parsePhoton(feature) {
    const p = feature.properties || {};
    const c = (feature.geometry && feature.geometry.coordinates) || [];
    const line1 =
      [p.housenumber, p.street].filter(Boolean).join(" ") || p.name || "";
    const town = p.city || p.town || p.village || p.hamlet || p.county || "";
    const line2 = [town, p.state, p.postcode].filter(Boolean).join(", ");
    return {
      lat: c[1],
      lng: c[0],
      line1: line1 || line2,
      line2: line1 ? line2 : "",
      full: [line1, line2].filter(Boolean).join(", "),
    };
  }

  function hideSuggestions() {
    suggBox.classList.add("hidden");
    suggBox.innerHTML = "";
    suggestions = [];
  }

  function renderSuggestions(items) {
    suggestions = items;
    suggBox.innerHTML = "";
    if (!items.length) {
      hideSuggestions();
      return;
    }
    items.forEach((s, i) => {
      const li = document.createElement("li");
      li.className = "suggestion";
      li.innerHTML =
        '<span class="pin">\u{1F4CD}</span><span class="lines">' +
        '<div class="line1">' + s.line1 + "</div>" +
        (s.line2 ? '<div class="line2">' + s.line2 + "</div>" : "") +
        "</span>";
      li.addEventListener("click", () => chooseSuggestion(i));
      suggBox.appendChild(li);
    });
    suggBox.classList.remove("hidden");
  }

  function chooseSuggestion(i) {
    const s = suggestions[i];
    if (!s || s.lat == null) return;
    addrInput.value = s.full;
    state.address = s.full;
    state.latlng = [s.lat, s.lng];
    hideSuggestions();
    showConfirm(); // straight to their house from above
  }

  async function fetchSuggestions(query) {
    if (acController) acController.abort();
    acController = new AbortController();
    try {
      const res = await fetch(
        "https://photon.komoot.io/api/?limit=5&lang=en&q=" + encodeURIComponent(query),
        { signal: acController.signal }
      );
      if (!res.ok) return;
      const data = await res.json();
      // Ignore stale responses if the box was cleared meanwhile.
      if (addrInput.value.trim().length < 4) return;
      renderSuggestions((data.features || []).map(parsePhoton).filter((s) => s.lat != null));
    } catch (_) {
      /* aborted or offline — leave the dropdown as-is */
    }
  }

  addrInput.addEventListener("input", () => {
    const q = addrInput.value.trim();
    state.latlng = null; // typing invalidates any earlier pick
    $("address-error").classList.add("hidden");
    clearTimeout(acTimer);
    if (q.length < 4) {
      hideSuggestions();
      return;
    }
    acTimer = setTimeout(() => fetchSuggestions(q), 300);
  });

  // Tapping outside the dropdown closes it.
  document.addEventListener("click", (e) => {
    if (e.target !== addrInput && !suggBox.contains(e.target)) hideSuggestions();
  });

  async function submitAddress() {
    const query = addrInput.value.trim();
    $("address-error").classList.add("hidden");
    if (!query) {
      addrInput.focus();
      return;
    }
    state.address = query;

    // Already picked a suggestion? Go straight to the satellite confirm.
    if (state.latlng) {
      hideSuggestions();
      showConfirm();
      return;
    }

    // They typed but didn't tap a suggestion — take the best match.
    const btn = $("btn-address-next");
    btn.disabled = true;
    btn.textContent = "Finding your house…";
    let matched = false;
    try {
      if (acController) acController.abort();
      const res = await fetch(
        "https://photon.komoot.io/api/?limit=1&lang=en&q=" + encodeURIComponent(query)
      );
      if (res.ok) {
        const data = await res.json();
        const first = (data.features || []).map(parsePhoton).find((s) => s.lat != null);
        if (first) {
          state.latlng = [first.lat, first.lng];
          state.address = first.full || query;
          matched = true;
        }
      }
    } catch (_) {
      matched = true; // offline or blocked: not the customer's problem, carry on
    }
    btn.disabled = false;
    btn.textContent = "Next  →";
    hideSuggestions();
    if (matched && state.latlng) showConfirm();
    else if (matched) show("services", "services");
    else $("address-error").classList.remove("hidden");
  }

  // ---------- confirm home (satellite preview) ----------
  function esriTiles() {
    return L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxNativeZoom: 19, maxZoom: 21, attribution: "Imagery \u00a9 Esri" }
    );
  }

  let confirmMap = null;
  let confirmPin = null;
  function showConfirm() {
    show("confirm", "address");
    if (!confirmMap) {
      // look-only: no panning/zooming, just "yep, that's my roof"
      confirmMap = L.map("confirm-map", {
        dragging: false, zoomControl: false, scrollWheelZoom: false,
        touchZoom: false, doubleClickZoom: false, boxZoom: false,
        keyboard: false, attributionControl: true,
      });
      esriTiles().addTo(confirmMap);
    }
    if (confirmPin) confirmPin.remove();
    confirmMap.setView(state.latlng, 19);
    confirmPin = L.circleMarker(state.latlng, {
      radius: 12, color: "#fff", weight: 3, fillColor: "#0b66ff", fillOpacity: 1,
    }).addTo(confirmMap);
    setTimeout(() => confirmMap.invalidateSize(), 60);
  }

  $("btn-confirm-yes").addEventListener("click", () => show("services", "services"));
  $("btn-confirm-edit").addEventListener("click", () => {
    show("address", "address");
    $("address-input").focus();
  });

  $("btn-address-next").addEventListener("click", submitAddress);
  $("address-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAddress();
  });
  $("btn-address-skip").addEventListener("click", () => {
    state.address = $("address-input").value.trim();
    show("services", "services");
  });

  // ---------- services ----------
  const cardsEl = $("service-cards");
  CONFIG.services.forEach((svc) => {
    const card = document.createElement("button");
    card.className = "svc-card";
    card.type = "button";
    card.innerHTML =
      '<div class="svc-emoji">' + svc.emoji + "</div>" +
      '<div class="svc-name">' + svc.name + "</div>" +
      '<div class="svc-blurb">' + svc.blurb + "</div>";
    card.addEventListener("click", () => {
      const i = state.selected.indexOf(svc.id);
      if (i === -1) state.selected.push(svc.id);
      else state.selected.splice(i, 1);
      card.classList.toggle("selected", i === -1);
      $("btn-services-next").disabled = state.selected.length === 0;
    });
    cardsEl.appendChild(card);
  });

  $("btn-services-next").addEventListener("click", () => {
    state.sizeIndex = 0;
    showSizeScreen();
  });

  // ---------- sizes (loops through each selected service) ----------
  function currentService() {
    return CONFIG.services.find((s) => s.id === state.selected[state.sizeIndex]);
  }

  function priceForPreset(svc, preset) {
    if (preset.price != null) return preset.price;
    return Math.max(preset.sqft * svc.rate, svc.min || 0);
  }

  function showSizeScreen() {
    const svc = currentService();
    $("size-title").textContent = svc.emoji + " " + svc.name + " — how big?";
    const n = state.selected.length;
    $("size-hint").textContent =
      (n > 1 ? "(" + (state.sizeIndex + 1) + " of " + n + ") " : "") +
      "Closest guess is fine — we double-check on arrival.";

    const list = $("size-options");
    list.innerHTML = "";

    // satellite measuring up top — the headline option, not a footnote
    if (svc.mappable) {
      const mapBtn = document.createElement("button");
      mapBtn.className = "map-option";
      mapBtn.type = "button";
      mapBtn.innerHTML =
        '<span class="map-option-badge">EXACT PRICE</span>' +
        '<div class="map-option-title">🛰 Outline it on the map</div>' +
        '<div class="map-option-sub">See your home from above — trace your ' +
        svc.name.toLowerCase() + " for a to-the-foot price</div>";
      mapBtn.addEventListener("click", openMeasure);
      list.appendChild(mapBtn);

      const divider = document.createElement("p");
      divider.className = "option-divider";
      divider.textContent = "— or just take your best guess —";
      list.appendChild(divider);
    }

    svc.presets.forEach((preset) => {
      const btn = document.createElement("button");
      btn.className = "size-option";
      btn.type = "button";
      btn.innerHTML =
        "<span><span class='size-label'>" + preset.label + "</span><br>" +
        "<span class='size-sub'>" + preset.sub + "</span></span>" +
        "<span class='size-price'>" + fmt(priceForPreset(svc, preset)) + "</span>";
      btn.addEventListener("click", () => {
        state.sizes[svc.id] = {
          label: preset.label,
          sqft: preset.sqft || null,
          price: priceForPreset(svc, preset),
        };
        nextSizeOrQuote();
      });
      list.appendChild(btn);
    });

    show("sizes", "sizes");
  }

  function nextSizeOrQuote() {
    state.sizeIndex++;
    if (state.sizeIndex < state.selected.length) showSizeScreen();
    else showQuote();
  }

  // ---------- quote ----------
  function buildLines() {
    const lines = state.selected.map((id) => {
      const svc = CONFIG.services.find((s) => s.id === id);
      const size = state.sizes[id];
      return {
        name: svc.emoji + " " + svc.name,
        sub: size.sqft
          ? size.label + " · about " + Math.round(size.sqft).toLocaleString() + " sq ft"
          : size.label,
        amount: size.price,
      };
    });

    let total = lines.reduce((sum, l) => sum + l.amount, 0);

    if (CONFIG.bundleDiscountPercent > 0 && lines.length >= 2) {
      const off = total * (CONFIG.bundleDiscountPercent / 100);
      lines.push({
        name: "🎁 Bundle discount",
        sub: lines.length + " services together",
        amount: -off,
        discount: true,
      });
      total -= off;
    }

    if (total < CONFIG.minimumJob) {
      lines.push({
        name: "Minimum visit",
        sub: "small-job adjustment",
        amount: CONFIG.minimumJob - total,
      });
      total = CONFIG.minimumJob;
    }

    return { lines, total };
  }

  function renderLines(listEl, totalEl) {
    const { lines, total } = buildLines();
    listEl.innerHTML = "";
    lines.forEach((l) => {
      const li = document.createElement("li");
      if (l.discount) li.className = "discount";
      li.innerHTML =
        "<span>" + l.name + "<span class='line-sub'>" + l.sub + "</span></span>" +
        "<span class='line-amount'>" + (l.amount < 0 ? "−" + fmt(-l.amount) : fmt(l.amount)) + "</span>";
      listEl.appendChild(li);
    });
    totalEl.textContent = fmt(total);
    return total;
  }

  function showQuote() {
    renderLines($("quote-lines"), $("quote-total-amount"));
    show("quote", "quote");
  }

  $("btn-edit-quote").addEventListener("click", () => show("services", "services"));
  $("btn-book").addEventListener("click", () => {
    show("book", "book");
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000); // suggest ~3 days out
    $("book-date").value = d.toISOString().slice(0, 10);
  });

  // ---------- booking ----------
  document.querySelectorAll("#book-timeofday .pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#book-timeofday .pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      state.timeOfDay = pill.dataset.tod;
    });
  });

  function bookingSummaryText() {
    const { lines, total } = buildLines();
    return [
      "NEW BOOKING REQUEST — " + CONFIG.business.name,
      "",
      "Name: " + $("book-name").value.trim(),
      "Phone: " + $("book-phone").value.trim(),
      "Address: " + (state.address || "(not given)"),
      "Preferred day: " + ($("book-date").value || "(any)") + " — " + state.timeOfDay,
      "",
      "Services:",
      ...lines.map(
        (l) => "  • " + l.name.replace(/[^\x20-\x7E]/g, "").trim() + " (" + l.sub + "): " +
               (l.amount < 0 ? "-" : "") + fmt(Math.abs(l.amount))
      ),
      "",
      "TOTAL ESTIMATE: " + fmt(total),
    ].join("\n");
  }

  async function sendBooking() {
    const name = $("book-name").value.trim();
    const phone = $("book-phone").value.trim();
    if (!name || !phone) {
      $("book-error").classList.remove("hidden");
      return;
    }
    $("book-error").classList.add("hidden");

    const btn = $("btn-send-booking");
    btn.disabled = true;
    btn.textContent = "Sending…";

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
      // No form key (or it failed): open the customer's email app pre-filled.
      window.location.href =
        "mailto:" + CONFIG.business.email +
        "?subject=" + encodeURIComponent("Booking request — " + name) +
        "&body=" + encodeURIComponent(bookingSummaryText());
    }

    btn.disabled = false;
    btn.textContent = "Request My Booking  ✓";

    const total = renderLines($("done-lines"), $("done-total-amount"));
    void total;
    $("done-message").textContent = delivered
      ? "We'll text you shortly to confirm your day and time."
      : "One more tap: hit Send in the email that just opened, and we'll text you to confirm.";
    $("done-contact").textContent =
      "Questions? Call " + CONFIG.business.phone + " · " + CONFIG.business.serviceArea;
    show("done", null);
  }

  $("btn-send-booking").addEventListener("click", sendBooking);

  // ---------- map measuring ----------
  let map = null;
  let corners = [];        // L.LatLng[]
  let markers = [];
  let polygon = null;

  // Geodesic polygon area (Chamberlain & Duquette spherical excess), m².
  function polygonAreaSqM(pts) {
    if (pts.length < 3) return 0;
    const R = 6378137;
    const rad = Math.PI / 180;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      sum += (b.lng - a.lng) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
    }
    return Math.abs((sum * R * R) / 2);
  }

  const SQM_TO_SQFT = 10.7639;

  // Shapes support add/cut: trace the patio, then cut the pool out of it.
  // Walkways & driveways in separate pieces? "Add section" sums them.
  let shapes = [];       // committed: { pts, sign(+1 add / -1 cut), layer }
  let currentSign = 1;   // sign of the shape being drawn right now

  const SHAPE_STYLE = {
    "1":  { color: "#0b66ff", weight: 3, fillOpacity: 0.25 },
    "-1": { color: "#e54d42", weight: 3, fillOpacity: 0.4, dashArray: "6 6" },
  };

  function netSqM() {
    let m2 = shapes.reduce((sum, s) => sum + s.sign * polygonAreaSqM(s.pts), 0);
    if (corners.length >= 3) m2 += currentSign * polygonAreaSqM(corners);
    return Math.max(m2, 0);
  }

  function refreshMeasureUI() {
    const drawingFirst = shapes.length === 0;
    const sqft = netSqM() * SQM_TO_SQFT;

    if (drawingFirst && corners.length < 3) {
      $("measure-readout").textContent =
        corners.length + " corner" + (corners.length === 1 ? "" : "s") + " \u2014 tap at least 3";
    } else if (corners.length > 0 && corners.length < 3) {
      $("measure-readout").textContent =
        Math.round(sqft).toLocaleString() + " sq ft \u2014 finish this shape (3+ corners)";
    } else {
      $("measure-readout").textContent = Math.round(sqft).toLocaleString() + " sq ft";
    }

    // Done: every started shape must be finished, and something must remain.
    const incomplete = corners.length > 0 && corners.length < 3;
    $("btn-measure-done").disabled =
      incomplete || (corners.length < 3 && !shapes.some((s) => s.sign > 0));

    // Add/Cut appear once there is a finished shape to build on.
    $("measure-shape-actions").classList.toggle(
      "hidden",
      corners.length < 3 && shapes.length === 0
    );
    $("btn-measure-add").disabled = incomplete;
    $("btn-measure-cut").disabled = incomplete;

    if (polygon) polygon.remove();
    polygon = null;
    if (corners.length >= 2) {
      polygon = L.polygon(corners, SHAPE_STYLE[String(currentSign)]).addTo(map);
    }
  }

  function clearCurrent() {
    corners = [];
    markers.forEach((m) => m.remove());
    markers = [];
    if (polygon) { polygon.remove(); polygon = null; }
  }

  function commitCurrentShape() {
    if (corners.length < 3) return;
    const layer = L.polygon(corners, SHAPE_STYLE[String(currentSign)]).addTo(map);
    shapes.push({ pts: corners.slice(), sign: currentSign, layer });
    clearCurrent();
  }

  function startShape(sign, hint) {
    commitCurrentShape();
    currentSign = sign;
    $("measure-instructions").innerHTML = hint;
    refreshMeasureUI();
  }

  $("btn-measure-add").addEventListener("click", () =>
    startShape(1, "Tap the corners of the <b>next section</b>.")
  );
  $("btn-measure-cut").addEventListener("click", () =>
    startShape(-1, "Now tap the corners of the part to <b>remove</b> \u2014 it won\u2019t be counted.")
  );

  function openMeasure() {
    $("measure-overlay").classList.remove("hidden");
    clearCurrent();
    shapes.forEach((s) => s.layer.remove());
    shapes = [];
    currentSign = 1;

    const svc = currentService();
    $("measure-instructions").innerHTML =
      "Tap each <b>corner</b> of your " + svc.name.toLowerCase() + ". Pinch to zoom.";
    $("btn-measure-cut").textContent =
      svc.id === "patio" ? "\u2796 Cut out the pool" : "\u2796 Cut a part out";

    if (!map) {
      map = L.map("measure-map", { zoomControl: true, attributionControl: true });
      esriTiles().addTo(map);
      map.on("click", (e) => {
        corners.push(e.latlng);
        const style = SHAPE_STYLE[String(currentSign)];
        const marker = L.circleMarker(e.latlng, {
          radius: 9, color: "#fff", weight: 3, fillColor: style.color, fillOpacity: 1,
        }).addTo(map);
        markers.push(marker);
        refreshMeasureUI();
      });
    }

    if (state.latlng) {
      map.setView(state.latlng, 20);
    } else {
      // No address — try the phone's GPS so they aren't staring at all of America.
      map.setView([39.5, -98.35], 4);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 20),
          () => {} // declined — they can pinch-zoom to their house
        );
      }
    }
    setTimeout(() => map.invalidateSize(), 60);
    refreshMeasureUI();
  }

  function closeMeasure() {
    $("measure-overlay").classList.add("hidden");
  }

  $("btn-measure-cancel").addEventListener("click", closeMeasure);
  $("btn-measure-undo").addEventListener("click", () => {
    if (corners.length > 0) {
      corners.pop();
      const m = markers.pop();
      if (m) m.remove();
    } else if (shapes.length > 0) {
      // nothing in progress — undo the last finished shape instead
      const s = shapes.pop();
      s.layer.remove();
      if (shapes.length === 0) currentSign = 1;
    }
    refreshMeasureUI();
  });

  // Largest believable residential surface. Anything bigger means they
  // outlined the neighborhood at low zoom, not their driveway.
  const MAX_REASONABLE_SQFT = 25000;

  $("btn-measure-done").addEventListener("click", () => {
    commitCurrentShape();
    const svc = currentService();
    const sqft = Math.max(netSqM() * SQM_TO_SQFT, 1);
    if (sqft > MAX_REASONABLE_SQFT) {
      alert(
        "Whoa \u2014 that outline covers " + Math.round(sqft).toLocaleString() +
        " sq ft! Zoom in until you can clearly see your " + svc.name.toLowerCase() +
        ", then tap its corners."
      );
      refreshMeasureUI();
      return;
    }
    const hasCut = shapes.some((s) => s.sign < 0);
    state.sizes[svc.id] = {
      label: hasCut ? "Measured on map (cut-out removed)" : "Measured on map",
      sqft: sqft,
      price: Math.max(sqft * svc.rate, svc.min || 0),
    };
    closeMeasure();
    nextSizeOrQuote();
  });
})();
