# CarScope — CLAUDE.md

> Chrome Extension: Used car buying assistant. Enriches AutoTrader UK / CarGurus / AutoTrader listing pages with recalls, VIN decode, and car tracking.
> Global-first product (English only). Follows the same architecture as StayScope / HomeScope.

---

## Project Overview

| Item | Value |
|------|-------|
| Name | CarScope |
| Version | v1.0.0 |
| Status | Phase 1 Complete |
| Manifest | MV3 (Service Worker) |
| Architecture | Zero-build, vanilla JS |
| Supported Platforms | AutoTrader UK (Phase 1 priority), CarGurus, AutoTrader.com |
| Language | English only (global product) |
| Accent Color | Electric Blue `#0A84FF` |
| Storage Prefix | `car_` |

---

## File Structure

```
CarScope/
├── manifest.json
├── background.js          # Badge + NHTSA API proxy
├── content.js             # Entry: calls extractor → sends to background (isolated world)
├── extractors/
│   ├── base.js            # VIN utilities (isValidVin, scanPageForVin, extractCarFromJsonLd)
│   ├── cargurus.js        # CarGurus VDP extractor (MAIN world only)
│   ├── autotrader_uk.js   # AutoTrader UK extractor
│   ├── autoscout24.js     # AutoScout24 extractor
│   └── autotrader.js      # AutoTrader.com extractor
├── lib/
│   └── storage.js         # car_ prefix; Car schema; makeCar()
├── i18n/
│   └── locales.js         # English strings only
├── popup.html
├── popup.js               # Main popup logic
├── popup.css              # Dark theme, blue accent
└── CLAUDE.md
```

---

## Supported Platforms

### AutoTrader UK (Phase 1 priority — 台灣 IP 可存取)
- Domain: `www.autotrader.co.uk`
- URL detection: `/car-details/` in path
- Extraction strategies (priority order):
  1. JSON-LD (`schema.org/Car`)
  2. `window.__PRELOADED_STATE__` / `window.__NEXT_DATA__`
  3. DOM selectors (`[data-testid="advert-title"]` etc.)
  4. UK reg plate regex scan
- Extra fields: `regPlate`, `fuelType`, `transmission`, `colour`, `bodyType`, `currency: 'GBP'`
- UK reg plate format: `AB12 CDE` (post-2001 current format)

### CarGurus (需美國 IP，透過 EC2 SOCKS5 proxy 存取)
- Domain: `www.cargurus.com`, `www.cargurus.ca`
- URL detection: `/details/` in path (new format: `/details/430077025`)
- **Framework: Astro shell + Remix routes (hybrid)**
  - `window.__remixContext` exists but **only in MAIN world** (invisible to content script isolated world)
  - Content script auto-inject (isolated world) can only do VIN scan fallback — useless
  - **Popup must always inject in MAIN world** via `_extractCarGurusMain()` in popup.js
- Data location: `window.__remixContext.state.loaderData['routes/($intl).details.$listingId'].oldData`
- Extraction strategy: `_extractFromRemix()` in cargurus.js
- **Actual field names** (different from generic schema!):
  | Schema field | Actual `listing` field |
  |---|---|
  | `make` | `makeName` |
  | `model` | `modelName` |
  | `trim` | `trimName` |
  | `transmission` | `localizedTransmission` |
  | `colour` | `localizedExteriorColor` |
  | `driveTrain` | `localizedDriveTrain` |
  | `fuelType` | `localizedFuelType` |
  | `name` | `listingTitleOnly` (fallback: build from makeName/modelName) |
  | `dealerName` | `oldData.seller.name` (not `dealerInfo`) |
  | `condition` | `listingCondition` or `vehicleCondition` |
  - VIN guard: check `!l.isFakeVIN && !l.isInvalidVin` before using `l.vin`
  - dealRatingKey values observed: `GOOD_PRICE`, `GREAT_DEAL`, `FAIR_PRICE`, `HIGH_PRICE`, `OVERPRICED`
- Popup injection flow (cargurus.js must NOT be used as content_script):
  1. `_extractCarGurusMain(tabId)` in popup.js
  2. `executeScript({ files: ['base.js','cargurus.js'], world:'MAIN' })`
  3. `executeScript({ func: () => window.__siteExtractFn(), world:'MAIN' })` → returns data directly
  4. Skip cache check entirely (cache only has stale VIN-scan data from isolated world)

### AutoTrader.com (美國，台灣 IP 可能封鎖)
- URL detection: `vehicledetails` or `/cars-for-sale/` in path
- Same strategy order as CarGurus

---

## Free External APIs

| API | Endpoint | Usage |
|-----|----------|-------|
| NHTSA Recalls | `api.nhtsa.gov/recalls/recallsByVehicle?make=X&model=Y&modelYear=Z` | Free, no key |
| NHTSA VIN Decode | `vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json` | Free, no key |
| EPA Fuel Economy | `fueleconomy.gov/ws/rest/vehicle/menu/make?year=Y` | Free, Phase 2 |
| DVLA VES (UK) | `driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles` | Free API key needed; returns MOT due, tax status, make, colour from reg plate |

NHTSA APIs require background.js proxy (CORS). EPA is direct fetch.
DVLA VES: POST with `{"registrationNumber": "AB12CDE"}` + `x-api-key` header.

---

## Car Schema

```javascript
{
  id,              // urlToId(url) — djb2 hash
  url,
  source,          // 'cargurus' | 'autotrader' | 'autotrader_uk' | 'cars_com'
  savedAt,

  // Vehicle
  name,            // "2020 Toyota Camry LE" / "2019 Ford Fiesta ST-Line"
  make, model, year, trim,
  vin,             // 17-char, uppercase (US/EU)
  regPlate,        // UK: "AB12 CDE"
  price,           // number
  currency,        // 'USD' | 'GBP'
  mileage,         // miles
  mileageUnit,     // 'mi' | 'km'
  condition,       // 'used' | 'certified' | 'new'
  fuelType,        // 'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | …
  transmission,    // 'Manual' | 'Automatic' | …
  colour,
  bodyType,        // 'Hatchback' | 'SUV' | 'Saloon' | …
  driveTrain,
  powerKw, powerHp, displacement,
  dealRating,      // CarGurus: 'GOOD_PRICE' | 'GREAT_DEAL' | 'FAIR_PRICE' | 'HIGH_PRICE' | 'OVERPRICED'
  dealerRating, dealerReviewCount, dealerRecommend,
  huDate,          // AutoScout24: HU expiry date

  // Location
  dealerName,
  location,        // "Chicago, IL" or "Manchester"

  // NHTSA cache (US) / DVLA (UK Phase 2)
  recalls,         // number | null
  recallsFetchedAt,

  // Viewing management
  viewingStatus,   // 'unseen' | 'scheduled' | 'seen'
  viewingNote,
  viewingRating,   // 1-5 | null

  tags,            // string[]

  // Price tracking
  priceHistory,    // [{ price, date }] max 10
}
```

---

## Key Differences from HomeScope

| Item | HomeScope | CarScope |
|------|-----------|---------|
| Language | zh-TW only | English only |
| Map / POI | Core feature | Not applicable |
| External data | Nominatim, liquid.net.tw, GeoJSON | NHTSA, EPA |
| Identifier | lat/lng | VIN |
| Listing type | rent / sale | used / certified / new |

---

## What Users Care About (US Market)

- **VIN history** — accidents, owners, service records (CARFAX territory)
- **Recalls** — safety issues from NHTSA (free)
- **Fair price** — is this overpriced vs. market?
- **Total cost of ownership** — depreciation, insurance, fuel (Phase 2+)
- **Tracking** — save cars, compare, note-taking

## Known Limitations & Bugs

- CarGurus / AutoTrader block server-side fetches (418/403) — extractor must run in browser
- CarGurus `__remixContext` only visible in MAIN world — popup always injects inline func via `executeScript({ world:'MAIN' })`; content_script inject is useless for CarGurus
- NHTSA data is US-only; international recalls/complaints not covered
- `daysOnMarket` not available from CarGurus (not in listing object or statsDto)
- `listingDetailStatsSectionDto` is the richest data source — confirmed keys: make, model, year, trim, bodyType, exteriorColor, interiorColor, mileage, vin, stockNumber, certified, condition, fuelTankSize, combinedFuelEconomy, cityFuelEconomy, highwayFuelEconomy, fuelType, transmission, drivetrain, engine, horsepower, numberOfDoors, frontLegroom, backLegroom, cargoVolume
- NHTSA.gov complaints website SPA is unreliable ("something went wrong") — use API data inline instead of link-out
- CarEdge / AutoCheck URLs unreliable — replaced with Edmunds
- `host_permissions` must include all platforms for `chrome.scripting.executeScript` to work (not just `content_scripts.matches`)
- **CarGurus field names (confirmed via live debug)**:
  - `location`: NOT on `listing` object. Use `seller.address.cityRegion` (e.g. `"Lakewood, NJ"`); fallback `seller.address.city + seller.address.region`; final fallback `seller.address.postalCode`
  - `cityMpg`: `listing.cityFuelEconomy` = `{unit:'MPG', value:29}` → use `.value`; OR `_sm.cityFuelEconomy?.d` from statsDto
  - `hwyMpg`: NOT on `listing` directly (`highwayFuelEconomy` is undefined on `l`); use `_sm.highwayFuelEconomy?.d` from statsDto
  - `combinedMpg`: `listing.localizedCombinedFuelEconomy` = `"33 MPG"` (string); OR `_sm.combinedFuelEconomy?.d` from statsDto
  - `listing.localizedFuelEconomy` = array `['29 MPG']` (not useful for hwy)
  - All MPG best read from `_sm` (parsed `listingDetailStatsSectionDto`) for consistency
- Refresh prices runs in background.js service worker via `chrome.alarms` (24h auto + manual trigger); popup sends `triggerPriceRefresh` message, receives `refreshProgress` / `refreshDone` back

## Development Environment Constraints

- **AutoTrader UK**（`autotrader.co.uk`）：台灣 IP 可存取 ✅
- **CarGurus**：台灣 IP 封鎖（HTTP 418）→ 透過 AWS EC2 us-east-1 + SSH SOCKS5 proxy 存取 ✅
- **AutoTrader.com**（美國）同樣可能封鎖非美國 IP，暫緩

---

## Phase Roadmap

### Phase 1 — MVP ✅ Complete
- ✅ CarGurus extraction via MAIN world inline func (bypasses isolated world limitation)
- ✅ NHTSA Recalls — inline expandable, per-campaign link, count saved back to car.recalls
- ✅ NHTSA Complaints — inline expandable (api.nhtsa.gov), crash/fire/injury flags
- ✅ VIN Decode (NHTSA VPIC API) — inline expandable
- ✅ Save / track: status cycle, star rating, notes, preset tags, body style filter
- ✅ Saved tab: expandable cards, × quick delete, ↗ quick open in meta row
- ✅ Compare tab: multi-car side-by-side, checkbox select, best-value highlight, ✕ remove
- ✅ Compare persistence via `chrome.storage.session`
- ✅ Compare clipboard share (📋 Copy comparison)
- ✅ Price history tracking: auto-detect on visit, ↓↑ indicator in meta, history table in expand
- ✅ Batch Refresh prices: 🔄 button opens hidden tabs, extracts price, closes tabs
- ✅ _refreshSavedCar(): backfills missing fields (location/MPG/dealRating) on each popup open
- ✅ Link-outs: CARFAX (VIN), KBB Value, Edmunds
- ✅ Specs chips: price, mileage, year, fuelType, transmission, driveTrain, engine, bodyType, colour, dealRating, mpg, VIN

### Phase 2 — Enrichment (priority order)
- ✅ **Debug MPG + Location** — confirmed field names via live debug; fixed in popup.js
- ✅ **Browsing history** — collapsible `🕒 Recently Viewed` section at bottom of Saved tab (HomeScope pattern); `car_history` local storage (max 50); `makeHistoryEntry()` in storage.js; one-click Save from history; click card opens listing
- ✅ **Notes export / share** — `📤 Share shortlist` at bottom of Saved tab; plain-text with separators; fields: name+stars, price+deal+↓drop, mileage, dealer+location, dealerPhone, MPG, status, tags, notes, clean URL (query params stripped); `_cleanUrl()` strips tracking params; `_dealRatingLabel()` covers GREAT_PRICE/GREAT_DEAL/GOOD_PRICE/FAIR_PRICE/HIGH_PRICE/OVERPRICED + fallback formatter
- ✅ **Background price refresh** — `chrome.alarms` (24h) + manual `triggerPriceRefresh` message; 🔄 button in header; no popup-open required
- ✅ **dealerPhone** — extracted from `seller.phoneNumberString`; stored in schema; included in share output; backfilled via `_refreshSavedCar()`
- ✅ **Price drop notifications** — `chrome.notifications.create()` on price drop; `notifications` permission in manifest; background.js checks `car_notificationsEnabled` before firing
- ✅ **Dealer phone in Vehicle tab** — dealer-info row uses innerHTML; phone as `<a href="tel:...">` (blue, clickable)
- ✅ **Settings page** — slide-in overlay (`#pane-settings`); 🔔 notifications toggle (`car_notificationsEnabled`); 💾 export JSON (clipboard), clear saved, clear history; ℹ️ about
- ✅ **Monthly Cost Estimate** — collapsible section on Vehicle tab; chips for down% / term / APR; shows loan payment + fuel cost (12k mi/yr, $3.50/gal) + total; `renderCostEstimate()` re-runs on chip click
- ✅ **Pre-Purchase Checklist** — collapsible section in **Saved tab** (between Share shortlist and Recently Viewed); 3 groups: Before Visit / At Dealership / Documents; static HTML in popup.html; □ checklist appended to `shareShortlist()` output at bottom
- ✅ **About panel** — footer `🚗 CarScope` link opens slide-in overlay (`#pane-about`); version, feature list, supported sites; About section removed from Settings
- 🔲 **Chrome Web Store submission** — privacy policy, screenshots, icon, short description, version bump to v1.0.0
- 🔲 **EPA fuel economy** — free API at `fueleconomy.gov`; backup/supplement for CarGurus MPG
- 🔲 **More platforms** — Cars.com, Carvana, Facebook Marketplace (post-launch)

### Phase 3 — Monetization
- Per-VIN report (VinAudit integration, ~$1–3/report cost)
- Unlimited price tracking (freemium gate)
- Total cost of ownership calculator

### Phase 4 — More Platforms
- Cars.com
- Facebook Marketplace
- Carvana
