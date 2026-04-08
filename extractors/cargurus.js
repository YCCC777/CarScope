// ============================================================
// CarScope — CarGurus Extractor
// 資料來源：window.__remixContext（Remix SSR，最完整）
// URL 格式：cargurus.com/details/[id]（新）或 #listing= / /vdp/（舊）
// ============================================================
'use strict';

function extractCarGurus() {
  if (!location.hostname.includes('cargurus.com')) return null;

  const path = location.pathname;
  const hash = location.hash;
  const isVdp = path.includes('/details/')
             || path.includes('/vdp/')
             || hash.includes('#listing=')
             || hash.includes('listingId=');
  if (!isVdp) return null;

  // ---- Strategy A: __remixContext（Remix SSR data）----
  const remix = _extractFromRemix();
  if (remix) return { source: 'cargurus', strategy: 'remix', ...remix };

  // ---- Strategy B: JSON-LD ----
  const jsonld = extractCarFromJsonLd();
  if (jsonld?.name || jsonld?.price) {
    return {
      source:   'cargurus',
      currency: 'USD',
      ...jsonld,
      vin:  jsonld.vin || scanPageForVin(),
      name: jsonld.name || _buildName(jsonld),
    };
  }

  // ---- Strategy C: VIN scan ----
  const vin = scanPageForVin();
  if (vin) {
    return {
      source: 'cargurus', currency: 'USD', strategy: 'vin-scan',
      vin, name: document.querySelector('h1')?.textContent?.trim() || null,
      price: null, mileage: null, year: null, make: null, model: null,
    };
  }

  return null;
}

// ---- Strategy A: Remix ----
function _extractFromRemix() {
  try {
    const loaderData = window.__remixContext?.state?.loaderData;
    if (!loaderData) return null;

    // 找 VDP route key（不同地區 intl prefix 可能不同，CarGurus 路由可能改名）
    const routeKey = Object.keys(loaderData).find(k =>
      k.includes('details.$listingId') || k.includes('details.$id') || /details\.\$/.test(k)
    );
    if (!routeKey) return null;

    const routeData = loaderData[routeKey];
    const l = routeData?.oldData?.listing;
    if (!l) return null;

    const dealerInfo = routeData?.oldData?.dealerInfo
                    || routeData?.data?.dealerInfo
                    || null;

    const seller = routeData?.oldData?.seller || null;
    const vin    = (!l.isFakeVIN && !l.isInvalidVin && l.vin) ? l.vin : scanPageForVin();

    return {
      currency:     'USD',
      name:         l.listingTitleOnly || _buildName({ year: l.year, make: l.makeName, model: l.modelName, trim: l.trimName }),
      make:         l.makeName         || null,
      model:        l.modelName        || null,
      trim:         l.trimName         || null,
      year:         l.year             || null,
      vin,
      price:        l.price            || null,
      mileage:      l.mileage          || null,
      mileageUnit:  'mi',
      condition:    _mapCondition(l.listingCondition || l.vehicleCondition),
      fuelType:     l.localizedFuelType       || null,
      transmission: l.localizedTransmission   || null,
      colour:       l.localizedExteriorColor  || null,
      driveTrain:   l.localizedDriveTrain     || null,
      cityMpg:      l.cityFuelEconomy?.value   || null,
      hwyMpg:       null,
      dealRating:   l.dealRatingKey           || null,
      dealerName:   seller?.name || null,
      location:     _formatLocation(seller),
    };
  } catch (e) { return null; }
}

// ---- Helpers ----
function _buildName({ year, make, model, trim } = {}) {
  return [year, make, model, trim].filter(Boolean).join(' ') || null;
}

function _mapCondition(raw) {
  if (!raw) return null;
  const map = { NORMAL: 'used', CERTIFIED: 'certified', NEW: 'new' };
  return map[String(raw).toUpperCase()] || 'used';
}

function _formatLocation(seller) {
  return seller?.address?.cityRegion
      || (seller?.address?.city && seller?.address?.region ? `${seller.address.city}, ${seller.address.region}` : null)
      || seller?.address?.postalCode
      || null;
}

window.__siteExtractFn = extractCarGurus;
