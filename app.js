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

  // ---------- address (Nominatim, single lookup on submit) ----------
  async function geocode(query) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(query);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const results = await res.json();
    return results.length ? results[0] : null;
  }

  async function submitAddress() {
    const query = $("address-input").value.trim();
    $("address-error").classList.add("hidden");
    if (!query) {
      $("address-input").focus();
      return;
    }
    state.address = query;
    const btn = $("btn-address-next");
    btn.disabled = true;
    btn.textContent = "Finding your house…";
    let found = false;
    try {
      const hit = await geocode(query);
      if (hit) {
        state.latlng = [parseFloat(hit.lat), parseFloat(hit.lon)];
        found = true;
      }
    } catch (_) {
      found = true; // offline or rate-limited: not the customer's problem, move on
    }
    btn.disabled = false;
    btn.textContent = "Next \u00a0\u2192";
    if (found) show("services", "services");
    else $("address-error").classList.remove("hidden"); // stay; they can retry or Skip
  }

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

    $("btn-size-measure").classList.toggle("hidden", !svc.mappable);
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

  function refreshMeasureUI() {
    const sqft = polygonAreaSqM(corners) * SQM_TO_SQFT;
    if (corners.length < 3) {
      $("measure-readout").textContent =
        corners.length + " corner" + (corners.length === 1 ? "" : "s") + " — tap at least 3";
    } else {
      $("measure-readout").textContent = Math.round(sqft).toLocaleString() + " sq ft";
    }
    $("btn-measure-done").disabled = corners.length < 3;

    if (polygon) polygon.remove();
    polygon = null;
    if (corners.length >= 2) {
      polygon = L.polygon(corners, { color: "#0b66ff", weight: 3, fillOpacity: 0.25 }).addTo(map);
    }
  }

  function openMeasure() {
    $("measure-overlay").classList.remove("hidden");
    corners = [];
    markers.forEach((m) => m.remove());
    markers = [];
    if (polygon) { polygon.remove(); polygon = null; }

    if (!map) {
      map = L.map("measure-map", { zoomControl: true, attributionControl: true });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxNativeZoom: 19, maxZoom: 21, attribution: "Imagery © Esri" }
      ).addTo(map);
      map.on("click", (e) => {
        corners.push(e.latlng);
        const marker = L.circleMarker(e.latlng, {
          radius: 9, color: "#fff", weight: 3, fillColor: "#0b66ff", fillOpacity: 1,
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

  $("btn-size-measure").addEventListener("click", openMeasure);
  $("btn-measure-cancel").addEventListener("click", closeMeasure);
  $("btn-measure-undo").addEventListener("click", () => {
    corners.pop();
    const m = markers.pop();
    if (m) m.remove();
    refreshMeasureUI();
  });
  // Largest believable residential surface. Anything bigger means they
  // outlined the neighborhood at low zoom, not their driveway.
  const MAX_REASONABLE_SQFT = 25000;

  $("btn-measure-done").addEventListener("click", () => {
    const svc = currentService();
    const sqft = Math.max(polygonAreaSqM(corners) * SQM_TO_SQFT, 1);
    if (sqft > MAX_REASONABLE_SQFT) {
      alert(
        "Whoa — that outline covers " + Math.round(sqft).toLocaleString() +
        " sq ft! Zoom in until you can clearly see your " + svc.name.toLowerCase() +
        ", then tap its corners."
      );
      return;
    }
    state.sizes[svc.id] = {
      label: "Measured on map",
      sqft: sqft,
      price: Math.max(sqft * svc.rate, svc.min || 0),
    };
    closeMeasure();
    nextSizeOrQuote();
  });
})();
