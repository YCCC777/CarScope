// ============================================================
// CarScope — Extractor Base Utilities
// ============================================================
'use strict';

// ---- VIN 驗證（北美標準 17 碼） ----
function isValidVin(vin) {
  if (!vin || typeof vin !== 'string') return false;
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim());
}

// ---- 從頁面任意位置掃描 VIN ----
function scanPageForVin() {
  const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;

  // 1. JSON-LD
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const text = JSON.stringify(JSON.parse(s.textContent));
      const m = VIN_RE.exec(text);
      if (m && isValidVin(m[1])) return m[1].toUpperCase();
    } catch (e) {}
    VIN_RE.lastIndex = 0;
  }

  // 2. meta 標籤
  for (const m of document.querySelectorAll('meta')) {
    const v = m.getAttribute('content') || '';
    if (isValidVin(v.trim())) return v.trim().toUpperCase();
  }

  // 3. inline scripts
  for (const s of document.querySelectorAll('script:not([src])')) {
    const text = s.textContent;
    if (text.length > 3_000_000) continue;
    const m = VIN_RE.exec(text);
    if (m && isValidVin(m[1])) return m[1].toUpperCase();
    VIN_RE.lastIndex = 0;
  }

  // 4. DOM text（最後手段）
  const bodyText = document.body?.innerText || '';
  const m = VIN_RE.exec(bodyText);
  if (m && isValidVin(m[1])) return m[1].toUpperCase();

  return null;
}

// ---- 從 JSON-LD 抓車輛資料（schema.org/Car 或 schema.org/Vehicle） ----
function extractCarFromJsonLd() {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      const items = data?.['@graph'] ? data['@graph'] : [data];
      for (const item of items) {
        if (!item) continue;
        const type = item['@type'] || '';
        if (!/(Car|Vehicle|Product)/i.test(type)) continue;

        const vin   = item.vehicleIdentificationNumber || item.vin || null;
        const name  = item.name || null;
        const price = item.offers?.price
                   || item.offers?.[0]?.price
                   || null;
        const mileage = item.mileageFromOdometer?.value
                     || item.mileageFromOdometer
                     || null;
        const year  = item.vehicleModelDate || item.modelDate || null;
        const make  = item.brand?.name || item.manufacturer?.name || null;
        const model = item.model || null;

        if (vin || name || price) {
          return {
            vin:     vin ? String(vin).trim().toUpperCase() : null,
            name,
            price:   price ? parseFloat(String(price).replace(/[^0-9.]/g, '')) || null : null,
            mileage: mileage ? parseInt(String(mileage).replace(/[^0-9]/g, ''), 10) || null : null,
            year:    year ? parseInt(year, 10) || null : null,
            make,
            model,
            strategy: 'jsonld',
          };
        }
      }
    } catch (e) {}
  }
  return null;
}

// ---- 價格字串解析（"$22,500" → 22500） ----
function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

// ---- 里程字串解析（"45,231 mi" → 45231） ----
function parseMileage(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

// ---- 年份字串解析 ----
function parseYear(str) {
  if (!str) return null;
  const m = String(str).match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}
