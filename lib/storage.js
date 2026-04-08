// ============================================================
// CarScope — Storage Utilities
// prefix: car_
// ============================================================
'use strict';

// ---- Saved Cars（收藏清單） ----
function getSavedCars() {
  return new Promise(resolve =>
    chrome.storage.local.get('car_saved', res =>
      resolve(res['car_saved'] || [])
    )
  );
}

function setSavedCars(list) {
  return new Promise(resolve =>
    chrome.storage.local.set({ 'car_saved': list }, resolve)
  );
}

// ---- Car Schema ----
// {
//   id,            // urlToId(url)
//   url,
//   source,        // 'cargurus' | 'autotrader' | 'autotrader_uk' | 'cars_com'
//   savedAt,
//
//   // 車輛資訊
//   name,          // "2020 Toyota Camry LE"
//   make, model, year, trim,
//   vin,           // 17-char VIN (US/EU standard)
//   regPlate,      // UK registration plate, e.g. "AB12 CDE"
//   price,         // number
//   currency,      // 'USD' | 'GBP' (default USD)
//   mileage,       // miles
//   condition,     // 'used' | 'certified' | 'new'
//   fuelType,      // e.g. 'Petrol', 'Diesel', 'Electric'
//   transmission,  // e.g. 'Manual', 'Automatic'
//   colour,
//   bodyType,      // e.g. 'Hatchback', 'SUV'
//
//   // 地點
//   dealerName,
//   location,      // "Chicago, IL" or "Manchester"
//
//   // NHTSA（快取）
//   recalls,       // number | null
//   recallsFetchedAt,
//
//   // 看車管理
//   viewingStatus, // 'unseen' | 'scheduled' | 'seen'
//   viewingNote,
//   viewingRating, // 1-5 | null
//
//   tags,          // string[]
//
//   // 降價追蹤
//   priceHistory,  // [{ price, date }] max 10
// }

// ---- Browsing History（最近 50 筆）----
function getHistory() {
  return new Promise(resolve =>
    chrome.storage.local.get('car_history', res =>
      resolve(res['car_history'] || [])
    )
  );
}

function setHistory(list) {
  return new Promise(resolve =>
    chrome.storage.local.set({ 'car_history': list }, resolve)
  );
}

function makeHistoryEntry(url, source, data) {
  return {
    id:          urlToId(url),
    url,
    source,
    name:        data.name        || null,
    year:        data.year        || null,
    price:       data.price       || null,
    currency:    data.currency    || 'USD',
    mileage:     data.mileage     || null,
    mileageUnit: data.mileageUnit || 'mi',
    location:    data.location    || null,
    bodyType:    data.bodyType    || null,
    visitedAt:   new Date().toISOString(),
  };
}

function urlToId(url) {
  // djb2 hash
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h) ^ url.charCodeAt(i);
    h = h >>> 0;
  }
  return String(h);
}

function makeCar(url, source, data) {
  return {
    id:           urlToId(url),
    url,
    source,
    savedAt:      new Date().toISOString(),

    name:         data.name    || null,
    make:         data.make    || null,
    model:        data.model   || null,
    year:         data.year    || null,
    trim:         data.trim    || null,
    vin:          data.vin     || null,
    regPlate:     data.regPlate || null,
    price:        data.price   || null,
    currency:     data.currency || 'USD',
    mileage:      data.mileage || null,
    condition:    data.condition || null,
    fuelType:      data.fuelType      || null,
    transmission:  data.transmission  || null,
    colour:        data.colour        || null,
    interiorColour:data.interiorColour|| null,
    bodyType:      data.bodyType      || null,
    engine:        data.engine        || null,
    combinedMpg:   data.combinedMpg   || null,
    mileageUnit:  data.mileageUnit  || 'mi',
    powerKw:      data.powerKw      || null,
    powerHp:      data.powerHp      || null,
    displacement: data.displacement || null,
    driveTrain:   data.driveTrain   || null,
    dealRating:        data.dealRating        || null,
    dealerRating:      data.dealerRating      || null,
    dealerReviewCount: data.dealerReviewCount || null,
    dealerRecommend:   data.dealerRecommend   || null,
    huDate:       data.huDate       || null,

    dealerName:   data.dealerName   || null,
    dealerPhone:  data.dealerPhone  || null,
    location:     data.location     || null,

    recalls:          null,
    recallsFetchedAt: null,

    viewingStatus: 'unseen',
    viewingNote:   '',
    viewingRating: null,

    tags: [],

    priceHistory: data.price
      ? [{ price: data.price, date: new Date().toISOString().slice(0, 10) }]
      : [],
  };
}
