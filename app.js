/* ============================================================
   app.js — Google-Maps-style instant pressure-washing quote tool
   Powered by Google Maps JavaScript API (Places + Geometry).
   All logic client-side; config lives in config.js.
   ============================================================ */

(function () {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) =>
    (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- state ----------
  const state = {
    address: "",
    latlng: null,           // { lat, lng }
    selected: [],           // service ids in the order chosen
    sizes: {},              // serviceId -> { label, sqft?, price }
    sizeIndex: 0,           // which selected service we're sizing right now
    timeOfDay: "Either",    // booking preference

    // measure state
    measuring: false,
    measureServiceId: null,
    shapes: [],             // [{path: LatLng[], sign: +1|-1, polygon}]
    currentPath: [],        // LatLng[] in-progress vertices
    currentSign: 1,
    currentMarkers: [],     // vertex markers for the in-progress path
    currentPolygon: null,   // Polygon for in-progress shape
  };

  // ---------- DOM handles ----------
  const bootEl       = $("booting");
  const nokeyEl      = $("nokey");
  const searchBarEl  = $("search-bar");
  const addressInput = $("address-input");
  const searchClearEl       = $("search-clear");
  const measureTopEl        = $("measure-top");
  const measureInstructionsEl = $("measure-instructions");
  const measureReadoutEl    = $("measure-readout");
  const sheetEl      = $("sheet");
  const sheetBodyEl  = $("sheet-body");
  const measureControlsEl  = $("measure-controls");
  const btnAdd    = $("btn-add");
  const btnCut    = $("btn-cut");
  const btnUndo   = $("btn-undo");
  const btnCancel = $("btn-cancel");
  const btnDone   = $("btn-done");

  let map = null;
  let addressMarker = null;
  let mapClickListener = null;

  // ---------- boot ----------
  const bizBootEl = $("biz-booting");
  if (bizBootEl) bizBootEl.textContent = CONFIG.business.name;

  if (!CONFIG.googleMapsApiKey) {
    bootEl.classList.add("hidden");
    nokeyEl.classList.remove("hidden");
  } else {
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      "?key=" + encodeURIComponent(CONFIG.googleMapsApiKey) +
      "&libraries=places,geometry" +
      "&loading=async" +
      "&callback=initApp";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  // ---------- initApp (Google Maps callback) ----------
  window.initApp = function () {
    bootEl.classList.add("hidden");
    searchBarEl.classList.remove("hidden");

    map = new google.maps.Map($("map"), {
      center: { lat: 39.5, lng: -98.35 },
      zoom: 4,
      mapTypeId: "hybrid",
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      clickableIcons: false,
      tilt: 0,
    });

    // Places Autocomplete
    const autocomplete = new google.maps.places.Autocomplete(addressInput, {
      fields: ["geometry", "formatted_address"],
      types: ["address"],
    });

    autocomplete.addListener("place_changed", function () {
      const place = autocomplete.getPlace();
      if (!place.geometry || !place.geometry.location) return;

      const loc = place.geometry.location;
      state.latlng = { lat: loc.lat(), lng: loc.lng() };
      state.address = place.formatted_address || addressInput.value;

      // Reset quote state for the new address
      state.selected = [];
      state.sizes = {};
      state.sizeIndex = 0;
      state.timeOfDay = "Either";

      map.panTo(loc);
      smoothZoom(map, 20, map.getZoom());

      if (addressMarker) addressMarker.setMap(null);
      addressMarker = new google.maps.Marker({
        position: loc,
        map: map,
        animation: google.maps.Animation.DROP,
      });

      // Pan map up a bit after the sheet opens so the marker is visible
      setTimeout(function () { map.panBy(0, 120); }, 500);

      showStep("services");
    });

    // Search clear button
    addressInput.addEventListener("input", function () {
      searchClearEl.classList.toggle("hidden", !addressInput.value);
    });
    searchClearEl.addEventListener("click", function () {
      addressInput.value = "";
      searchClearEl.classList.add("hidden");
      addressInput.focus();
    });

    // Measure toolbar buttons
    btnAdd.addEventListener("click", function () { commitCurrentShapeAndStart(1); });
    btnCut.addEventListener("click", function () { commitCurrentShapeAndStart(-1); });
    btnUndo.addEventListener("click", undoMeasure);
    btnCancel.addEventListener("click", cancelMeasure);
    btnDone.addEventListener("click", doneMeasure);
  };

  // ---------- smooth zoom ----------
  function smoothZoom(mapInstance, target, current) {
    if (current === target) return;
    var next = current + (target > current ? 1 : -1);
    mapInstance.setZoom(next);
    if (next !== target) {
      setTimeout(function () { smoothZoom(mapInstance, target, next); }, 80);
    }
  }

  // ---------- pricing ----------
  function priceForPreset(svc, preset) {
    if (preset.price != null) return preset.price;
    return Math.max(preset.sqft * svc.rate, svc.min || 0);
  }

  function buildLines() {
    var lines = state.selected.map(function (id) {
      var svc = CONFIG.services.find(function (s) { return s.id === id; });
      var size = state.sizes[id];
      return {
        name: svc.emoji + " " + svc.name,
        sub: size.sqft
          ? size.label + " · about " + Math.round(size.sqft).toLocaleString() + " sq ft"
          : size.label,
        amount: size.price,
        discount: false,
      };
    });

    var total = lines.reduce(function (sum, l) { return sum + l.amount; }, 0);

    if (CONFIG.bundleDiscountPercent > 0 && lines.length >= 2) {
      var off = total * (CONFIG.bundleDiscountPercent / 100);
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
        discount: false,
      });
      total = CONFIG.minimumJob;
    }

    return { lines: lines, total: total };
  }

  function renderLines(listEl, totalEl) {
    var result = buildLines();
    var lines = result.lines;
    var total = result.total;
    listEl.innerHTML = "";
    lines.forEach(function (l) {
      var li = document.createElement("li");
      if (l.discount) li.className = "discount";
      li.innerHTML =
        "<span>" +
        escHtml(l.name) +
        "<span class='l-sub'>" +
        escHtml(l.sub) +
        "</span></span>" +
        "<span class='l-amt'>" +
        fmt(l.amount) +
        "</span>";
      listEl.appendChild(li);
    });
    if (totalEl) totalEl.textContent = fmt(total);
    return total;
  }

  // ---------- bottom-sheet step engine ----------
  var _currentStep = null;
  var _hideSheetTimer = null;

  function showStep(name) {
    // Cancel any pending hide timer so it doesn't close us right after we open
    if (_hideSheetTimer) { clearTimeout(_hideSheetTimer); _hideSheetTimer = null; }

    if (sheetEl.classList.contains("hidden")) {
      // First time (or forced hidden) — render immediately
      sheetBodyEl.innerHTML = "";
      renderStep(name);
      sheetEl.classList.remove("hidden");
      sheetEl.classList.remove("slide-out");
    } else {
      // Slide out, swap content, slide in
      sheetEl.classList.add("slide-out");
      setTimeout(function () {
        sheetBodyEl.innerHTML = "";
        renderStep(name);
        sheetEl.classList.remove("slide-out");
      }, 160);
    }
    _currentStep = name;
  }

  function hideSheet() {
    sheetEl.classList.add("slide-out");
    _hideSheetTimer = setTimeout(function () {
      sheetEl.classList.add("hidden");
      _hideSheetTimer = null;
    }, 320);
  }

  function renderStep(name) {
    switch (name) {
      case "services": renderServices(); break;
      case "size":     renderSize();     break;
      case "quote":    renderQuote();    break;
      case "book":     renderBook();     break;
      default: break;
    }
  }

  // ---------- STEP: services ----------
  function renderServices() {
    var h2 = document.createElement("h2");
    h2.textContent = "What needs cleaning?";
    sheetBodyEl.appendChild(h2);

    var p = document.createElement("p");
    p.className = "sub";
    p.textContent = CONFIG.business.tagline;
    sheetBodyEl.appendChild(p);

    var grid = document.createElement("div");
    grid.className = "chip-grid";

    var continueBtn = document.createElement("button");
    continueBtn.className = "btn btn-primary";
    continueBtn.type = "button";
    continueBtn.textContent = "Continue";
    continueBtn.disabled = state.selected.length === 0;

    CONFIG.services.forEach(function (svc) {
      var chip = document.createElement("button");
      chip.className = "chip" + (state.selected.indexOf(svc.id) >= 0 ? " on" : "");
      chip.type = "button";
      chip.innerHTML =
        "<span class='chip-emoji'>" + svc.emoji + "</span>" +
        "<span class='chip-name'>" + escHtml(svc.name) + "</span>" +
        "<span class='chip-sub'>" + escHtml(svc.blurb) + "</span>";

      chip.addEventListener("click", function () {
        var idx = state.selected.indexOf(svc.id);
        if (idx >= 0) {
          state.selected.splice(idx, 1);
          delete state.sizes[svc.id];
          chip.classList.remove("on");
        } else {
          state.selected.push(svc.id);
          chip.classList.add("on");
        }
        continueBtn.disabled = state.selected.length === 0;
      });
      grid.appendChild(chip);
    });

    sheetBodyEl.appendChild(grid);

    continueBtn.addEventListener("click", function () {
      state.sizeIndex = 0;
      showStep("size");
    });
    sheetBodyEl.appendChild(continueBtn);
  }

  // ---------- STEP: size ----------
  function renderSize() {
    var svc = CONFIG.services.find(function (s) { return s.id === state.selected[state.sizeIndex]; });
    if (!svc) return;

    var n = state.selected.length;
    var h2 = document.createElement("h2");
    h2.textContent =
      "How big is your " + svc.name.toLowerCase() + "?" +
      (n > 1 ? " (" + (state.sizeIndex + 1) + " of " + n + ")" : "");
    sheetBodyEl.appendChild(h2);

    var hint = document.createElement("p");
    hint.className = "sub";
    hint.textContent = "Closest guess is fine — we double-check on arrival.";
    sheetBodyEl.appendChild(hint);

    if (svc.mappable) {
      var ctaBtn = document.createElement("button");
      ctaBtn.className = "measure-cta";
      ctaBtn.type = "button";
      ctaBtn.innerHTML =
        "<span class='cta-badge'>EXACT PRICE</span>" +
        "<div class='cta-title'>&#x1F6F0; Trace it on the map</div>" +
        "<div class='cta-sub'>See your home from above — trace your " +
        escHtml(svc.name.toLowerCase()) + " for a to-the-foot price</div>";
      (function (s) {
        ctaBtn.addEventListener("click", function () { enterMeasureMode(s); });
      })(svc);
      sheetBodyEl.appendChild(ctaBtn);

      var divEl = document.createElement("p");
      divEl.className = "divider";
      divEl.textContent = "— or pick a size —";
      sheetBodyEl.appendChild(divEl);
    }

    svc.presets.forEach(function (preset) {
      var btn = document.createElement("button");
      btn.className = "opt";
      btn.type = "button";
      btn.innerHTML =
        "<span><span class='opt-label'>" + escHtml(preset.label) + "</span>" +
        "<br><span class='opt-sub'>" + escHtml(preset.sub) + "</span></span>" +
        "<span class='opt-price'>" + fmt(priceForPreset(svc, preset)) + "</span>";
      (function (s, pr) {
        btn.addEventListener("click", function () {
          state.sizes[s.id] = {
            label: pr.label,
            sqft: pr.sqft || null,
            price: priceForPreset(s, pr),
          };
          nextSizeOrQuote();
        });
      })(svc, preset);
      sheetBodyEl.appendChild(btn);
    });
  }

  function nextSizeOrQuote() {
    state.sizeIndex++;
    if (state.sizeIndex < state.selected.length) {
      showStep("size");
    } else {
      showStep("quote");
    }
  }

  // ---------- STEP: quote ----------
  function renderQuote() {
    var h2 = document.createElement("h2");
    h2.textContent = "Your price";
    sheetBodyEl.appendChild(h2);

    var list = document.createElement("ul");
    list.className = "lines";
    sheetBodyEl.appendChild(list);

    var totalRow = document.createElement("div");
    totalRow.className = "total";
    totalRow.innerHTML = "<span>Total</span><span class='t-amt'></span>";
    sheetBodyEl.appendChild(totalRow);

    renderLines(list, totalRow.querySelector(".t-amt"));

    var fine = document.createElement("p");
    fine.className = "fine";
    fine.textContent = CONFIG.disclaimer;
    sheetBodyEl.appendChild(fine);

    var bookBtn = document.createElement("button");
    bookBtn.className = "btn btn-primary";
    bookBtn.type = "button";
    bookBtn.textContent = "Book it";
    bookBtn.addEventListener("click", function () { showStep("book"); });
    sheetBodyEl.appendChild(bookBtn);

    var backBtn = document.createElement("button");
    backBtn.className = "btn-text";
    backBtn.type = "button";
    backBtn.textContent = "← Change something";
    backBtn.addEventListener("click", function () {
      state.sizeIndex = 0;
      showStep("services");
    });
    sheetBodyEl.appendChild(backBtn);
  }

  // ---------- STEP: book ----------
  function renderBook() {
    var h2 = document.createElement("h2");
    h2.textContent = "Book your cleaning";
    sheetBodyEl.appendChild(h2);

    var nameField = document.createElement("input");
    nameField.className = "field";
    nameField.type = "text";
    nameField.placeholder = "Your name";
    sheetBodyEl.appendChild(nameField);

    var phoneField = document.createElement("input");
    phoneField.className = "field";
    phoneField.type = "tel";
    phoneField.placeholder = "Phone number";
    sheetBodyEl.appendChild(phoneField);

    var dateField = document.createElement("input");
    dateField.className = "field";
    dateField.type = "date";
    var prefill = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    dateField.value = prefill.toISOString().slice(0, 10);
    sheetBodyEl.appendChild(dateField);

    var pillRow = document.createElement("div");
    pillRow.className = "pill-row";
    ["Morning", "Afternoon", "Either"].forEach(function (label) {
      var pill = document.createElement("button");
      pill.className = "pill" + (state.timeOfDay === label ? " on" : "");
      pill.type = "button";
      pill.textContent = label;
      pill.addEventListener("click", function () {
        state.timeOfDay = label;
        pillRow.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("on"); });
        pill.classList.add("on");
      });
      pillRow.appendChild(pill);
    });
    sheetBodyEl.appendChild(pillRow);

    var errEl = document.createElement("p");
    errEl.className = "err";
    errEl.style.display = "none";
    sheetBodyEl.appendChild(errEl);

    var sendBtn = document.createElement("button");
    sendBtn.className = "btn btn-primary";
    sendBtn.type = "button";
    sendBtn.textContent = "Request booking";
    sendBtn.addEventListener("click", function () {
      var name = nameField.value.trim();
      var phone = phoneField.value.trim();
      if (!name || !phone) {
        errEl.textContent = "Please enter your name and phone number.";
        errEl.style.display = "";
        return;
      }
      errEl.style.display = "none";
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      sendBooking(name, phone, dateField.value, state.timeOfDay);
    });
    sheetBodyEl.appendChild(sendBtn);
  }

  // ---------- booking delivery ----------
  function buildSummaryText(name, phone, date, time) {
    var result = buildLines();
    var lines = result.lines;
    var total = result.total;
    var itemLines = lines
      .map(function (l) { return l.name + " — " + fmt(l.amount) + " (" + l.sub + ")"; })
      .join("\n");
    return [
      CONFIG.business.name + " — Booking Request",
      "",
      "Customer: " + name,
      "Phone: " + phone,
      "Address: " + state.address,
      "Preferred date: " + date,
      "Preferred time: " + time,
      "",
      "Services:",
      itemLines,
      "",
      "TOTAL: " + fmt(total),
      "",
      CONFIG.disclaimer,
    ].join("\n");
  }

  function sendBooking(name, phone, date, time) {
    var summary = buildSummaryText(name, phone, date, time);

    function finish(usedEmail) {
      sheetBodyEl.innerHTML = "";
      renderDone(usedEmail, name);
    }

    if (CONFIG.web3formsKey) {
      fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: CONFIG.web3formsKey,
          subject: "New booking request — " + name,
          from_name: name,
          message: summary,
        }),
      })
        .then(function (res) {
          if (res.ok) {
            finish(true);
          } else {
            fallbackMailto(summary);
            finish(false);
          }
        })
        .catch(function () {
          fallbackMailto(summary);
          finish(false);
        });
    } else {
      fallbackMailto(summary);
      finish(false);
    }
  }

  function fallbackMailto(summary) {
    var subject = encodeURIComponent("Booking request — " + CONFIG.business.name);
    var body = encodeURIComponent(summary);
    window.location.href =
      "mailto:" + CONFIG.business.email + "?subject=" + subject + "&body=" + body;
  }

  // ---------- STEP: done ----------
  function renderDone(usedEmail, name) {
    var h2 = document.createElement("h2");
    h2.textContent = usedEmail
      ? "You’re all set, " + name + "! 🎉"
      : "Almost done, " + name + "!";
    sheetBodyEl.appendChild(h2);

    var msg = document.createElement("p");
    msg.textContent = usedEmail
      ? "Your booking request is on its way. We’ll reach out soon to confirm."
      : "Your email app should have opened with the booking request — just hit send!";
    sheetBodyEl.appendChild(msg);

    var h3 = document.createElement("h3");
    h3.textContent = "Quote summary";
    h3.style.margin = "18px 0 4px";
    sheetBodyEl.appendChild(h3);

    var list = document.createElement("ul");
    list.className = "lines";
    sheetBodyEl.appendChild(list);

    var totalRow = document.createElement("div");
    totalRow.className = "total";
    totalRow.innerHTML = "<span>Total</span><span class='t-amt'></span>";
    sheetBodyEl.appendChild(totalRow);

    renderLines(list, totalRow.querySelector(".t-amt"));

    var contact = document.createElement("p");
    contact.className = "fine";
    contact.textContent =
      "Questions? Call us: " + CONFIG.business.phone + " · " + CONFIG.business.email;
    sheetBodyEl.appendChild(contact);
  }

  // ================================================================
  //  MEASURE MODE
  // ================================================================

  function enterMeasureMode(svc) {
    state.measuring = true;
    state.measureServiceId = svc.id;
    state.shapes = [];
    state.currentPath = [];
    state.currentSign = 1;
    state.currentMarkers = [];
    state.currentPolygon = null;

    hideSheet();
    measureTopEl.classList.remove("hidden");
    measureControlsEl.classList.remove("hidden");

    measureInstructionsEl.innerHTML =
      "Tap each <b>corner</b> of your " + escHtml(svc.name.toLowerCase()) + ".";
    btnCut.textContent =
      svc.id === "patio" ? "➖ Cut out pool" : "➖ Cut a part out";
    btnDone.disabled = true;
    btnAdd.disabled = false;
    btnCut.disabled = false;

    mapClickListener = map.addListener("click", onMapClick);
    updateMeasureReadout();
  }

  function onMapClick(e) {
    state.currentPath.push(e.latLng);

    var isAdd = state.currentSign > 0;
    var marker = new google.maps.Marker({
      position: e.latLng,
      map: map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: isAdd ? "#1a73e8" : "#d93025",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
    });
    state.currentMarkers.push(marker);

    drawCurrentPolygon();
    updateMeasureReadout();
  }

  function drawCurrentPolygon() {
    if (state.currentPolygon) {
      state.currentPolygon.setMap(null);
      state.currentPolygon = null;
    }
    if (state.currentPath.length < 2) return;

    var isAdd = state.currentSign > 0;
    state.currentPolygon = new google.maps.Polygon({
      paths: state.currentPath,
      map: map,
      strokeColor: isAdd ? "#1a73e8" : "#d93025",
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: isAdd ? "#1a73e8" : "#d93025",
      fillOpacity: 0.25,
    });
  }

  function sqftOfPath(path) {
    var area = google.maps.geometry.spherical.computeArea(path);
    return area * 10.7639;
  }

  function netSqft() {
    var total = 0;
    state.shapes.forEach(function (sh) {
      total += sh.sign * sqftOfPath(sh.path);
    });
    if (state.currentPath.length >= 3) {
      total += state.currentSign * sqftOfPath(state.currentPath);
    }
    return Math.max(0, total);
  }

  function updateMeasureReadout() {
    var n = state.currentPath.length;
    var committed = state.shapes.length;

    if (committed === 0 && n < 3) {
      measureReadoutEl.textContent =
        n === 0
          ? "Tap corners to start"
          : n + " corner" + (n === 1 ? "" : "s") + " — tap at least 3";
    } else {
      var sqft = netSqft();
      measureReadoutEl.textContent = Math.round(sqft).toLocaleString() + " sq ft";
    }

    var hasArea = netSqft() > 0;
    btnDone.disabled = !hasArea;
  }

  function commitCurrentShapeAndStart(sign) {
    if (state.currentPath.length >= 3) {
      if (state.currentPolygon) {
        state.currentPolygon.setMap(null);
        state.currentPolygon = null;
      }
      var isAdd = state.currentSign > 0;
      var committedPolygon = new google.maps.Polygon({
        paths: state.currentPath,
        map: map,
        strokeColor: isAdd ? "#1a73e8" : "#d93025",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: isAdd ? "#1a73e8" : "#d93025",
        fillOpacity: 0.2,
      });
      state.shapes.push({
        path: state.currentPath.slice(),
        sign: state.currentSign,
        polygon: committedPolygon,
      });
      state.currentMarkers.forEach(function (m) { m.setMap(null); });
      state.currentMarkers = [];
      state.currentPath = [];
    }

    state.currentSign = sign;
    updateMeasureReadout();
  }

  function undoMeasure() {
    if (state.currentPath.length > 0) {
      state.currentPath.pop();
      var lastMarker = state.currentMarkers.pop();
      if (lastMarker) lastMarker.setMap(null);
      drawCurrentPolygon();
    } else if (state.shapes.length > 0) {
      var last = state.shapes.pop();
      if (last.polygon) last.polygon.setMap(null);
    }
    updateMeasureReadout();
  }

  function cancelMeasure() {
    clearMeasureOverlays();
    exitMeasureMode();
    showStep("size");
  }

  function doneMeasure() {
    var sqft = netSqft();
    if (sqft > 25000) {
      alert(
        "That’s over 25,000 sq ft — please zoom in and re-trace a smaller area. " +
        "If your surface really is that large, call us for a custom quote!"
      );
      return;
    }

    var svc = CONFIG.services.find(function (s) { return s.id === state.measureServiceId; });
    var hasCut = state.shapes.some(function (sh) { return sh.sign < 0; });
    var label = hasCut ? "Measured on map (cut-out removed)" : "Measured on map";
    var price = Math.max(sqft * svc.rate, svc.min || 0);

    state.sizes[svc.id] = { label: label, sqft: sqft, price: price };

    clearMeasureOverlays();
    exitMeasureMode();
    nextSizeOrQuote();
  }

  function clearMeasureOverlays() {
    state.shapes.forEach(function (sh) {
      if (sh.polygon) sh.polygon.setMap(null);
    });
    state.currentMarkers.forEach(function (m) { m.setMap(null); });
    if (state.currentPolygon) {
      state.currentPolygon.setMap(null);
      state.currentPolygon = null;
    }
    state.shapes = [];
    state.currentPath = [];
    state.currentMarkers = [];
  }

  function exitMeasureMode() {
    state.measuring = false;
    if (mapClickListener) {
      google.maps.event.removeListener(mapClickListener);
      mapClickListener = null;
    }
    measureTopEl.classList.add("hidden");
    measureControlsEl.classList.add("hidden");
  }

})();
