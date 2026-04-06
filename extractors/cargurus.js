// ============================================================
// CarScope — CarGurus Extractor
// 目標：www.cargurus.com/Cars/*/d*#listing=* （VDP 頁面）
//
// 策略（依優先序）：
//   A. window.__CARGURUS_DATA__ / window.cgData（MAIN world）
//   B. JSON-LD schema.org/Car
//   C. DOM 選擇器（price / mileage / VIN）
//   D. inline script VIN 掃描
// ============================================================
'use strict';

function extractCarGurus() {
  // 只在有 #listing= 的詳情頁執行
  if (!location.hash.includes('listing=') && !location.pathname.includes('/vdp/')) {
    return null;
  }

  // ---- 策略 A：window global（ISOLATED world 不可用，由 popup.js MAIN world 補抓） ----
  // 在 content script 中先試 JSON-LD，MAIN world fallback 由 fetchCarDetails() 處理

  // ---- 策略 B：JSON-LD ----
  const jsonld = extractCarFromJsonLd();
  if (jsonld?.vin || jsonld?.price) {
    return {
      source:  'cargurus',
      ...jsonld,
      vin:     jsonld.vin || scanPageForVin(),
      name:    jsonld.name || _buildName(jsonld),
    };
  }

  // ---- 策略 C：DOM 選擇器 ----
  const dom = _extractFromDom();
  if (dom) return { source: 'cargurus', strategy: 'dom', ...dom };

  // ---- 策略 D：VIN 掃描 ----
  const vin = scanPageForVin();
  if (vin) {
    return {
      source:   'cargurus',
      strategy: 'vin-scan',
      vin,
      name:     _getTitleFromPage(),
      price:    null,
      mileage:  null,
      year:     null,
      make:     null,
      model:    null,
    };
  }

  return null;
}

function _extractFromDom() {
  try {
    // CarGurus DOM 選擇器（需在真實頁面驗證，可能因改版失效）
    const priceEl   = document.querySelector('[data-testid="price"]')
                   || document.querySelector('.price-section .price')
                   || document.querySelector('.listing-price');
    const mileEl    = document.querySelector('[data-testid="mileage"]')
                   || document.querySelector('.mileage');
    const titleEl   = document.querySelector('h1')
                   || document.querySelector('[data-testid="listing-title"]');
    const vinEl     = document.querySelector('[data-testid="vin"]')
                   || document.querySelector('.vin')
                   || document.querySelector('[class*="vin" i]');

    const price   = parsePrice(priceEl?.textContent);
    const mileage = parseMileage(mileEl?.textContent);
    const name    = titleEl?.textContent?.trim() || null;
    const vin     = vinEl?.textContent?.trim() || null;

    if (!price && !mileage && !name) return null;

    const year  = parseYear(name);
    return {
      name,
      price,
      mileage,
      vin:   isValidVin(vin) ? vin.toUpperCase() : scanPageForVin(),
      year,
      make:  null,   // MAIN world 補抓
      model: null,
    };
  } catch (e) { return null; }
}

function _getTitleFromPage() {
  return document.querySelector('h1')?.textContent?.trim()
      || document.title?.replace(/\s*[-–|].*$/, '').trim()
      || null;
}

function _buildName({ year, make, model }) {
  return [year, make, model].filter(Boolean).join(' ') || null;
}

window.__siteExtractFn = extractCarGurus;
