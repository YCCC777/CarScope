// ============================================================
// CarScope — AutoScout24 Extractor
// 目標：www.autoscout24.com/offers/*
// 資料策略：
//   A. __NEXT_DATA__.props.pageProps.listingDetails（最豐富）
//   B. JSON-LD Product > offers.itemOffered（Car 型別，fallback）
// ============================================================
'use strict';

function extractAutoScout24() {
  if (!location.hostname.includes('autoscout24.com')) return null;
  if (!location.pathname.startsWith('/offers/')) return null;

  // ---- Strategy A: __NEXT_DATA__ ----
  const next = _extractFromNextData();
  if (next) return { source: 'autoscout24', strategy: 'next', ...next };

  // ---- Strategy B: JSON-LD ----
  const jsonld = _extractFromAS24JsonLd();
  if (jsonld) return { source: 'autoscout24', strategy: 'jsonld', ...jsonld };

  return null;
}

// ---- Strategy A ----
function _extractFromNextData() {
  try {
    const listing = window.__NEXT_DATA__?.props?.pageProps?.listingDetails;
    if (!listing) return null;

    const v = listing.vehicle;
    if (!v) return null;

    // Currency from JSON-LD (cleaner than parsing formatted string)
    const currency = _getCurrencyFromJsonLd() || 'EUR';
    // Price: parse from priceFormatted "€ 2,740" → 2740
    const price = _parsePriceFormatted(listing.price?.priceFormatted);

    // Year from firstRegistrationDateRaw "2001-05-01"
    const year = v.firstRegistrationDateRaw
      ? parseInt(v.firstRegistrationDateRaw.slice(0, 4), 10) || null
      : null;

    // HU (Hauptuntersuchung = German MOT) date from trim string
    // e.g. "Kompressor KLIMA SHZ LEDER HU/AU 12.2027" → "12/2027"
    const huMatch = (v.modelVersionInput || '').match(/HU\/AU\s+(\d{1,2})[./](\d{4})/i);
    const huDate  = huMatch ? `${huMatch[1]}/${huMatch[2]}` : null;

    // Dealer rating
    const r = listing.ratings;

    return {
      name:              [v.make, v.model, v.modelVersionInput].filter(Boolean).join(' ').replace(/\s+/g, ' '),
      make:              v.make              || null,
      model:             v.model             || null,
      modelGroup:        v.modelGroup        || null,
      trim:              v.modelVersionInput  || null,
      year,
      price,
      currency,
      mileage:           v.mileageInKmRaw    || null,
      mileageUnit:       'km',
      bodyType:          v.bodyType          || null,
      colour:            v.bodyColor         || null,
      paintType:         v.paintType         || null,
      transmission:      v.transmissionType  || null,
      fuelType:          v.fuelCategory?.formatted || v.primaryFuel?.formatted || null,
      powerKw:           v.rawPowerInKw      || null,
      powerHp:           v.rawPowerInHp      || null,
      displacement:      v.rawDisplacementInCCM || null,
      driveTrain:        v.driveTrain        || null,
      doors:             v.numberOfDoors     || null,
      seats:             v.numberOfSeats     || null,
      upholstery:        v.upholstery        || null,
      vin:               null, // AutoScout24 does not expose VIN
      dealerName:        listing.seller?.name  || null,
      dealerRating:      r?.ratingsStars       || null,
      dealerReviewCount: r?.ratingsCount        || null,
      dealerRecommend:   r?.recommendPercentage || null,
      location:          _formatLocation(listing),
      huDate,            // German TÜV/HU expiry — null for non-DE listings
      condition:         listing.isNew ? 'new' : 'used',
    };
  } catch (e) { return null; }
}

// ---- Strategy B: JSON-LD ----
// AutoScout24 JSON-LD: Product > offers.itemOffered (Car)
function _extractFromAS24JsonLd() {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      if (data['@type'] !== 'Product') continue;

      const car    = data.offers?.itemOffered;
      const dealer = data.offers?.offeredBy;
      if (!car || !/Car|Vehicle/i.test(car['@type'] || '')) continue;

      const engine = Array.isArray(car.vehicleEngine)
        ? car.vehicleEngine[0]
        : car.vehicleEngine || null;

      const mileageRaw  = car.mileageFromOdometer?.value    || null;
      const mileageUnit = car.mileageFromOdometer?.unitText === 'KMT' ? 'km' : 'mi';

      return {
        name:         car.name         || null,
        make:         car.manufacturer  || null,
        model:        car.model         || null,
        year:         car.productionDate ? parseInt(car.productionDate.slice(0, 4), 10) || null : null,
        price:        data.offers?.price ? parseFloat(data.offers.price) : null,
        currency:     data.offers?.priceCurrency || 'EUR',
        mileage:      mileageRaw ? parseInt(String(mileageRaw).replace(/[^0-9]/g, ''), 10) : null,
        mileageUnit,
        bodyType:     car.bodyType           || null,
        colour:       car.color              || null,
        transmission: car.vehicleTransmission || null,
        fuelType:     engine?.fuelType        || null,
        powerKw:      _extractPower(engine, 'KWT'),
        powerHp:      _extractPower(engine, 'BHP'),
        displacement: engine?.engineDisplacement?.value || null,
        driveTrain:   car.driveWheelConfiguration || null,
        doors:        car.numberOfDoors      || null,
        seats:        car.seatingCapacity    || null,
        dealerName:   dealer?.name           || null,
        location:     dealer?.address
          ? `${dealer.address.addressLocality}, ${dealer.address.addressCountry}`
          : null,
      };
    } catch (e) {}
  }
  return null;
}

// ---- Helpers ----

function _parsePriceFormatted(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.,]/g, '').replace(/\.(?=.*,)/, '').replace(',', '.'));
  return isNaN(n) || n <= 0 ? null : n;
}

function _getCurrencyFromJsonLd() {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent);
      if (d.offers?.priceCurrency) return d.offers.priceCurrency;
    } catch (e) {}
  }
  return null;
}

function _formatLocation(listing) {
  try {
    const loc  = listing.location  || {};
    const sell = listing.seller    || {};
    const city    = loc.city    || sell.city    || null;
    const country = loc.country || sell.country || null;
    const zip     = loc.zip     || sell.zip     || null;
    const parts = [city, country].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  } catch (e) { return null; }
}

function _extractPower(engine, unitCode) {
  if (!engine?.enginePower) return null;
  const arr = Array.isArray(engine.enginePower) ? engine.enginePower : [engine.enginePower];
  const match = arr.find(p => p.unitCode === unitCode);
  return match?.value || null;
}

window.__siteExtractFn = extractAutoScout24;
