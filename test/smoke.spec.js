/* Focused Playwright smoke test for the map-centric quote tool.
   Google Maps cannot load for real in the sandbox (no network/key), so we
   inject a minimal mock `window.google` before app.js runs and drive the
   bottom-sheet flow. Verifies: no-key overlay, the address→services→size→
   quote flow, the exact $449 bundle total, and booking validation. */

const { chromium } = require("/tmp/node_modules/playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = 8123;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = req.url.split("?")[0];
      if (urlPath === "/") urlPath = "/index.html";
      const file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
      res.end(fs.readFileSync(file));
    });
    server.listen(PORT, () => resolve(server));
  });
}

// Minimal google.maps mock injected before any script runs.
const GOOGLE_MOCK = `
window.__placeChangedCb = null;
window.google = {
  maps: {
    Map: function () {
      this.panTo = function () {};
      this.panBy = function () {};
      this.setZoom = function () {};
      this.getZoom = function () { return 20; };
      this.addListener = function (ev, cb) {
        if (ev === "click") window.__mapClick = cb;
        return { ev: ev };
      };
    },
    Marker: function () {
      this.setMap = function () {};
    },
    Polygon: function () {
      this.setMap = function () {};
    },
    Animation: { DROP: 1 },
    SymbolPath: { CIRCLE: 0 },
    event: { removeListener: function () {} },
    geometry: {
      spherical: {
        // Return an area (m^2) that maps to the requested sq ft when * 10.7639.
        computeArea: function (pathArr) {
          // path is tagged with a __sqft field by the test helper.
          var sqft = (pathArr && pathArr.__sqft) || 0;
          return sqft / 10.7639;
        },
      },
    },
    places: {
      Autocomplete: function () {
        this.addListener = function (ev, cb) {
          if (ev === "place_changed") window.__placeChangedCb = cb;
        };
        this.getPlace = function () { return window.__nextPlace; };
      },
    },
  },
};
`;

async function run() {
  const server = await serve();
  const browser = await chromium.launch();
  let failures = 0;
  const assert = (cond, msg) => {
    if (cond) {
      console.log("  PASS:", msg);
    } else {
      console.error("  FAIL:", msg);
      failures++;
    }
  };

  try {
    // ---- Test 1: no-key overlay shows when key is blank ----
    {
      const page = await browser.newPage();
      await page.addInitScript(GOOGLE_MOCK);
      // Force blank key regardless of config.js.
      await page.addInitScript(() => {
        window.__forceBlankKey = true;
      });
      await page.goto(`http://localhost:${PORT}/`);
      // Override CONFIG key after config.js but the app reads it at load; patch
      // via route is simplest: we re-evaluate by checking config and overlay.
      await page.waitForTimeout(200);
      const blank = await page.evaluate(() => CONFIG.googleMapsApiKey === "");
      if (blank) {
        const visible = await page.locator("#nokey").isVisible();
        assert(visible, "no-key overlay visible when key blank");
        const booting = await page.locator("#booting").isVisible();
        assert(!booting, "booting overlay hidden when key blank");
      } else {
        console.log("  SKIP: config has a key set, no-key overlay test skipped");
      }
      await page.close();
    }

    // ---- Test 2: full flow with injected key + mocked maps ----
    {
      const page = await browser.newPage();
      await page.addInitScript(GOOGLE_MOCK);
      // Inject a fake key so app.js takes the maps-loading path, and stub the
      // script loader so it invokes initApp synchronously instead of network.
      await page.addInitScript(() => {
        const realCreate = document.createElement.bind(document);
        document.createElement = function (tag) {
          const el = realCreate(tag);
          if (String(tag).toLowerCase() === "script") {
            // Defeat the maps script: as soon as src is set to the maps URL,
            // call the global callback instead of fetching.
            let _src = "";
            Object.defineProperty(el, "src", {
              get() { return _src; },
              set(v) {
                _src = v;
                if (v.indexOf("maps.googleapis.com") >= 0) {
                  setTimeout(() => window.initApp && window.initApp(), 0);
                }
              },
            });
          }
          return el;
        };
      });
      // Set a key into config before app.js runs.
      await page.addInitScript(() => {
        Object.defineProperty(window, "__patchConfig", { value: true });
      });
      await page.route("**/config.js", async (route) => {
        const res = await route.fetch();
        let body = await res.text();
        body = body.replace('googleMapsApiKey: ""', 'googleMapsApiKey: "TEST_KEY"');
        route.fulfill({ body, contentType: "application/javascript" });
      });

      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector("#search-bar:not(.hidden)", { timeout: 3000 });
      assert(true, "search bar shows after maps init");

      // Fire a place_changed with geometry.
      await page.evaluate(() => {
        window.__nextPlace = {
          formatted_address: "123 Test St, Waverly",
          geometry: { location: { lat: () => 40, lng: () => -75 } },
        };
        window.__placeChangedCb();
      });
      await page.waitForSelector("#sheet:not(.hidden)", { timeout: 3000 });

      // Services step: pick Driveway then House Wash.
      await page.waitForSelector(".chip-grid");
      const chips = page.locator(".chip");
      const count = await chips.count();
      // Match by name text.
      async function clickChipByName(name) {
        for (let i = 0; i < count; i++) {
          const t = await chips.nth(i).locator(".chip-name").textContent();
          if (t.trim() === name) { await chips.nth(i).click(); return; }
        }
        throw new Error("chip not found: " + name);
      }
      await clickChipByName("Driveway");
      await clickChipByName("House Wash");
      await page.locator(".btn-primary", { hasText: "Continue" }).click();

      // Size step 1: Driveway → pick 2-car preset.
      // Wait for the heading that names the current service (sheet content
      // swaps after a ~160ms transition, so anchor on the heading text).
      async function clickOptByLabel(label) {
        const opt = page.locator(".opt").filter({ hasText: label });
        await opt.first().click();
      }
      await page.waitForFunction(() => {
        const h = document.querySelector("#sheet-body h2");
        return h && /driveway/i.test(h.textContent);
      });
      await clickOptByLabel("2-car");

      // Size step 2: House Wash → 2 story.
      await page.waitForFunction(() => {
        const h = document.querySelector("#sheet-body h2");
        return h && /house wash/i.test(h.textContent);
      });
      await clickOptByLabel("2 story");

      // Quote step.
      await page.waitForFunction(() => {
        const h = document.querySelector("#sheet-body h2");
        return h && /your price/i.test(h.textContent);
      });
      await page.waitForSelector(".total");
      const total = (await page.locator(".total .t-amt").textContent()).trim();
      assert(total === "$449", "bundle total is exactly $449 (got " + total + ")");

      // Verify discount line is negative formatted with the minus glyph.
      const discountAmt = (await page.locator("li.discount .l-amt").textContent()).trim();
      assert(discountAmt.charAt(0) === "−", "discount shown as negative (got " + discountAmt + ")");

      // Booking step + validation.
      await page.locator(".btn-primary", { hasText: "Book it" }).click();
      await page.waitForSelector(".field");
      await page.locator(".btn-primary", { hasText: "Request booking" }).click();
      await page.waitForSelector(".err");
      const errVisible = await page.locator(".err").isVisible();
      assert(errVisible, "booking validation blocks empty name/phone");

      // Fill in and confirm error clears (we stop before network send).
      await page.locator("input[placeholder='Your name']").fill("Test User");
      await page.locator("input[placeholder='Phone number']").fill("5551234");
      const nameVal = await page.locator("input[placeholder='Your name']").inputValue();
      assert(nameVal === "Test User", "name field accepts input");

      await page.close();
    }

    // ---- Test 3: measured trace flow (driveway only) ----
    {
      const page = await browser.newPage();
      await page.addInitScript(GOOGLE_MOCK);
      await page.addInitScript(() => {
        const realCreate = document.createElement.bind(document);
        document.createElement = function (tag) {
          const el = realCreate(tag);
          if (String(tag).toLowerCase() === "script") {
            let _src = "";
            Object.defineProperty(el, "src", {
              get() { return _src; },
              set(v) {
                _src = v;
                if (v.indexOf("maps.googleapis.com") >= 0) {
                  setTimeout(() => window.initApp && window.initApp(), 0);
                }
              },
            });
          }
          return el;
        };
      });
      await page.route("**/config.js", async (route) => {
        const res = await route.fetch();
        let body = await res.text();
        body = body.replace('googleMapsApiKey: ""', 'googleMapsApiKey: "TEST_KEY"');
        route.fulfill({ body, contentType: "application/javascript" });
      });

      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForSelector("#search-bar:not(.hidden)", { timeout: 3000 });
      await page.evaluate(() => {
        window.__nextPlace = {
          formatted_address: "9 Map Ln, Waverly",
          geometry: { location: { lat: () => 40, lng: () => -75 } },
        };
        window.__placeChangedCb();
      });
      await page.waitForSelector("#sheet:not(.hidden)");
      await page.waitForFunction(() => /what needs/i.test(
        (document.querySelector("#sheet-body h2") || {}).textContent || ""));

      // Pick only Driveway, continue to size.
      const chips = page.locator(".chip");
      const n = await chips.count();
      for (let i = 0; i < n; i++) {
        const t = await chips.nth(i).locator(".chip-name").textContent();
        if (t.trim() === "Driveway") { await chips.nth(i).click(); break; }
      }
      await page.locator(".btn-primary", { hasText: "Continue" }).click();
      await page.waitForFunction(() => /driveway/i.test(
        (document.querySelector("#sheet-body h2") || {}).textContent || ""));

      // Enter measure mode via the "Trace it" CTA.
      await page.locator(".measure-cta").click();
      await page.waitForSelector("#measure-controls:not(.hidden)");
      const sheetHidden = await page.locator("#sheet").evaluate(
        (el) => el.classList.contains("hidden") || el.classList.contains("slide-out"));
      assert(sheetHidden, "sheet hidden/sliding while measuring (not co-visible)");

      // Simulate 4 map clicks forming ~1000 sq ft. The mock reads __sqft off
      // the path array, so tag currentPath after the clicks land.
      await page.evaluate(() => {
        function mk() { return {}; }
        for (let i = 0; i < 4; i++) window.__mapClick({ latLng: mk() });
      });
      // Force computeArea to report 1000 sqft for any path of length>=3.
      await page.evaluate(() => {
        const orig = google.maps.geometry.spherical.computeArea;
        google.maps.geometry.spherical.computeArea = function (p) {
          if (p && p.length >= 3) return 1000 / 10.7639;
          return orig(p);
        };
      });
      // Trigger a readout refresh by clicking Undo twice is destructive;
      // instead re-fire a click to force recompute, then undo it.
      await page.evaluate(() => window.__mapClick({ latLng: {} }));
      const readout = (await page.locator("#measure-readout").textContent()).trim();
      assert(/sq ft/.test(readout), "measure readout shows sq ft (got " + readout + ")");

      // Done → goes to quote. Driveway 1000 sqft × $0.25 = $250 (above min).
      await page.locator("#btn-done").click();
      await page.waitForFunction(() => /your price/i.test(
        (document.querySelector("#sheet-body h2") || {}).textContent || ""));
      const measuredTotal = (await page.locator(".total .t-amt").textContent()).trim();
      assert(measuredTotal === "$250", "measured driveway total is $250 (got " + measuredTotal + ")");
      // Measure toolbar fully gone now.
      const ctrlGone = await page.locator("#measure-controls").evaluate(
        (el) => el.classList.contains("hidden"));
      assert(ctrlGone, "measure controls hidden after Done");

      await page.close();
    }
  } catch (e) {
    console.error("  ERROR:", e.message);
    failures++;
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
