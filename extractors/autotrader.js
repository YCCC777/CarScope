// ============================================================
// CarScope — AutoTrader Extractor
// 目標：www.autotrader.com/cars-for-sale/vehicledetails.xhtml?listingId=*
// ============================================================
'use strict';

function extractAutoTrader() {
  // 只在車輛詳情頁執行
  if (!location.href.includes('vehicledetails') && !location.href.includes('/cars-for-sale/')) {
    return null;
  }

  // ---- 策略 A：JSON-LD ----
  const jsonld = extractCarFromJsonLd();
  if (jsonld?.vin || jsonld?.price) {
    return {
      source: 'autotrader',
      ...jsonld,
      vin:  jsonld.vin || scanPageForVin(),
      name: jsonld.name || _buildName(jsonld),
    };
  }

  // ---- 策略 B：DOM ----
  const dom = _extractFromDom();
  if (dom) return { source: 'autotrader', strategy: 'dom', ...dom };

  // ---- 策略 C：VIN 掃描 ----
  const vin = scanPageForVin();
  if (vin) {
    return {
      source:   'autotrader',
      strategy: 'vin-scan',
      vin,
      name:     document.querySelector('h1')?.textContent?.trim() || null,
      price:    null, mileage: null, year: null, make: null, model: null,
    };
  }

  return null;
}

function _extractFromDom() {
  try {
    const priceEl  = document.querySelector('[data-cmp="price"]')
                  || document.querySelector('.first-price');
    const mileEl   = document.querySelector('[data-cmp="mileage"]')
                  || document.querySelector('.item-card-mileage');
    const titleEl  = document.querySelector('h1');

    const price   = parsePrice(priceEl?.textContent);
    const mileage = parseMileage(mileEl?.textContent);
    const name    = titleEl?.textContent?.trim() || null;

    if (!price && !mileage && !name) return null;

    return {
      name,
      price,
      mileage,
      vin:   scanPageForVin(),
      year:  parseYear(name),
      make:  null,
      model: null,
    };
  } catch (e) { return null; }
}

function _buildName({ year, make, model }) {
  return [year, make, model].filter(Boolean).join(' ') || null;
}

window.__siteExtractFn = extractAutoTrader;
