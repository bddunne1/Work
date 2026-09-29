// Generates a realistic test data set for Aamstrand ERP: customers, items,
// vendors, ~6 months of sales orders (most shipped, a live pipeline at every
// stage today), vendor POs with receipts, returns, and a stock ledger that
// adds up to every item's on-hand.
//
//   cd server
//   node scripts/generate-test-data.mjs            # refuses if the DB already has data
//   node scripts/generate-test-data.mjs --reset    # deletes business data first (keeps accounts + settings)
//
// Options: --customers 1500 --skus 300 --orders 20000 --seed 42
//
// Uses DATABASE_URL from server/.env like the API does. Accounts are never
// touched: orders are stamped with the existing accounts (order entry /
// customer service as writers, analysts as checkers) when they exist, else
// with admin. Restart the API afterwards (its analytics cache holds the old
// numbers for up to a minute).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const RESET = argv.includes("--reset");
const N_CUSTOMERS = opt("customers", 1500);
const N_SKUS = opt("skus", 300);
const N_ORDERS = opt("orders", 20000);
const SEED = opt("seed", 42);
const ORDERS_PER_DAY = 154;

const prisma = new PrismaClient();

// ---------------------------------------------------------------- random
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
}
const rng = makeRng(SEED);

// Weighted pick from a prepared cumulative table.
function weighted(items, weights) {
  const cdf = [];
  let acc = 0;
  for (const w of weights) cdf.push((acc += w));
  return () => {
    const r = rng.next() * acc;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] >= r) hi = mid;
      else lo = mid + 1;
    }
    return items[lo];
  };
}

// ---------------------------------------------------------------- dates
const NOW = new Date();
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = localDay(NOW);
const dbDate = (day) => new Date(`${day}T00:00:00.000Z`); // @db.Date columns
function atTime(day, hour, minute = 0) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(y, m - 1, d, Math.floor(hour), minute + Math.round((hour % 1) * 60));
  // Nothing may be stamped in the future: squeeze today's activity into the
  // part of the day that has already happened.
  const latest = new Date(NOW.getTime() - 5 * 60000);
  return t > latest ? new Date(Math.max(new Date(y, m - 1, d, 0, 5).getTime(), latest.getTime() - rng.int(1, 240) * 60000)) : t;
}
function addBusinessDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  let left = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (left > 0) {
    t.setDate(t.getDate() + step);
    if (t.getDay() !== 0 && t.getDay() !== 6) left--;
  }
  return localDay(t);
}
// Business days, oldest first, ending today (today counts even on a weekend).
const N_DAYS = Math.ceil(N_ORDERS / ORDERS_PER_DAY);
const DAYS = [TODAY];
while (DAYS.length < N_DAYS) DAYS.unshift(addBusinessDays(DAYS[0], -1));
const dayIndex = new Map(DAYS.map((d, i) => [d, i]));

// ---------------------------------------------------------------- reference data
const STREETS = ["Main St", "Commerce Dr", "Industrial Pkwy", "Harbor Rd", "Market St", "Depot St", "Mill Rd", "Front St", "Water St", "Center Ave", "Railroad Ave", "Airport Rd", "County Rd 12", "Enterprise Blvd", "Dock St", "Elm St", "Oak Ave", "Warehouse Way", "Riverside Dr", "Lakeshore Dr", "State Route 9", "Farm Ln", "Pine St", "Maple Ave", "Distribution Dr"];
const CITIES = [
  ["Columbus", "OH", "43215"], ["Toledo", "OH", "43604"], ["Dayton", "OH", "45402"], ["Pittsburgh", "PA", "15222"], ["Erie", "PA", "16501"],
  ["Buffalo", "NY", "14202"], ["Albany", "NY", "12207"], ["Rochester", "NY", "14604"], ["Detroit", "MI", "48226"], ["Grand Rapids", "MI", "49503"],
  ["Traverse City", "MI", "49684"], ["Chicago", "IL", "60607"], ["Peoria", "IL", "61602"], ["Milwaukee", "WI", "53202"], ["Green Bay", "WI", "54301"],
  ["Duluth", "MN", "55802"], ["Minneapolis", "MN", "55401"], ["Des Moines", "IA", "50309"], ["Omaha", "NE", "68102"], ["Kansas City", "MO", "64105"],
  ["St. Louis", "MO", "63102"], ["Louisville", "KY", "40202"], ["Lexington", "KY", "40507"], ["Nashville", "TN", "37203"], ["Memphis", "TN", "38103"],
  ["Knoxville", "TN", "37902"], ["Atlanta", "GA", "30303"], ["Savannah", "GA", "31401"], ["Charleston", "SC", "29401"], ["Wilmington", "NC", "28401"],
  ["Raleigh", "NC", "27601"], ["Norfolk", "VA", "23510"], ["Richmond", "VA", "23219"], ["Baltimore", "MD", "21202"], ["Annapolis", "MD", "21401"],
  ["Philadelphia", "PA", "19106"], ["Newark", "NJ", "07102"], ["Portland", "ME", "04101"], ["Boston", "MA", "02110"], ["New Bedford", "MA", "02740"],
  ["Providence", "RI", "02903"], ["Hartford", "CT", "06103"], ["Burlington", "VT", "05401"], ["Tampa", "FL", "33602"], ["Jacksonville", "FL", "32202"],
  ["Miami", "FL", "33131"], ["Pensacola", "FL", "32502"], ["Mobile", "AL", "36602"], ["Birmingham", "AL", "35203"], ["New Orleans", "LA", "70130"],
  ["Baton Rouge", "LA", "70801"], ["Houston", "TX", "77002"], ["Galveston", "TX", "77550"], ["Dallas", "TX", "75201"], ["San Antonio", "TX", "78205"],
  ["Corpus Christi", "TX", "78401"], ["Oklahoma City", "OK", "73102"], ["Tulsa", "OK", "74103"], ["Little Rock", "AR", "72201"], ["Wichita", "KS", "67202"],
  ["Denver", "CO", "80202"], ["Boise", "ID", "83702"], ["Salt Lake City", "UT", "84101"], ["Phoenix", "AZ", "85004"], ["Albuquerque", "NM", "87102"],
  ["Seattle", "WA", "98104"], ["Tacoma", "WA", "98402"], ["Portland", "OR", "97204"], ["Eugene", "OR", "97401"], ["Sacramento", "CA", "95814"],
  ["Fresno", "CA", "93721"], ["San Diego", "CA", "92101"], ["Long Beach", "CA", "90802"], ["Anchorage", "AK", "99501"], ["Fargo", "ND", "58102"],
  ["Sioux Falls", "SD", "57104"], ["Billings", "MT", "59101"], ["Cheyenne", "WY", "82001"], ["Reno", "NV", "89501"], ["Indianapolis", "IN", "46204"],
  ["Fort Wayne", "IN", "46802"], ["Evansville", "IN", "47708"], ["Charleston", "WV", "25301"], ["Wheeling", "WV", "26003"], ["Harrisburg", "PA", "17101"],
];
const NAME_A = ["Harbor", "Tri-County", "Blue Ridge", "Great Lakes", "Prairie", "Coastal", "Summit", "Riverbend", "Keystone", "Evergreen", "Northstar", "Heartland", "Bayside", "Pioneer", "Frontier", "Red Barn", "Anchor Point", "Lighthouse", "Cedar Creek", "Iron Horse", "Twin Rivers", "Golden Valley", "Stillwater", "Eagle", "Lone Star", "Ozark", "Cascade", "Appalachian", "Gulf Coast", "Chesapeake", "Mountain View", "Sandhill", "Timberline", "Big Sky", "Sunrise", "Old Mill", "Crossroads", "Midland", "Liberty", "Patriot", "Maple Leaf", "Silver Lake", "Clearwater", "Rocky Point", "Tidewater", "Hometown", "County Line", "Valley", "Sycamore", "Ridgeway"];
const NAME_B = ["Marine", "Farm & Garden", "Hardware", "Supply", "Outfitters", "Rigging", "Feed & Seed", "Boat Works", "Landscape Supply", "Nursery", "Ag Supply", "Equipment", "Industrial", "Fishing Supply", "Hay & Grain", "Home Center", "Lumber", "Tackle", "Tractor Supply", "Arborist Supply", "Dock & Lift", "Packaging", "Moving Supply", "Event Rentals", "Playground", "Theatrical Supply", "Fence & Gate", "Co-op", "Mercantile", "Building Supply"];
const NAME_C = ["Co.", "Inc.", "LLC", "Supply", "Distributors", "& Sons", "Group", "Company", "Wholesale", ""];
const TERMS = weighted(["Net 30", "Net 45", "Net 60", "2% 10 Net 30", "COD", "Prepaid"], [60, 12, 6, 14, 4, 4]);
const CARRIERS = ["FedEx Freight", "R+L Carriers", "Estes", "UPS Ground", "Old Dominion", "XPO", "Saia", "Customer Pickup", "Our Truck"];
const SHIP_VIA = weighted(CARRIERS, [18, 14, 12, 16, 8, 6, 5, 14, 7]);
const REPS = ["SH", "SK", "SG", "JB"];
const CANCEL_REASONS = ["Customer request", "Duplicate order", "Customer found stock elsewhere", "Pricing dispute", "Entered in error", "Project cancelled"];
const RETURN_REASONS = ["Overstock", "Wrong item shipped", "Damaged in transit", "Customer ordered wrong size", "Defective", "Not as described"];
const NOTE_TEXT = ["Prefers deliveries before noon.", "Call ahead - limited dock space.", "Send invoices to AP email only.", "Seasonal buyer - heavy in spring.", "Asked about volume pricing on poly rope.", "Liftgate required.", "Use their PO on every carton label.", "Credit hold lifted after payment.", "New buyer as of this quarter.", "Wants MSDS sheets with nylon orders."];

// ---------------------------------------------------------------- items
// Rope & twine distributor catalog: fibre ropes by diameter and coil length,
// twines by spool, bungee/paracord, and rigging hardware.
const VENDORS = [
  { name: "Gulf Coast Cordage", city: 51, cats: ["MR", "SS"] },
  { name: "Pacific Fiber Imports", city: 69, cats: ["MR", "JT", "SI"] },
  { name: "Midwest Twine Co.", city: 14, cats: ["PT", "SI", "CT", "JT", "ML"] },
  { name: "Atlas Rigging Hardware", city: 11, cats: ["SH", "SK", "TH", "TB", "RC", "EB"] },
  { name: "Carolina Polymers", city: 30, cats: ["PP", "PT", "HB", "PD"] },
  { name: "Northeast Nylon Mills", city: 39, cats: ["NB", "NT"] },
  { name: "Keystone Braiding Works", city: 35, cats: ["PE", "NB", "DL", "DB"] },
  { name: "Harbor Marine Wholesale", city: 45, cats: ["DL", "AL", "TH"] },
  { name: "Great Lakes Wire Rope", city: 8, cats: ["WR", "RC", "TB", "CH"] },
  { name: "Ozark Bungee & Strap", city: 58, cats: ["BC", "PC", "TT"] },
  { name: "Dixie Cotton Products", city: 25, cats: ["CT", "SS"] },
  { name: "Pinnacle Outdoor Cord", city: 60, cats: ["PC", "BC"] },
  { name: "Tidewater Anchor Supply", city: 31, cats: ["AL", "DL", "SK"] },
  { name: "Heartland Fastener", city: 19, cats: ["EB", "SH", "RC"] },
  { name: "Sunbelt Packaging Twine", city: 52, cats: ["PT", "CT"] },
  { name: "Cascade Arborist Gear", city: 65, cats: ["PE", "NB", "AB"] },
  { name: "Liberty Import Group", city: 36, cats: ["JT", "SI", "MR"] },
  { name: "Coastal Tarp & Tie", city: 44, cats: ["TT", "BC", "RS", "CB"] },
  { name: "Summit Rigging Supply", city: 60, cats: ["WR", "SK", "TB", "TH", "CH", "RS"] },
  { name: "Prairie Baler Twine", city: 18, cats: ["SI", "PT"] },
];
const CATS = {
  MR: { desc: "Manila rope, 3-strand", sizes: ["1/4 in", "3/8 in", "1/2 in", "5/8 in", "3/4 in", "1 in"], lengths: ["300 ft coil", "600 ft coil", "1200 ft coil"], um: "CL", base: 45, lb: 12, origin: "Philippines" },
  NT: { desc: "Nylon rope, twisted", sizes: ["1/4 in", "3/8 in", "1/2 in", "5/8 in", "3/4 in"], lengths: ["300 ft coil", "600 ft coil"], um: "CL", base: 70, lb: 9, origin: "USA" },
  NB: { desc: "Nylon rope, solid braid", sizes: ["#5 5/32 in", "#6 3/16 in", "#8 1/4 in", "#10 5/16 in", "#12 3/8 in"], lengths: ["500 ft spool", "1000 ft spool"], um: "SPL", base: 38, lb: 6, origin: "USA" },
  PP: { desc: "Polypropylene rope, 3-strand", sizes: ["1/4 in", "3/8 in", "1/2 in", "5/8 in", "3/4 in", "1 in"], lengths: ["300 ft coil", "600 ft coil", "1200 ft coil"], um: "CL", base: 32, lb: 7, origin: "Mexico" },
  PE: { desc: "Polyester double braid", sizes: ["3/8 in", "7/16 in", "1/2 in", "5/8 in", "3/4 in"], lengths: ["300 ft reel", "600 ft reel", "1200 ft reel"], um: "RL", base: 120, lb: 10, origin: "USA" },
  SI: { desc: "Sisal twine", sizes: ["9000 ft/bale", "7200 ft/bale", "4 ply", "5 ply"], lengths: ["2 ball bale", "40 lb box"], um: "BL", base: 28, lb: 40, origin: "Brazil" },
  JT: { desc: "Jute twine", sizes: ["3 ply", "5 ply", "10 ply"], lengths: ["1 lb tube", "5 lb cone", "10 lb spool"], um: "EA", base: 5, lb: 1, origin: "Bangladesh" },
  CT: { desc: "Cotton twine", sizes: ["#12", "#24", "#36", "#48"], lengths: ["1 lb tube", "2.5 lb cone"], um: "EA", base: 6, lb: 0.8, origin: "USA" },
  PT: { desc: "Polypropylene tying twine", sizes: ["210 lb test", "350 lb test", "9000 ft baler", "20000 ft baler"], lengths: ["10 lb tube", "2 tube bale"], um: "BL", base: 24, lb: 20, origin: "Mexico" },
  WR: { desc: "Galvanized wire rope, 7x19", sizes: ["1/8 in", "3/16 in", "1/4 in", "5/16 in", "3/8 in"], lengths: ["250 ft reel", "500 ft reel", "1000 ft reel"], um: "RL", base: 95, lb: 30, origin: "Korea" },
  BC: { desc: "Bungee cord", sizes: ["1/4 in", "5/16 in", "3/8 in"], lengths: ["24 in hooked 10pk", "100 ft spool", "300 ft spool"], um: "EA", base: 8, lb: 1, origin: "China" },
  PC: { desc: "Paracord 550, 7-strand", sizes: ["black", "olive drab", "coyote", "safety orange", "navy"], lengths: ["100 ft hank", "1000 ft spool"], um: "EA", base: 7, lb: 0.6, origin: "USA" },
  TT: { desc: "Tarp ties, rubber", sizes: ["9 in", "15 in", "21 in", "31 in"], lengths: ["bag of 10", "box of 50"], um: "BX", base: 6, lb: 1.2, origin: "USA" },
  DL: { desc: "Double braid dock line, eye spliced", sizes: ["3/8 in", "1/2 in", "5/8 in"], lengths: ["15 ft", "20 ft", "25 ft"], um: "EA", base: 18, lb: 1.5, origin: "USA" },
  AL: { desc: "Nylon anchor line with thimble", sizes: ["3/8 in", "1/2 in", "5/8 in"], lengths: ["100 ft", "150 ft", "200 ft"], um: "EA", base: 42, lb: 5, origin: "USA" },
  SS: { desc: "Cotton sash cord", sizes: ["#6", "#8", "#10", "#12"], lengths: ["100 ft hank", "1000 ft spool"], um: "EA", base: 10, lb: 1.5, origin: "USA" },
  SH: { desc: "Snap hook, galvanized", sizes: ["2 in", "2-1/2 in", "3 in", "4 in"], lengths: ["box of 10", "box of 50"], um: "BX", base: 1.5, lb: 0.2, origin: "China" },
  SK: { desc: "Screw pin anchor shackle", sizes: ["1/4 in", "5/16 in", "3/8 in", "1/2 in", "5/8 in"], lengths: ["each", "box of 10"], um: "EA", base: 2.5, lb: 0.3, origin: "China" },
  TH: { desc: "Rope thimble, galvanized", sizes: ["1/4 in", "3/8 in", "1/2 in", "5/8 in"], lengths: ["box of 25", "box of 100"], um: "BX", base: 1.2, lb: 0.15, origin: "China" },
  TB: { desc: "Turnbuckle, hook & eye", sizes: ["1/4 x 4 in", "5/16 x 4-1/2 in", "3/8 x 6 in", "1/2 x 9 in"], lengths: ["each", "box of 10"], um: "EA", base: 3, lb: 0.4, origin: "Taiwan" },
  RC: { desc: "Wire rope clip, malleable", sizes: ["1/8 in", "3/16 in", "1/4 in", "3/8 in"], lengths: ["box of 10", "box of 100"], um: "BX", base: 0.9, lb: 0.1, origin: "China" },
  HB: { desc: "Hollow braid polypropylene rope", sizes: ["1/4 in", "5/16 in", "3/8 in", "1/2 in"], lengths: ["500 ft spool", "1000 ft spool"], um: "SPL", base: 26, lb: 4, origin: "USA" },
  DB: { desc: "Diamond braid polyester cord", sizes: ["#4 1/8 in", "#5 5/32 in", "#6 3/16 in", "#8 1/4 in", "#10 5/16 in"], lengths: ["500 ft spool", "1000 ft spool"], um: "SPL", base: 34, lb: 4, origin: "USA" },
  ML: { desc: "Mason line, nylon", sizes: ["#15 fluorescent pink", "#15 orange", "#18 fluorescent pink", "#18 yellow", "#18 white"], lengths: ["250 ft twisted", "1000 ft braided"], um: "EA", base: 6, lb: 0.5, origin: "USA" },
  AB: { desc: "Arborist bull rope, double braid", sizes: ["5/8 in", "3/4 in", "7/8 in", "1 in"], lengths: ["150 ft", "200 ft", "300 ft"], um: "EA", base: 160, lb: 18, origin: "USA" },
  RS: { desc: "Ratchet strap with J-hooks", sizes: ["1 in", "1-1/2 in", "2 in", "3 in", "4 in"], lengths: ["15 ft", "27 ft", "30 ft"], um: "EA", base: 7, lb: 1.2, origin: "China" },
  CB: { desc: "Cam buckle tie-down strap", sizes: ["1 in", "1-1/2 in", "2 in"], lengths: ["6 ft 4pk", "12 ft 4pk", "20 ft"], um: "EA", base: 5, lb: 0.8, origin: "China" },
  CH: { desc: "Grade 30 proof coil chain", sizes: ["3/16 in", "1/4 in", "5/16 in", "3/8 in", "1/2 in"], lengths: ["20 ft pail", "100 ft drum"], um: "EA", base: 40, lb: 25, origin: "China" },
  PD: { desc: "Poly-Dacron rope, 3-strand", sizes: ["1/4 in", "3/8 in", "1/2 in", "5/8 in", "3/4 in"], lengths: ["600 ft coil", "1200 ft coil"], um: "CL", base: 55, lb: 9, origin: "USA" },
  EB: { desc: "Eye bolt, forged", sizes: ["1/4 x 4 in", "5/16 x 4-1/4 in", "3/8 x 5 in", "1/2 x 6 in"], lengths: ["each", "box of 10"], um: "EA", base: 1.8, lb: 0.25, origin: "China" },
};

function buildItems(vendorIds) {
  const variants = [];
  for (const [code, c] of Object.entries(CATS)) {
    c.sizes.forEach((size, si) => {
      c.lengths.forEach((len, li) => variants.push({ code, c, size, len, si, li }));
    });
  }
  if (variants.length < N_SKUS) throw new Error(`The catalog template only has ${variants.length} distinct items; --skus can be at most that.`);
  const chosen = rng.shuffle(variants).slice(0, N_SKUS);
  // Sort so item numbers read in catalog order within a category.
  chosen.sort((a, b) => a.code.localeCompare(b.code) || a.si - b.si || a.li - b.li);
  const vendorsFor = (code) => VENDORS.map((v, i) => ({ v, i })).filter((x) => x.v.cats.includes(code));
  const seq = {};
  return chosen.map((v, idx) => {
    seq[v.code] = (seq[v.code] ?? 1000) + rng.int(1, 9);
    const sizeFactor = 1 + v.si * 0.55;
    const lenFactor = 1 + v.li * 0.9;
    const rate = +(v.c.base * sizeFactor * lenFactor * rng.float(0.85, 1.15)).toFixed(2);
    const weight = +(v.c.lb * sizeFactor * lenFactor * rng.float(0.85, 1.15)).toFixed(2);
    const vend = rng.pick(vendorsFor(v.code));
    return {
      id: randomUUID(),
      itemNumber: `${v.code}-${seq[v.code]}`,
      description: `${v.c.desc} ${v.size}, ${v.len}`,
      um: v.c.um,
      rate,
      weight,
      countryOfOrigin: v.c.origin,
      reorderPoint: 0, // set once demand is known
      preferredVendorId: vendorIds[vend.i],
      vendorIndex: vend.i,
      // Popularity: a long tail, with small, cheap sizes selling most.
      popularity: Math.pow(rng.next(), 2.2) * 10 + (v.si <= 1 ? 2 : 0.5) + (idx % 17 === 0 ? 8 : 0),
    };
  });
}

// ---------------------------------------------------------------- customers
function address(name, cityIdx) {
  const [city, state, zip] = CITIES[cityIdx ?? rng.int(0, CITIES.length - 1)];
  return { name, addressLine1: `${rng.int(10, 9899)} ${rng.pick(STREETS)}`, addressLine2: rng.chance(0.15) ? `Suite ${rng.int(100, 450)}` : "", city, state, zip, notes: "" };
}

function buildCustomers(items) {
  const names = new Set();
  const customers = [];
  for (let i = 0; i < N_CUSTOMERS; i++) {
    let name;
    for (let tries = 0; ; tries++) {
      const base = `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
      const suffix = rng.pick(NAME_C);
      name = suffix ? `${base} ${suffix}` : base;
      if (tries > 5) name = `${name} - ${rng.pick(CITIES)[0]}`;
      if (!names.has(name)) break;
    }
    names.add(name);
    const top = i < Math.round(N_CUSTOMERS * 0.1);
    const mid = !top && i < Math.round(N_CUSTOMERS * 0.35);
    const cityIdx = rng.int(0, CITIES.length - 1);
    const billTo = address(name, cityIdx);
    const nLocations = top ? rng.int(2, 6) : rng.chance(0.3) ? rng.int(2, 3) : 1;
    const locations = [];
    for (let l = 0; l < nLocations; l++) {
      const label = l === 0 ? "Main" : top ? `DC ${l}` : `Store ${l + 1}`;
      locations.push({ id: randomUUID(), label, address: l === 0 ? { ...billTo } : address(name, rng.int(0, CITIES.length - 1)) });
    }
    // Each customer buys from its own slice of the catalog.
    const favourites = rng.shuffle(items).slice(0, top ? rng.int(40, 90) : mid ? rng.int(15, 40) : rng.int(4, 15));
    const overrides = [];
    const partMap = [];
    const abbrev = name.replace(/[^A-Z]/g, "").slice(0, 3) || "CUS";
    if (top || (mid && rng.chance(0.4))) {
      for (const it of favourites.slice(0, top ? rng.int(15, 60) : rng.int(2, 10))) {
        const customerPartNumber = top && rng.chance(0.5) ? `${abbrev}-${rng.int(10000, 99999)}` : "";
        overrides.push({ id: randomUUID(), itemNumber: it.itemNumber, customerPartNumber, description: it.description, price: +(it.rate * rng.float(0.8, 0.96)).toFixed(2), weight: it.weight });
        if (customerPartNumber) partMap.push({ id: randomUUID(), itemNumber: it.itemNumber, customerPartNumber });
      }
    }
    const routingGuide = (top && rng.chance(0.6)) || rng.chance(0.08)
      ? {
          preferredCarrier: rng.pick(CARRIERS.slice(0, 7)),
          routingAccountNumber: rng.chance(0.6) ? `${rng.int(100000, 999999)}` : "",
          appointmentRequired: rng.chance(0.4),
          labelingRequirements: rng.chance(0.5) ? rng.pick(["PO # on every carton", "Pallet label with store number", "No mixed-SKU cartons", "Label each coil with item #"]) : "",
          notes: rng.chance(0.3) ? rng.pick(["Receiving hours 7am-2pm", "Floor-loaded trailers refused", "Max pallet height 60 in"]) : "",
        }
      : null;
    customers.push({
      id: randomUUID(),
      name,
      accountNumber: `C-${10001 + i}`,
      billTo,
      terms: TERMS(),
      shipVia: routingGuide?.preferredCarrier ?? SHIP_VIA(),
      fob: rng.chance(0.8) ? "Origin" : "Destination",
      rep: rng.pick(REPS),
      shipCompleteOnly: rng.chance(top ? 0.3 : 0.15),
      privateLabelName: top && rng.chance(0.15) ? `${name.split(" ")[0]} Pro Line` : null,
      routingGuide,
      taxRate: rng.chance(0.85) ? 0 : +rng.pick([6, 6.25, 7, 7.5, 8.25]).toFixed(3),
      tier: top ? "top" : mid ? "mid" : "tail",
      locations,
      favourites,
      overrides,
      partMap,
      notes: rng.chance(top ? 0.7 : 0.15) ? Array.from({ length: rng.int(1, 3) }, () => rng.pick(NOTE_TEXT)) : [],
      poPrefix: rng.chance(0.5) ? `${abbrev}-` : rng.chance(0.5) ? "PO " : "",
    });
  }
  return customers;
}

// ---------------------------------------------------------------- orders
// Order size mix from the operation: 10% big (20-40 lines, hundreds per
// line), 40% mid (8-14 lines), the rest small - some 1-2 lines of 3-4 units.
function orderShape() {
  const r = rng.next();
  if (r < 0.1) return { lines: rng.int(20, 40), qty: () => rng.int(100, 500) };
  if (r < 0.5) return { lines: rng.int(8, 14), qty: () => rng.int(10, 150) };
  if (rng.chance(0.35)) return { lines: rng.int(1, 2), qty: () => rng.int(3, 4) };
  return { lines: rng.int(3, 7), qty: () => rng.int(5, 60) };
}

// Where an order sits today, by how many business days ago it came in.
function statusFor(age) {
  const r = rng.next();
  if (age === 0) return r < 0.5 ? "ENTERED" : r < 0.66 ? "CHECKED" : r < 0.8 ? "ALLOCATED" : r < 0.84 ? "BACKORDERED" : r < 0.95 ? "PICK_PACKED" : r < 0.995 ? "SHIPPED" : "CANCELLED";
  if (age === 1) return r < 0.06 ? "ENTERED" : r < 0.12 ? "CHECKED" : r < 0.22 ? "ALLOCATED" : r < 0.27 ? "BACKORDERED" : r < 0.4 ? "PICK_PACKED" : r < 0.995 ? "SHIPPED" : "CANCELLED";
  if (age === 2) return r < 0.01 ? "ENTERED" : r < 0.03 ? "CHECKED" : r < 0.06 ? "ALLOCATED" : r < 0.1 ? "BACKORDERED" : r < 0.15 ? "PICK_PACKED" : r < 0.993 ? "SHIPPED" : "CANCELLED";
  if (age <= 5) return r < 0.02 ? "BACKORDERED" : r < 0.035 ? "PICK_PACKED" : r < 0.99 ? "SHIPPED" : "CANCELLED";
  if (age <= 15) return r < 0.012 ? "BACKORDERED" : r < 0.99 ? "SHIPPED" : "CANCELLED";
  return r < 0.0008 ? "BACKORDERED" : r < 0.0158 ? "CANCELLED" : "SHIPPED";
}

async function main() {
  const t0 = Date.now();
  // ---------------------------------------------------- safety
  const existing = {
    customers: await prisma.customer.count(),
    items: await prisma.item.count(),
    orders: await prisma.salesOrder.count(),
  };
  if (!RESET && (existing.customers || existing.items || existing.orders)) {
    console.error(`This database already has ${existing.customers} customers, ${existing.items} items and ${existing.orders} orders.`);
    console.error("Run again with --reset to delete business data first (accounts and settings are kept).");
    process.exit(1);
  }
  const accounts = await prisma.account.findMany({ where: { active: true } });
  const perm = (a, key) => a.role === "ADMIN" || (a.permissions && a.permissions[key] === "edit");
  const admin = accounts.find((a) => a.role === "ADMIN") ?? accounts[0];
  if (!admin) throw new Error("No accounts found - run `npm run seed` first to create the admin account.");
  const nonAdmin = accounts.filter((a) => a.role !== "ADMIN");
  const pool = (key) => {
    const found = nonAdmin.filter((a) => perm(a, key));
    return found.length ? found : [admin];
  };
  const writers = pool("order-entry");
  const checkers = pool("validation");
  const cancellers = pool("order-detail");

  if (RESET) {
    console.log("Deleting existing business data (accounts and settings are kept)...");
    await prisma.$transaction([
      prisma.stockMovement.deleteMany(),
      prisma.returnLine.deleteMany(),
      prisma.returnAuthorization.deleteMany(),
      prisma.shipmentRecord.deleteMany(),
      prisma.salesOrderLine.deleteMany(),
      prisma.salesOrder.deleteMany(),
      prisma.vendorReceivingRecord.deleteMany(),
      prisma.vendorPoLine.deleteMany(),
      prisma.vendorPurchaseOrder.deleteMany(),
      prisma.customerNote.deleteMany(),
      prisma.customerPartMapping.deleteMany(),
      prisma.customerPriceOverride.deleteMany(),
      prisma.shippingLocation.deleteMany(),
      prisma.customer.deleteMany(),
      prisma.itemComponent.deleteMany(),
      prisma.itemLink.deleteMany(),
      prisma.item.deleteMany(),
      prisma.vendor.deleteMany(),
      prisma.auditLog.deleteMany({ where: { NOT: { targetType: "account" } } }),
    ]);
  }

  // ---------------------------------------------------- master data
  const vendorRows = VENDORS.map((v) => ({
    id: randomUUID(),
    name: v.name,
    contactName: `${rng.pick(["Dana", "Chris", "Pat", "Jordan", "Sam", "Alex", "Robin", "Terry", "Morgan", "Casey"])} ${rng.pick(["Miller", "Nguyen", "Garcia", "Patel", "Johnson", "Okafor", "Schmidt", "Rossi", "Kim", "Walsh"])}`,
    phone: `(${rng.int(201, 989)}) ${rng.int(200, 999)}-${rng.int(1000, 9999)}`,
    email: `orders@${v.name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
    address: address(v.name, v.city),
  }));
  const items = buildItems(vendorRows.map((v) => v.id));
  const customers = buildCustomers(items);

  // Customer weights: top 10% of customers place ~80% of orders.
  const topC = customers.filter((c) => c.tier === "top");
  const restC = customers.filter((c) => c.tier !== "top");
  const pickTop = weighted(topC, topC.map((_, i) => 1 / (1 + i * 0.03)));
  const pickRest = weighted(restC, restC.map((c) => (c.tier === "mid" ? 3 : 1)));
  const pickCustomer = () => (rng.chance(0.8) ? pickTop() : pickRest());
  const pickPopular = weighted(items, items.map((i) => i.popularity));
  const lightItems = items.filter((i) => i.weight <= 1.5);
  const pickLight = weighted(lightItems, lightItems.map((i) => i.popularity));

  // ---------------------------------------------------- orders
  // Spread orders over the business days (today gets a partial day).
  const perDay = DAYS.map((d, i) => (i === DAYS.length - 1 ? 0.55 : 1) * rng.float(0.8, 1.2));
  const scale = N_ORDERS / perDay.reduce((a, b) => a + b, 0);
  const counts = perDay.map((w) => Math.round(w * scale));
  let diff = N_ORDERS - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % counts.length) {
    const s = Math.sign(diff);
    if (counts[i] + s > 0) {
      counts[i] += s;
      diff -= s;
    }
  }

  const orders = [];
  const lines = [];
  const shipments = [];
  const events = []; // stock events: { itemId, at, delta, reason, refType, refId, actor }
  // Items kept deliberately short so back orders are real (no free stock).
  const shortItems = new Set(rng.shuffle(items.filter((i) => i.popularity > 3)).slice(0, Math.max(5, Math.round(N_SKUS * 0.08))).map((i) => i.id));
  const shortList = items.filter((i) => shortItems.has(i.id));
  const reserved = new Map(); // itemId -> allocated + staged on open orders
  const addReserved = (itemId, q) => reserved.set(itemId, (reserved.get(itemId) ?? 0) + q);
  let soNumber = 10000;

  const stamp = (a) => ({ by: a.initials, id: a.id, color: a.color });
  const shipHour = () => rng.float(13, 18.5);

  DAYS.forEach((day, d) => {
    const age = DAYS.length - 1 - d;
    for (let k = 0; k < counts[d]; k++) {
      soNumber++;
      const c = pickCustomer();
      const status = statusFor(age);
      const shape = orderShape();
      const nLines = Math.min(shape.lines, items.length);
      const chosen = new Map();
      while (chosen.size < nLines) {
        // Big orders are mostly many small items (hardware, twine, cord).
        const it = shape.lines >= 20 && rng.chance(0.75) ? pickLight() : rng.chance(0.75) && c.favourites.length ? rng.pick(c.favourites) : pickPopular();
        chosen.set(it.id, it);
      }
      let chosenList = [...chosen.values()];
      // A back order has to include at least one item that's really short.
      if (status === "BACKORDERED" && !chosenList.some((i) => shortItems.has(i.id))) {
        const s = rng.pick(shortList);
        if (!chosen.has(s.id)) chosenList[chosenList.length - 1] = s;
      }
      chosenList = [...new Map(chosenList.map((i) => [i.id, i])).values()];
      const enteredAt = atTime(day, rng.float(7, 16.5));
      const writer = rng.pick(writers);
      const loc = rng.pick(c.locations);
      const dueDay = addBusinessDays(day, rng.chance(0.85) ? 5 : rng.int(2, 10));
      const orderLines = chosenList.map((it) => {
        const ov = c.overrides.find((o) => o.itemNumber === it.itemNumber);
        return {
          id: randomUUID(),
          soNumber,
          itemId: it.id,
          item: it.itemNumber,
          description: it.description,
          um: it.um,
          // Hundreds per line for hardware and twine; a handful of coils or
          // reels of heavy or expensive rope.
          ordered: (() => {
            const base = shape.qty();
            if (shape.lines <= 2) return base; // the 1-2 line orders of 3-4 units
            const scale = (it.weight <= 1.5 ? 1 : it.weight <= 8 ? 0.2 : 0.04) * (it.rate > 150 ? 0.5 : 1);
            return Math.max(1, Math.round(base * scale));
          })(),
          rate: ov ? ov.price : it.rate,
          customerPartNumber: ov?.customerPartNumber || null,
          _item: it,
        };
      });

      const o = {
        soNumber,
        poNumber: `${c.poPrefix}${rng.int(100000, 999999)}`,
        orderDate: dbDate(day),
        dueDate: dbDate(dueDay),
        customerId: c.id,
        shipToLocationId: loc.id,
        billTo: c.billTo,
        shipTo: loc.address,
        fob: c.fob,
        shipVia: c.shipVia,
        terms: c.terms,
        rep: c.rep,
        taxRate: c.taxRate,
        notes: rng.chance(0.06) ? rng.pick(["Rush - customer event this weekend", "Ship with order from last week if possible", "Call on arrival", "Deliver to back dock", "Partial OK"]) : "",
        status,
        writtenBy: stamp(writer).by,
        writtenById: writer.id,
        writtenByColor: writer.color,
        createdAt: enteredAt,
        version: 1,
        allocation: null,
        pendingShipment: [],
        estimatedShipDate: rng.chance(0.4) ? dbDate(dueDay) : null,
      };
      const checkedAt = new Date(enteredAt.getTime() + rng.int(20, 300) * 60000);
      const checker = rng.pick(checkers);
      const check = () => {
        o.checkedAt = checkedAt > NOW ? new Date(NOW.getTime() - 60000) : checkedAt;
        o.checkedBy = checker.initials;
        o.checkedByColor = checker.color;
      };
      const decidedAt = () => new Date(Math.min(checkedAt.getTime() + rng.int(5, 90) * 60000, NOW.getTime() - 60000)).toISOString();
      const zeroAlloc = (full) => ({ lines: orderLines.map((l) => ({ lineItemId: l.id, allocatedQty: 0 })), fullyAllocated: full, shipCompleteOnly: c.shipCompleteOnly, decidedAt: decidedAt() });

      // A shipment of `qtyFor(line)` at `at`.
      const ship = (at, qtyFor) => {
        if (at < enteredAt) at = new Date(Math.min(enteredAt.getTime() + 90 * 60000, NOW.getTime() - 2 * 60000));
        const shipLines = orderLines.map((l) => ({ lineItemId: l.id, qty: qtyFor(l) })).filter((l) => l.qty > 0);
        if (!shipLines.length) return;
        shipments.push({ id: randomUUID(), soNumber, shippedAt: at, lines: shipLines });
        for (const sl of shipLines) {
          const l = orderLines.find((x) => x.id === sl.lineItemId);
          l._shipped = (l._shipped ?? 0) + sl.qty;
          events.push({ itemId: l.itemId, itemNumber: l.item, at, delta: -sl.qty, reason: "SHIP", refType: "sales-order", refId: String(soNumber), actor: "log" });
        }
      };
      const remaining = (l) => l.ordered - (l._shipped ?? 0);
      const shortLine = (l) => shortItems.has(l.itemId);

      if (status === "ENTERED") {
        // nothing more
      } else if (status === "CHECKED") {
        check();
      } else if (status === "CANCELLED") {
        check();
        // Some cancels happen after part of the order shipped.
        let cancelLag = Math.min(age, rng.int(0, 4));
        if (age > 3 && rng.chance(0.3)) {
          const shipLag = rng.int(1, 3);
          ship(atTime(addBusinessDays(day, shipLag), shipHour()), (l) => (rng.chance(0.6) ? l.ordered : 0));
          cancelLag = Math.min(age, shipLag + rng.int(1, 3));
        }
        const cancelDay = addBusinessDays(day, cancelLag);
        o.cancelledAt = atTime(cancelDay, rng.float(9, 17));
        o.cancelledBy = rng.pick(cancellers).username;
        o.cancelReason = rng.pick(CANCEL_REASONS);
        o.allocation = null;
      } else {
        check();
        // Did an earlier partial shipment happen? (ships before today only)
        const partialFirst = age >= 2 && (status === "BACKORDERED" ? rng.chance(0.45) : status === "SHIPPED" ? rng.chance(0.06) : rng.chance(0.25));
        let partialLag = 0;
        if (partialFirst) {
          partialLag = rng.int(1, Math.min(age - 1, 3));
          // At least one line (a short item if there is one) ships short.
          const forced = orderLines.find(shortLine) ?? rng.pick(orderLines);
          ship(atTime(addBusinessDays(day, partialLag), shipHour()), (l) => (l === forced || shortLine(l) || rng.chance(0.15) ? Math.floor(l.ordered * rng.float(0, 0.6)) : l.ordered));
        }
        if (status === "SHIPPED") {
          // Most orders ship the next business day, some two or three days out.
          const lag = age === 0 ? 0 : Math.min(age, Math.max(partialLag + 1, rng.chance(0.6) ? 1 : rng.chance(0.6) ? 2 : 3));
          const finalDay = addBusinessDays(day, lag);
          const at = atTime(finalDay, shipHour());
          ship(at, (l) => remaining(l));
          const packedAt = new Date(at.getTime() - rng.int(60, 360) * 60000);
          o.allocation = zeroAlloc(true);
          o.pickedAt = packedAt;
          o.pickListPrintedAt = new Date(packedAt.getTime() + rng.int(5, 40) * 60000);
          o.packingSlipPrintedAt = o.pickListPrintedAt;
          o.pickPackStatus = "COMPLETE";
          if (o.pickListPrintedAt > at) o.pickListPrintedAt = o.packingSlipPrintedAt = packedAt;
          o.estimatedShipDate = o.estimatedShipDate ?? dbDate(finalDay);
        } else if (status === "ALLOCATED") {
          const partial = rng.chance(0.15);
          o.allocation = {
            lines: orderLines.map((l) => {
              const q = partial && shortLine(l) ? Math.floor(remaining(l) * rng.float(0.2, 0.7)) : remaining(l);
              addReserved(l.itemId, q);
              return { lineItemId: l.id, allocatedQty: q };
            }),
            fullyAllocated: !(partial && orderLines.some(shortLine)),
            shipCompleteOnly: c.shipCompleteOnly,
            decidedAt: decidedAt(),
          };
        } else if (status === "BACKORDERED") {
          o.allocation = zeroAlloc(false);
        } else if (status === "PICK_PACKED") {
          const pending = orderLines.map((l) => ({ lineItemId: l.id, qty: shortLine(l) ? Math.floor(remaining(l) * rng.float(0, 0.8)) : remaining(l) })).filter((p) => p.qty > 0);
          if (!pending.length) pending.push({ lineItemId: orderLines[0].id, qty: Math.max(1, remaining(orderLines[0])) });
          for (const p of pending) addReserved(orderLines.find((l) => l.id === p.lineItemId).itemId, p.qty);
          o.pendingShipment = pending;
          o.allocation = zeroAlloc(true);
          o.pickedAt = new Date(Math.min(checkedAt.getTime() + rng.int(60, 600) * 60000, NOW.getTime() - 30 * 60000));
          const complete = orderLines.every((l) => (pending.find((p) => p.lineItemId === l.id)?.qty ?? 0) >= remaining(l));
          o.pickPackStatus = complete ? "COMPLETE" : "PARTIAL";
          if (age > 0 || rng.chance(0.4)) {
            o.pickListPrintedAt = new Date(Math.min(o.pickedAt.getTime() + rng.int(5, 60) * 60000, NOW.getTime() - 60000));
            o.packingSlipPrintedAt = o.pickListPrintedAt;
          }
        }
      }
      o.version = 1 + ["ENTERED", "CHECKED", "ALLOCATED", "BACKORDERED", "PICK_PACKED", "SHIPPED", "CANCELLED"].indexOf(status);
      orders.push(o);
      for (const l of orderLines) lines.push(l);
    }
  });

  // ---------------------------------------------------- returns (~1% of shipped orders)
  const returns = [];
  const returnLines = [];
  const shippedOrders = orders.filter((o) => o.status === "SHIPPED");
  let raNumber = 3000;
  const linesBySo = new Map();
  for (const l of lines) (linesBySo.get(l.soNumber) ?? linesBySo.set(l.soNumber, []).get(l.soNumber)).push(l);
  for (const o of rng.shuffle(shippedOrders).slice(0, Math.round(shippedOrders.length * 0.01))) {
    const oLines = linesBySo.get(o.soNumber).filter((l) => (l._shipped ?? 0) > 0);
    const lastShip = shipments.filter((s) => s.soNumber === o.soNumber).map((s) => s.shippedAt).sort((a, b) => b - a)[0];
    const reqDay = addBusinessDays(localDay(lastShip), rng.int(2, 15));
    if (reqDay > TODAY) continue;
    raNumber++;
    const ra = `RA-${raNumber}`;
    const age = dayIndex.has(reqDay) ? DAYS.length - 1 - dayIndex.get(reqDay) : 0;
    const status = age < 3 ? (rng.chance(0.7) ? "ISSUED" : "RECEIVED") : age < 15 ? (rng.chance(0.25) ? "ISSUED" : rng.chance(0.5) ? "CLOSED" : "RECEIVED") : rng.chance(0.6) ? "CLOSED" : "RECEIVED";
    const c = customers.find((x) => x.id === o.customerId);
    const writer = rng.pick(cancellers);
    const createdAt = atTime(reqDay, rng.float(8, 16));
    const receivedAt = status === "ISSUED" ? null : atTime(addBusinessDays(reqDay, Math.min(age, rng.int(1, 5))), rng.float(8, 15));
    returns.push({ raNumber: ra, customerId: c.id, soNumber: String(o.soNumber), billTo: c.billTo, requestDate: dbDate(reqDay), reason: rng.pick(RETURN_REASONS), status, notes: "", writtenBy: writer.initials, writtenById: writer.id, writtenByColor: writer.color, createdAt, receivedAt, receivedBy: receivedAt ? rng.pick(pool("receiving")).username : null, version: status === "ISSUED" ? 1 : 2 });
    for (const l of rng.shuffle(oLines).slice(0, rng.int(1, Math.min(2, oLines.length)))) {
      const qty = Math.max(1, Math.floor(l._shipped * rng.float(0.05, 0.5)));
      const restock = !rng.chance(0.15);
      returnLines.push({ id: randomUUID(), raNumber: ra, itemId: l.itemId, itemNumber: l.item, description: l.description, um: l.um, qty, rate: l.rate, reason: "", restock });
      if (receivedAt && restock) events.push({ itemId: l.itemId, itemNumber: l.item, at: receivedAt, delta: qty, reason: "RETURN", refType: "return", refId: ra, actor: "rcv" });
    }
  }

  // ---------------------------------------------------- vendor POs (replenishment)
  // Daily demand per item comes from the shipments above. Each vendor gets a
  // PO about every two weeks: any of its items that has dropped below its
  // reorder level is topped back up to cover lead time plus the next two
  // weeks. The items kept short are ones the vendor hasn't been able to
  // supply for the last month. Recent POs are still open - some overdue,
  // some part received.
  const ND = DAYS.length;
  const TODAY_IDX = ND - 1;
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const series = () => new Map(items.map((i) => [i.id, new Float64Array(ND)]));
  const demand = series();
  const inflow = series();
  const arrivals = series();
  for (const s of shipments) {
    const di = dayIndex.get(localDay(s.shippedAt)) ?? TODAY_IDX;
    for (const sl of s.lines) demand.get(lineById.get(sl.lineItemId).itemId)[di] += sl.qty;
  }
  for (const e of events) if (e.reason === "RETURN") inflow.get(e.itemId)[dayIndex.get(localDay(e.at)) ?? TODAY_IDX] += e.delta;
  const total = (itemId) => demand.get(itemId).reduce((a, b) => a + b, 0);
  const avgDaily = (itemId) => total(itemId) / ND;
  const trailingAvg = (itemId, d) => {
    const a = demand.get(itemId);
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, d - 20); i < d; i++) {
      sum += a[i];
      n++;
    }
    return n >= 5 ? sum / n : avgDaily(itemId);
  };
  const WINDOW = 10;
  const packOf = (it) => (it.rate > 60 ? 5 : it.rate > 15 ? 10 : 50);
  const opening0 = new Map(items.map((i) => [i.id, Math.round(avgDaily(i.id) * 15) + rng.int(10, 60)]));
  const simOnHand = new Map(opening0);
  const onOrder = new Map(items.map((i) => [i.id, 0]));
  const poDays = VENDORS.map(() => {
    const set = new Set();
    for (let d = rng.int(0, 4); d < ND; d += WINDOW + rng.int(-2, 2)) set.add(d);
    return set;
  });
  const shortCutoff = ND - 22;
  const pos = [];
  const poLines = [];
  const receipts = [];
  let poNumber = 5000;
  for (let d = 0; d < ND; d++) {
    for (const it of items) {
      const arrived = arrivals.get(it.id)[d];
      onOrder.set(it.id, onOrder.get(it.id) - arrived);
      simOnHand.set(it.id, simOnHand.get(it.id) + arrived - demand.get(it.id)[d] + inflow.get(it.id)[d]);
    }
    VENDORS.forEach((v, vi) => {
      if (!poDays[vi].has(d)) return;
      const lead = rng.int(4, 8);
      const want = [];
      for (const it of items) {
        if (it.vendorIndex !== vi || (shortItems.has(it.id) && d >= shortCutoff)) continue;
        const avg = trailingAvg(it.id, d);
        if (avg <= 0) continue;
        const target = avg * (lead + WINDOW) * 1.15 + avg * 3;
        const position = simOnHand.get(it.id) + onOrder.get(it.id);
        if (position >= target * 0.75) continue;
        const pk = packOf(it);
        want.push({ it, qty: Math.max(pk, Math.ceil((target - position) / pk) * pk) });
      }
      if (!want.length) return;
      poNumber++;
      const po = `PO-${poNumber}`;
      const orderDay = DAYS[d];
      const expectedDay = addBusinessDays(orderDay, lead);
      const expectedIdx = d + lead;
      const receiptIdx = expectedIdx + (rng.chance(0.8) ? 0 : rng.int(1, 4));
      const rows = want.map(({ it, qty }) => ({ id: randomUUID(), poNumber: po, itemId: it.id, itemNumber: it.itemNumber, description: it.description, orderedQty: qty, receivedQty: 0, cost: +(it.rate * rng.float(0.45, 0.6)).toFixed(2) }));
      for (const r of rows) onOrder.set(r.itemId, onOrder.get(r.itemId) + r.orderedQty);
      let status = "OPEN";
      const recs = [];
      const receive = (idx, qtyFor) => {
        const recLines = rows.map((r) => {
          const q = qtyFor(r);
          r.receivedQty += q;
          arrivals.get(r.itemId)[idx] += q;
          return { lineId: r.id, qty: q };
        }).filter((x) => x.qty > 0);
        if (recLines.length) recs.push({ id: randomUUID(), poNumber: po, receivedAt: atTime(DAYS[idx], rng.float(7.5, 12)), lines: recLines });
      };
      // POs due in the last week or so: some vendors are late, some shipped part.
      const recent = expectedIdx >= TODAY_IDX - 6 && expectedIdx <= TODAY_IDX;
      const late = recent && rng.chance(0.3);
      const partial = recent && !late && rng.chance(0.35);
      if (late) {
        // Nothing yet - overdue.
      } else if (partial) {
        receive(expectedIdx, (r) => (rng.chance(0.6) ? Math.floor(r.orderedQty * rng.float(0.3, 1)) : 0));
        if (recs.length) status = rows.every((r) => r.receivedQty >= r.orderedQty) ? "RECEIVED" : "PARTIALLY_RECEIVED";
      } else if (receiptIdx < TODAY_IDX || (receiptIdx === TODAY_IDX && rng.chance(0.5))) {
        const shortClose = rng.chance(0.04);
        receive(receiptIdx, (r) => (shortClose && rng.chance(0.3) ? Math.floor(r.orderedQty * rng.float(0.5, 0.9)) : r.orderedQty));
        status = shortClose ? "CLOSED" : "RECEIVED";
        // What a short-closed PO didn't deliver is no longer on order.
        if (shortClose) for (const r of rows) onOrder.set(r.itemId, onOrder.get(r.itemId) - (r.orderedQty - r.receivedQty));
      }
      for (const rc of recs) {
        for (const rl of rc.lines) {
          const row = rows.find((r) => r.id === rl.lineId);
          events.push({ itemId: row.itemId, itemNumber: row.itemNumber, at: rc.receivedAt, delta: rl.qty, reason: "RECEIVE_PO", refType: "vendor-po", refId: po, actor: "rcv" });
        }
      }
      pos.push({ poNumber: po, vendorId: vendorRows[vi].id, vendorName: v.name, orderDate: dbDate(orderDay), expectedDate: dbDate(expectedDay), status, notes: "", createdAt: atTime(orderDay, rng.float(8, 15)), version: 1 + recs.length });
      poLines.push(...rows);
      receipts.push(...recs);
    });
  }

  // ---------------------------------------------------- stock ledger
  // Opening balance: two-plus weeks of demand, raised if needed so no item
  // ever goes below zero. At the end, a cycle count only corrects items whose
  // stock ended below what open orders hold, and takes the short items down
  // to exactly what they hold (no free stock).
  const movements = [];
  const byItem = new Map(items.map((i) => [i.id, []]));
  for (const e of events) byItem.get(e.itemId).push(e);
  const firstDay = DAYS[0];
  const receiverPool = pool("receiving");
  const logPool = pool("open-picks");
  const actorFor = (tag) => (tag === "rcv" ? rng.pick(receiverPool) : rng.pick(logPool));
  let adjustedUnits = 0;
  let movedUnits = 0;
  for (const it of items) {
    const evs = byItem.get(it.id).sort((a, b) => a.at - b.at);
    let run = 0;
    let min = 0;
    for (const e of evs) {
      run += e.delta;
      min = Math.min(min, run);
      movedUnits += Math.abs(e.delta);
    }
    const opening = Math.max(opening0.get(it.id), -min + rng.int(5, 30));
    const natural = opening + run;
    const held = reserved.get(it.id) ?? 0;
    const target = shortItems.has(it.id) ? held : Math.max(natural, held + rng.int(5, 40));
    // Reorder point = about a week of demand (roughly the vendor lead time).
    it.reorderPoint = Math.max(5, Math.round((avgDaily(it.id) * 5) / 5) * 5);
    let qty = 0;
    const add = (delta, at, reason, refType, refId, actor) => {
      qty += delta;
      movements.push({ id: randomUUID(), itemId: it.id, itemNumber: it.itemNumber, delta, qtyAfter: qty, reason, refType, refId, actorId: actor.id, actorUsername: actor.username, createdAt: at });
    };
    add(opening, atTime(firstDay, 6), "ADJUST", "opening-balance", null, admin);
    for (const e of evs) add(e.delta, e.at, e.reason, e.refType, e.refId, actorFor(e.actor));
    if (qty !== target) {
      adjustedUnits += Math.abs(target - qty);
      add(target - qty, new Date(NOW.getTime() - 2 * 60000), "ADJUST", "cycle-count", null, rng.pick(receiverPool));
    }
    it.qtyOnHand = target;
  }
  // On PO = outstanding on POs that aren't closed.
  const onPo = new Map();
  const closed = new Set(pos.filter((p) => p.status === "CLOSED").map((p) => p.poNumber));
  for (const l of poLines) if (!closed.has(l.poNumber)) onPo.set(l.itemId, (onPo.get(l.itemId) ?? 0) + Math.max(0, l.orderedQty - l.receivedQty));

  // ---------------------------------------------------- write
  const chunked = async (label, model, rows, size = 4000) => {
    for (let i = 0; i < rows.length; i += size) await model.createMany({ data: rows.slice(i, i + size) });
    console.log(`  ${label.padEnd(22)} ${rows.length.toLocaleString()}`);
  };
  console.log("Writing...");
  await chunked("vendors", prisma.vendor, vendorRows);
  await chunked("items", prisma.item, items.map((i) => ({ id: i.id, itemNumber: i.itemNumber, description: i.description, um: i.um, rate: i.rate, qtyOnHand: i.qtyOnHand, qtyOnPurchaseOrder: onPo.get(i.id) ?? 0, reorderPoint: i.reorderPoint, countryOfOrigin: i.countryOfOrigin, weight: i.weight, preferredVendorId: i.preferredVendorId, createdAt: atTime(firstDay, 6) })));
  await chunked("customers", prisma.customer, customers.map((c) => ({ id: c.id, name: c.name, accountNumber: c.accountNumber, billTo: c.billTo, terms: c.terms, shipVia: c.shipVia, fob: c.fob, rep: c.rep, shipCompleteOnly: c.shipCompleteOnly, privateLabelName: c.privateLabelName, routingGuide: c.routingGuide ?? undefined, createdAt: atTime(firstDay, 6) })));
  await chunked("ship-to locations", prisma.shippingLocation, customers.flatMap((c) => c.locations.map((l) => ({ id: l.id, customerId: c.id, label: l.label, address: l.address }))));
  await chunked("price overrides", prisma.customerPriceOverride, customers.flatMap((c) => c.overrides.map((o) => ({ id: o.id, customerId: c.id, itemNumber: o.itemNumber, customerPartNumber: o.customerPartNumber, description: o.description, price: o.price, weight: o.weight }))));
  await chunked("part-number mappings", prisma.customerPartMapping, customers.flatMap((c) => c.partMap.map((m) => ({ ...m, customerId: c.id }))));
  await chunked("customer notes", prisma.customerNote, customers.flatMap((c) => c.notes.map((text) => ({ id: randomUUID(), customerId: c.id, text, createdAt: atTime(DAYS[rng.int(0, DAYS.length - 1)], rng.float(8, 17)) }))));
  await chunked("sales orders", prisma.salesOrder, orders.map((o) => ({ ...o, allocation: o.allocation ?? undefined })));
  await chunked("order lines", prisma.salesOrderLine, lines.map(({ _item, _shipped, ...l }) => l));
  await chunked("shipments", prisma.shipmentRecord, shipments);
  await chunked("vendor POs", prisma.vendorPurchaseOrder, pos);
  await chunked("PO lines", prisma.vendorPoLine, poLines);
  await chunked("PO receipts", prisma.vendorReceivingRecord, receipts);
  await chunked("returns (RAs)", prisma.returnAuthorization, returns);
  await chunked("return lines", prisma.returnLine, returnLines);
  await chunked("stock movements", prisma.stockMovement, movements);

  // Document counters hold the last number issued.
  for (const [key, value] of [["salesOrder", soNumber], ["vendorPo", poNumber], ["return", raNumber]]) {
    await prisma.counter.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await prisma.$executeRawUnsafe(`ANALYZE`);

  // ---------------------------------------------------- summary
  const byStatus = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const printed = orders.filter((o) => o.status === "PICK_PACKED" && o.pickListPrintedAt).length;
  const todayOrders = orders.filter((o) => localDay(o.createdAt) === TODAY).length;
  const shippedToday = new Set(shipments.filter((s) => localDay(s.shippedAt) === TODAY).map((s) => s.soNumber)).size;
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)} s. Orders span ${DAYS[0]} to ${TODAY} (${DAYS.length} business days).`);
  console.log(`  Orders by status: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(", ")} (Pick & Packed: ${printed} printed, ${byStatus.PICK_PACKED - printed} not yet)`);
  console.log(`  Entered today: ${todayOrders}; shipped today: ${shippedToday}; short items (no free stock): ${shortItems.size}`);
  console.log(`  Final cycle-count adjustments: ${adjustedUnits.toLocaleString()} units (${((100 * adjustedUnits) / Math.max(1, movedUnits)).toFixed(1)}% of all stock movement)`);
  console.log(`  Next numbers: S.O. ${soNumber + 1}, ${`PO-${poNumber + 1}`}, RA-${raNumber + 1}`);
  console.log("Restart the API so its caches pick up the new data.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
