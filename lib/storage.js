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
//   source,        // 'cargurus' | 'autotrader' | 'cars_com'
//   savedAt,
//
//   // 車輛資訊
//   name,          // "2020 Toyota Camry LE"
//   make, model, year, trim,
//   vin,
//   price,         // USD
//   mileage,       // miles
//   condition,     // 'used' | 'certified' | 'new'
//
//   // 地點
//   dealerName,
//   location,      // "Chicago, IL"
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
    price:        data.price   || null,
    mileage:      data.mileage || null,
    condition:    data.condition || null,

    dealerName:   data.dealerName || null,
    location:     data.location   || null,

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
