/* ============================================================
   EDIT THIS FILE TO CHANGE YOUR PRICES & BUSINESS INFO.
   Nothing else needs to be touched.
   ============================================================ */

const CONFIG = {
  business: {
    name: "Waverly Pressure Washing",
    tagline: "Get your price in 60 seconds. No phone call needed.",
    phone: "(555) 555-5555",          // shown on the quote + "rather talk?" link
    email: "zarnoffk@gmail.com",      // where booking requests are sent
    serviceArea: "Waverly & surrounding areas",
  },

  // OPTIONAL but recommended: free key from https://web3forms.com
  // (enter your email there, paste the key here). Booking requests will
  // then land straight in your inbox. If left blank, the app falls back
  // to opening the customer's email app instead.
  web3formsKey: "",

  // Smallest job you'll roll the truck for.
  minimumJob: 149,

  // % off when they book 2 or more services (set 0 to disable).
  bundleDiscountPercent: 10,

  // Shown in small print under every quote.
  disclaimer:
    "This is an instant estimate. We confirm the final price on arrival — " +
    "if anything looks different than expected, we'll talk before we start.",

  /* ------------------------------------------------------------
     SERVICES
     - rate     : price per square foot (for measurable surfaces)
     - min      : minimum charge for that service
     - presets  : the big buttons customers tap. "sqft" presets are
                  priced at sqft × rate. "price" presets are flat.
     - mappable : true = offer "measure it on the map" option
     ------------------------------------------------------------ */
  services: [
    {
      id: "driveway",
      name: "Driveway",
      emoji: "🚗",
      blurb: "Concrete or pavers",
      rate: 0.25,
      min: 99,
      mappable: true,
      presets: [
        { label: "1-car", sub: "fits one car", sqft: 300 },
        { label: "2-car", sub: "fits two cars", sqft: 600 },
        { label: "3-car +", sub: "big or extra long", sqft: 950 },
      ],
    },
    {
      id: "patio",
      name: "Patio / Pool Deck",
      emoji: "⛱️",
      blurb: "Concrete, stone or pavers",
      rate: 0.3,
      min: 99,
      mappable: true,
      presets: [
        { label: "Small", sub: "table & a few chairs", sqft: 200 },
        { label: "Medium", sub: "full patio set", sqft: 450 },
        { label: "Large", sub: "wraps the pool", sqft: 800 },
      ],
    },
    {
      id: "walkway",
      name: "Sidewalk / Walkway",
      emoji: "🚶",
      blurb: "Paths & front walks",
      rate: 0.3,
      min: 49,
      mappable: true,
      presets: [
        { label: "Short", sub: "door to driveway", sqft: 100 },
        { label: "Average", sub: "front walk + sidewalk", sqft: 220 },
        { label: "Long", sub: "wraps the house", sqft: 400 },
      ],
    },
    {
      id: "house",
      name: "House Wash",
      emoji: "🏠",
      blurb: "Soft wash siding, all sides",
      mappable: false,
      presets: [
        { label: "1 story", sub: "ranch / single level", price: 249 },
        { label: "2 story", sub: "most family homes", price: 349 },
        { label: "3 story", sub: "tall or large home", price: 479 },
      ],
    },
    {
      id: "deck",
      name: "Wood Deck / Fence",
      emoji: "🪵",
      blurb: "Gentle wash, no damage",
      rate: 0.4,
      min: 99,
      mappable: true,
      presets: [
        { label: "Small", sub: "grill & a bench", sqft: 150 },
        { label: "Medium", sub: "full deck set", sqft: 300 },
        { label: "Large", sub: "multi-level / long fence", sqft: 550 },
      ],
    },
  ],
};
