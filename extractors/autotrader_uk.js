// ============================================================
// CarScope — AutoTrader UK Extractor
// 目標：www.autotrader.co.uk/car-details/* + /cars/leasing/product/*
// NOTE: AutoTrader UK uses Styled Components — hashed class names (sc-xxx)
//       are NOT stable across deploys. Only data-testid attributes are reliable.
// ============================================================
'use strict';

function extractAutoTraderUK() {
  if (!location.hostname.includes('autotrader.co.uk')) return null;

  const path = location.pathname;
  const isVdp = path.startsWith('/car-details/')           // used / classified
             || path.startsWith('/cars/leasing/product/')  // leasing
             || path.startsWith('/new-cars/detail/')       // new car detail
             || /\/cars\/[^/]+\/product\//.test(path);     // other /cars/*/product/ variants
  if (!isVdp) return null;

  // ---- Strategy A: JSON-LD ----
  const jsonld = extractCarFromJsonLd();
  if (jsonld?.name || jsonld?.price) {
    return {
      source:   'autotrader_uk',
      currency: 'GBP',
      ...jsonld,
      regPlate: scanPageForUKReg(),
      vin:      jsonld.vin || scanPageForVin(),
      name:     jsonld.name || _buildName(jsonld),
    };
  }

  // ---- Strategy B: window.__PRELOADED_STATE__ / Next.js ----
  const state = _extractFromState();
  if (state) return { source: 'autotrader_uk', currency: 'GBP', strategy: 'state', ...state };

  // ---- Strategy C: DOM ----
  const dom = _extractFromDom();
  if (dom) return { source: 'autotrader_uk', currency: 'GBP', strategy: 'dom', ...dom };

  // ---- Strategy D: 至少拿到車牌 ----
  const regPlate = scanPageForUKReg();
  if (regPlate) {
    return {
      source:   'autotrader_uk',
      currency: 'GBP',
      strategy: 'reg-scan',
      regPlate,
      name:     document.querySelector('h1')?.textContent?.trim().replace(/\s+/g, ' ') || null,
      price: null, mileage: null, year: null, make: null, model: null,
    };
  }

  return null;
}

// ---- Strategy B: window state ----
function _extractFromState() {
  try {
    const raw = window.__PRELOADED_STATE__
             || window.__NEXT_DATA__?.props?.pageProps
             || null;
    if (!raw) return null;

    const advert = raw?.advert
                || raw?.advertDetails
                || raw?.vehicle
                || raw?.pageData?.advert
                || null;
    if (!advert) return null;

    const priceRaw = advert.price?.advertisedPrice?.amountValue
                  || advert.price?.amount
                  || advert.advertisedPrice
                  || null;

    const mileageRaw = advert.mileage?.mileage
                    || advert.mileage
                    || null;

    return {
      name:         advert.title || advert.heading || _buildName(advert),
      make:         advert.make || advert.manufacturerName || null,
      model:        advert.model || advert.modelName || null,
      year:         parseInt(advert.year || advert.registrationYear, 10) || null,
      trim:         advert.trim || advert.derivative || advert.vehicleConfiguration || null,
      vin:          advert.vin || advert.vehicleIdentificationNumber || scanPageForVin(),
      regPlate:     _normaliseReg(advert.registrationPlate || advert.vrm || advert.registration),
      price:        priceRaw ? parseFloat(String(priceRaw).replace(/[^0-9.]/g, '')) || null : null,
      mileage:      mileageRaw ? parseInt(String(mileageRaw).replace(/[^0-9]/g, ''), 10) || null : null,
      condition:    advert.vehicleCondition?.toLowerCase() || 'used',
      fuelType:     advert.fuelType || null,
      transmission: advert.transmissionType || advert.gearbox || null,
      colour:       advert.colour || advert.color || null,
      bodyType:     advert.bodyType || null,
      dealerName:   advert.seller?.name || advert.dealerName || null,
      location:     advert.seller?.town || advert.seller?.location || advert.location || null,
    };
  } catch (e) { return null; }
}

// ---- Strategy C: DOM ----
function _extractFromDom() {
  try {
    // Title: h1 textContent covers both make/model and nested trim span
    const name  = document.querySelector('h1')?.textContent?.trim().replace(/\s+/g, ' ') || null;

    // Price: data-testid="advert-price" on car-details; leasing has no testid → £ text fallback
    const priceEl = document.querySelector('[data-testid="advert-price"]')
                 || _findPriceByGbpText();
    const price   = parsePrice(priceEl?.textContent);

    // Mileage: data-testid where available; fallback to text-content match ("45,231 miles")
    const mileEl  = document.querySelector('[data-testid="mileage"]')
                 || document.querySelector('[data-testid="vehicle-mileage"]')
                 || _findMileageText();
    const mileage = parseMileage(mileEl?.textContent);

    // Registration plate
    const regEl    = document.querySelector('[data-testid="reg-plate"]')
                  || document.querySelector('[data-testid="registration-plate"]');
    const regPlate = _normaliseReg(regEl?.textContent?.trim()) || scanPageForUKReg();

    const fuelEl   = document.querySelector('[data-testid="fuel-type"]')
                  || _findFuelTypeText();
    const fuelType = fuelEl?.textContent?.trim() || null;

    if (!price && !mileage && !name) return null;

    const specs  = _extractSpecsFromDom();
    const parsed = _parseNameParts(name);

    return {
      name,
      price,
      mileage,
      regPlate,
      vin:          scanPageForVin(),
      year:         specs.year         || parsed.year || null,
      make:         parsed.make        || null,
      model:        parsed.model       || null,
      trim:         parsed.trim        || null,
      fuelType:     specs.fuelType     || fuelType || null,
      transmission: specs.transmission || null,
      colour:       specs.colour       || null,
      bodyType:     specs.bodyType     || null,
      dealerName:   null,
      location:     _extractLocation(),
    };
  } catch (e) { return null; }
}

// 找第一個文字以 £ 開頭的葉節點（leasing 頁 price fallback，無 data-testid）
function _findPriceByGbpText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.children.length > 0) continue;
    const t = el.textContent.trim();
    if (/^£[\d,]+(\.\d{1,2})?$/.test(t)) return el;
  }
  return null;
}

// 找第一個 exact match 燃料類型的葉節點
function _findFuelTypeText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.children.length > 0) continue;
    const t = el.textContent.trim();
    if (/^(petrol|diesel|electric|hybrid|mild hybrid|plug-in hybrid|phev)$/i.test(t)) return el;
  }
  return null;
}

// 找第一個文字符合 "45,231 miles" 或 "6,000 miles/year" 格式的葉節點
function _findMileageText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el.children.length > 0) continue;
    const t = el.textContent.trim();
    if (/^\d[\d,]+\s*miles?(\/\s*(year|pa|annum))?$/i.test(t)) return el;
  }
  return null;
}

// 從 h1 name 拆解 make / model / trim / year
// "2008 Vauxhall Corsa 1.2 SXi" → {year:2008, make:"Vauxhall", model:"Corsa", trim:"1.2 SXi"}
// "Volkswagen Golf 2.0 TSI GTI DSG Euro 6 (s/s) 5dr" → {make:"Volkswagen", model:"Golf", trim:"2.0 TSI GTI DSG Euro 6 (s/s) 5dr"}
function _parseNameParts(name) {
  if (!name) return {};
  const clean = name.trim().replace(/\s+/g, ' ');
  const yearM = clean.match(/^(\d{4})\s+/);
  const rest  = yearM ? clean.slice(yearM[0].length) : clean;
  const year  = yearM ? parseInt(yearM[1]) : null;
  const words = rest.split(' ');
  const make  = words[0] || null;
  const model = words[1] || null;
  const trim  = words.length > 2 ? words.slice(2).join(' ') : null;
  return { year, make, model, trim };
}

// ---- DOM spec list 解析 ----
// Only reads from data-testid containers — broad li fallback causes false positives
// from nav/footer. Fields stay null until reliable selectors are confirmed.
function _extractSpecsFromDom() {
  const result = {};
  try {
    const items = document.querySelectorAll(
      '[data-testid="vehicle-overview-list"] li, [data-testid="key-specs"] li'
    );
    for (const item of items) {
      const text = item.textContent.trim();
      if (/^\d{4}$/.test(text)) { result.year = parseInt(text, 10); continue; }
      if (/^(petrol|diesel|electric|hybrid|mild hybrid)$/i.test(text)) { result.fuelType = text; continue; }
      if (/^(automatic|manual|semi-automatic)$/i.test(text)) { result.transmission = text; continue; }
      if (/^(hatchback|saloon|estate|suv|coupe|convertible|mpv|pickup|van)$/i.test(text)) { result.bodyType = text; continue; }
    }
  } catch (e) {}
  return result;
}

// 依 label 文字尋找對應的值節點（dt/th → dd/td）
function _findSpecByLabel(keyword) {
  const labels = document.querySelectorAll('dt, th');
  for (const label of labels) {
    if (label.textContent.trim().toLowerCase().includes(keyword)) {
      return label.nextElementSibling || label.closest('tr')?.querySelector('td');
    }
  }
  return null;
}

// ---- 地點 ----
function _extractLocation() {
  try {
    const el = document.querySelector('[data-testid="seller-location"]')
            || document.querySelector('[data-testid="dealer-location"]');
    return el?.textContent?.trim() || null;
  } catch (e) { return null; }
}

// ---- Helpers ----
function _buildName({ year, make, model, trim } = {}) {
  return [year, make, model, trim].filter(Boolean).join(' ') || null;
}

function _normaliseReg(raw) {
  if (!raw) return null;
  const clean = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(clean)) {
    return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  }
  return isValidUKReg(raw) ? raw.trim().toUpperCase() : null;
}

window.__siteExtractFn = extractAutoTraderUK;
