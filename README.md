<p align="center">
  <img src="imag/CarScope_logo_about.png" width="160" alt="CarScope">
</p>

<h1 align="center">CarScope</h1>
<p align="center">Free used car buying assistant for CarGurus — NHTSA recalls, VIN decode, price tracking & comparison.</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-0A84FF?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/manifest-MV3-0A84FF?style=flat-square" alt="MV3">
  <img src="https://img.shields.io/badge/license-MIT-0A84FF?style=flat-square" alt="license">
</p>

---

## Overview

CarScope enriches CarGurus listing pages with safety data, price intelligence, and buying tools — all free, no account required, and fully local (nothing leaves your browser).

## Features

| | Feature | Description |
|---|---|---|
| ⚠️ | **NHTSA Recalls** | Open safety recalls by make / model / year, with campaign links |
| 💬 | **NHTSA Complaints** | Owner-reported issues flagged by crash / fire / injury severity |
| 🔑 | **VIN Decode** | Full manufacturer spec sheet from the NHTSA vPIC API |
| 📊 | **Price History** | Tracks listed price on every visit; shows ↑↓ trend |
| 🔔 | **Drop Alerts** | Desktop notification when a saved car's price drops |
| 🔄 | **Auto-Refresh** | 24h background price refresh via `chrome.alarms` |
| 💰 | **Cost Estimate** | Monthly loan + fuel calculator (adjustable down / term / APR) |
| 📋 | **Pre-Purchase Checklist** | Structured dealer checklist, shareable with □ checkboxes |
| ⚖️ | **Compare** | Side-by-side specs for up to 3 saved cars |
| 📤 | **Share Shortlist** | Copy shortlist as formatted plain text with checklist |
| 🕒 | **Browsing History** | Auto-logged recently viewed cars with one-click save |

## Supported Sites

| Platform | Status |
|----------|--------|
| CarGurus (US & Canada) | ✅ Full support |
| AutoTrader UK | 🔧 Partial |
| AutoScout24 | 🔧 Partial |

## Data Sources

All data comes from **free public APIs** — no API key required:

- **NHTSA Recalls** — `api.nhtsa.gov/recalls/recallsByVehicle`
- **NHTSA Complaints** — `api.nhtsa.gov/complaints/complaintsByVehicle`
- **NHTSA VIN Decode** — `vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}`

## Tech Stack

- Vanilla JS, zero build tools
- Chrome Extension Manifest V3 (Service Worker)
- `chrome.scripting.executeScript({ world: 'MAIN' })` for CarGurus data extraction
- `chrome.alarms` + `chrome.notifications` for background refresh & price alerts
- `chrome.storage.local` / `chrome.storage.session`

## Privacy

CarScope collects no personal data. Everything stays in your browser.  
See [Privacy Policy](privacy.html).

## Project Structure

```
CarScope/
├── manifest.json
├── background.js          # NHTSA proxy, price refresh, notifications
├── content.js             # Entry: calls extractor → caches to session
├── popup.html / .js / .css
├── about.html / .css      # Brand page (opened from footer)
├── privacy.html
├── extractors/
│   ├── base.js
│   ├── cargurus.js        # MAIN world extraction via __remixContext
│   ├── autotrader_uk.js
│   └── autoscout24.js
├── lib/
│   └── storage.js         # car_ prefix, Car schema, makeCar()
├── i18n/
│   └── locales.js
└── imag/
```

## From the Same Developer

- [StayScope](https://chromewebstore.google.com/detail/stayscope/khmhjiafkapmhakmpfcgmgikkffejnpm) — Airbnb / Booking.com travel assistant
- [HomeScope](https://github.com/YCCC777/HomeScope) — Taiwan real estate assistant

---

<p align="center">Made by <a href="https://yccc777.github.io/risa-studio/">Risa Studio</a></p>
