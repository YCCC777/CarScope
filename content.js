// ============================================================
// CarScope — Content Script Entry
// ============================================================
'use strict';

(function () {
  // SPA 頁面延遲等待 JS 渲染
  setTimeout(tryExtract, 1500);

  function tryExtract() {
    const fn = window.__siteExtractFn;
    if (typeof fn !== 'function') return;

    try {
      const result = fn();
      if (result) {
        chrome.runtime.sendMessage({ action: 'carData', data: result });
        updateBadge(result);
      } else {
        chrome.runtime.sendMessage({ action: 'carData', data: null });
        setBadgeError();
      }
    } catch (e) {
      chrome.runtime.sendMessage({ action: 'carData', data: null });
      setBadgeError();
    }
  }

  function updateBadge(data) {
    const text = data?.vin ? '✓' : data?.price ? '$' : '?';
    chrome.runtime.sendMessage({ action: 'setBadge', text, color: '#30C46A' });
  }

  function setBadgeError() {
    chrome.runtime.sendMessage({ action: 'setBadge', text: '!', color: '#FF453A' });
  }
})();
