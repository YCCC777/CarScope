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

        // Additional schema.org/Vehicle fields
        const trim         = item.vehicleConfiguration || null;
        const fuelType     = item.fuelType || null;
        const transmission = item.vehicleTransmission || null;
        const colour       = item.color || item.colour || null;
        const bodyType     = item.bodyType || null;

        if (vin || name || price) {
          return {
            vin:     vin ? String(vin).trim().toUpperCase() : null,
            name,
            price:   price ? parseFloat(String(price).replace(/[^0-9.]/g, '')) || null : null,
            mileage: mileage ? parseInt(String(mileage).replace(/[^0-9]/g, ''), 10) || null : null,
            year:    year ? parseInt(year, 10) || null : null,
            make,
            model,
            trim,
            fuelType,
            transmission,
            colour,
            bodyType,
            strategy: 'jsonld',
          };
        }
      }
    } catch (e) {}
  }
  return null;
}

// ---- UK Registration Plate 驗證（post-2001 current format: AB12 CDE） ----
function isValidUKReg(reg) {
  if (!reg || typeof reg !== 'string') return false;
  return /^[A-Z]{2}[0-9]{2}\s?[A-Z]{3}$/i.test(reg.trim());
}

// ---- 從頁面掃描 UK 車牌 ----
function scanPageForUKReg() {
  const REG_RE = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3})\b/g;

  // 1. inline scripts（常在 preloaded state 中出現）
  for (const s of document.querySelectorAll('script:not([src])')) {
    const text = s.textContent;
    if (text.length > 3_000_000) continue;
    const m = REG_RE.exec(text);
    if (m) return m[1].trim().toUpperCase().replace(/(\w{4})(\w{3})/, '$1 $2');
    REG_RE.lastIndex = 0;
  }

  // 2. DOM body text（車牌通常顯眼呈現）
  const bodyText = document.body?.innerText || '';
  REG_RE.lastIndex = 0;
  const m = REG_RE.exec(bodyText);
  if (m) return m[1].trim().toUpperCase();

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
