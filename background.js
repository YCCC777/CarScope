// ============================================================
// CarScope — Background Service Worker
// ============================================================
'use strict';

// ---- 暫存最新 carData（per tab） ----
const tabData = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.action === 'carData') {
    if (tabId) tabData.set(tabId, msg.data);
    return;
  }

  if (msg.action === 'getCarData') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ data: tabData.get(tabs[0]?.id) || null });
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

  // ---- NHTSA VIN Decode ----
  if (msg.action === 'decodeVin') {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(msg.vin)}?format=json`;
    fetch(url)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(e  => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

// tab 關閉時清除暫存
chrome.tabs.onRemoved.addListener((tabId) => tabData.delete(tabId));
