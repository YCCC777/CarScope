# CarScope — CLAUDE.md

> Chrome Extension: Used car buying assistant. Enriches CarGurus / AutoTrader listing pages with NHTSA recalls, VIN decode, and car tracking.
> Global-first product (English only). Follows the same architecture as StayScope / HomeScope.

---

## Project Overview

| Item | Value |
|------|-------|
| Name | CarScope |
| Version | v0.1.0 |
| Status | In Development |
| Manifest | MV3 (Service Worker) |
| Architecture | Zero-build, vanilla JS |
| Supported Platforms | CarGurus, AutoTrader (Phase 1) |
| Language | English only (global product) |
| Accent Color | Electric Blue `#0A84FF` |
| Storage Prefix | `car_` |

---

## File Structure

```
CarScope/
├── manifest.json
├── background.js          # Badge + NHTSA API proxy
├── content.js             # Entry: calls extractor → sends to background
├── extractors/
│   ├── base.js            # VIN utilities (isValidVin, scanPageForVin, extractCarFromJsonLd)
│   ├── cargurus.js        # CarGurus VDP extractor
│   └── autotrader.js      # AutoTrader extractor
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

### CarGurus (Phase 1 priority)
- URL detection: `#listing=` in hash OR `/vdp/` in path
- Extraction strategies (priority order):
  1. JSON-LD (`schema.org/Car`)
  2. `window.__CARGURUS_DATA__` (MAIN world)
  3. DOM selectors (`[data-testid="price"]` etc.)
  4. VIN regex scan across all scripts + DOM

### AutoTrader (Phase 1)
- URL detection: `vehicledetails` or `/cars-for-sale/` in path
- Same strategy order as CarGurus

---

## Free External APIs

| API | Endpoint | Usage |
|-----|----------|-------|
| NHTSA Recalls | `api.nhtsa.gov/recalls/recallsByVehicle?make=X&model=Y&modelYear=Z` | Free, no key |
| NHTSA VIN Decode | `vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json` | Free, no key |
| EPA Fuel Economy | `fueleconomy.gov/ws/rest/vehicle/menu/make?year=Y` | Free, Phase 2 |

NHTSA APIs require background.js proxy (CORS). EPA is direct fetch.

---

## Car Schema

```javascript
{
  id,              // urlToId(url) — djb2 hash
  url,
  source,          // 'cargurus' | 'autotrader' | 'cars_com'
  savedAt,

  // Vehicle
  name,            // "2020 Toyota Camry LE"
  make, model, year, trim,
  vin,             // 17-char, uppercase
  price,           // USD number
  mileage,         // miles number
  condition,       // 'used' | 'certified' | 'new'

  // Location
  dealerName,
  location,        // "Chicago, IL"

  // NHTSA cache
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

## Known Limitations (Phase 1)

- CarGurus / AutoTrader block server-side fetches (418/403) — extractor must run in browser
- DOM selectors will break if platforms redesign — need real-page testing to verify
- MAIN world data (`window.__CARGURUS_DATA__`) requires `scripting` permission injection
- NHTSA data is US-only; international recalls not covered

## Development Environment Constraints

- **CarGurus 封鎖台灣 IP**（HTTP 418）：開發者在台灣無法直接存取 CarGurus
  - 解法 A：使用美國 VPN（Proton VPN / Windscribe 免費版）
  - 解法 B：改用 AutoTrader UK（`autotrader.co.uk`）作為開發測試平台，台灣可存取
  - 待決：2026-04-07 決定方向後實作
- **AutoTrader.com** 同樣可能封鎖非美國 IP

---

## Phase Roadmap

### Phase 1 (current) — MVP
- CarGurus + AutoTrader VIN/price/mileage extraction
- NHTSA recalls display
- VIN decode (NHTSA VPIC API)
- Save / track / notes
- Link-outs: CARFAX, NHTSA, KBB

### Phase 2 — Enrichment
- EPA fuel economy display
- Price history tracking (降價追蹤)
- Compare view
- Deal rating (is this price above/below market?)

### Phase 3 — Monetization
- Per-VIN report (VinAudit integration, ~$1–3/report cost)
- Unlimited price tracking (freemium gate)
- Total cost of ownership calculator

### Phase 4 — More Platforms
- Cars.com
- Facebook Marketplace
- Carvana
