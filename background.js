// ============================================================
// CarScope — Background Service Worker
// ============================================================
'use strict';

// ---- 暫存最新 carData（per tab，用 storage.session 避免 SW 被掛起時資料遺失） ----
function _tabKey(tabId) { return `car_tab_${tabId}`; }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.action === 'carData') {
    if (tabId) chrome.storage.session.set({ [_tabKey(tabId)]: msg.data });
    return;
  }

  if (msg.action === 'getCarData') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const key = _tabKey(tabs[0]?.id);
      chrome.storage.session.get(key, (res) => {
        sendResponse({ data: res[key] || null });
      });
    });
    return true;
  }

  if (msg.action === 'setBadge') {
    if (tabId) {
      chrome.action.setBadgeText({ text: msg.text || '', tabId });
      chrome.action.setBadgeBackgroundColor({ color: msg.color || '#888', tabId });
    }
    return;
  }

  // ---- NHTSA Recalls（CORS proxy） ----
  if (msg.action === 'fetchRecalls') {
    const { make, model, year } = msg;
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
    fetch(url)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(e  => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ---- NHTSA Complaints ----
  if (msg.action === 'fetchComplaints') {
    const { make, model, year } = msg;
    const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
    fetch(url)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(e  => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ---- NHTSA VIN Decode ----
  if (msg.action === 'decodeVin') {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(msg.vin)}?format=json`;
    fetch(url)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(e  => sendResponse({ success: false, error: e.message }));
    return true;
  }


  if (msg.action === 'triggerPriceRefresh') {
    refreshAllPricesBackground();
    sendResponse({ ok: true });
    return;
  }
});

// tab 關閉時清除暫存
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(_tabKey(tabId));
});

// ============================================================
// Price refresh — background (alarm + manual trigger)
// ============================================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('priceRefresh', { periodInMinutes: 1440 }); // 24h
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'priceRefresh') refreshAllPricesBackground();
});

let _refreshRunning = false;

function _waitForTabLoad(tabId, timeout = 12000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        setTimeout(resolve, 2000); // wait for JS hydration
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function refreshAllPricesBackground() {
  if (_refreshRunning) return;
  _refreshRunning = true;
  try {
    const { car_saved: savedList = [] } = await chrome.storage.local.get('car_saved');
    const cars = savedList.filter(c => c.url && /cargurus\.com|cargurus\.ca/.test(c.url));
    if (cars.length === 0) return;

    let updated = 0;
    const priceDrops = [];
    for (let i = 0; i < cars.length; i++) {
      chrome.runtime.sendMessage({ action: 'refreshProgress', current: i + 1, total: cars.length }).catch(() => {});
      let tab;
      try {
        tab = await chrome.tabs.create({ url: cars[i].url, active: false });
        await _waitForTabLoad(tab.id);
        const [inj] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            try {
              const loaderData = window.__remixContext?.state?.loaderData;
              if (!loaderData) return null;
              const routeKey = Object.keys(loaderData).find(k => /details\.\$/.test(k));
              const d = routeKey && loaderData[routeKey];
              const l = d?.oldData?.listing;
              const s = d?.oldData?.seller;
              if (!l?.price) return null;
              return {
                price:      l.price,
                location:   s?.address?.cityRegion
                            || (s?.address?.city && s?.address?.region ? `${s.address.city}, ${s.address.region}` : null)
                            || s?.address?.postalCode
                            || null,
                dealRating: l.dealRatingKey || null,
              };
            } catch(e) { return null; }
          },
        });
        const res = inj?.result;
        if (res?.price) {
          const idx = savedList.findIndex(c => c.id === cars[i].id);
          if (idx >= 0) {
            const h    = savedList[idx].priceHistory || [];
            const last = h.length ? h[h.length - 1].price : null;
            if (last !== res.price) {
              if (last && res.price < last) {
                priceDrops.push({
                  name:     savedList[idx].name || 'A saved car',
                  oldPrice: last,
                  newPrice: res.price,
                  url:      savedList[idx].url,
                });
              }
              h.push({ price: res.price, date: new Date().toISOString().slice(0, 10) });
              if (h.length > 10) h.shift();
              savedList[idx].priceHistory = h;
              savedList[idx].price = res.price;
            }
            if (!savedList[idx].location   && res.location)   savedList[idx].location   = res.location;
            if (!savedList[idx].dealRating && res.dealRating) savedList[idx].dealRating = res.dealRating;
            updated++;
          }
        }
      } catch(e) { console.warn('[CarScope] refresh error:', cars[i].name, e.message); }
      if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
    }

    await chrome.storage.local.set({
      car_saved:        savedList,
      car_lastRefresh:  new Date().toISOString(),
    });
    chrome.runtime.sendMessage({ action: 'refreshDone', updated, total: cars.length }).catch(() => {});

    // Price drop notifications (respect user toggle)
    const { car_notificationsEnabled = true } = await chrome.storage.local.get('car_notificationsEnabled');
    if (priceDrops.length > 0 && car_notificationsEnabled) {
      const fmt = n => '$' + n.toLocaleString('en-US');
      const body = priceDrops.length === 1
        ? `${priceDrops[0].name}: ${fmt(priceDrops[0].oldPrice)} → ${fmt(priceDrops[0].newPrice)}`
        : priceDrops.map(d => `${d.name.split(' ').slice(0, 3).join(' ')}: ${fmt(d.oldPrice)} → ${fmt(d.newPrice)}`).join('\n');
      chrome.notifications.create('price-drop-' + Date.now(), {
        type:    'basic',
        iconUrl: 'imag/icon48.png',
        title:   `🚗 Price Drop${priceDrops.length > 1 ? 's' : ''} — CarScope`,
        message: body,
        priority: 1,
      });
    }
  } finally {
    _refreshRunning = false;
  }
}
