// ============================================================
// CarScope — Popup Script
// ============================================================
'use strict';

let ui          = null;
let currentData = null;
let currentUrl  = '';
let savedList   = [];
let recallsFetched    = false;
let complaintsFetched = false;
let vinDecodeFetched  = false;
let savedBodyFilter   = 'ALL';
let compareList       = []; // car IDs, max 3
let historyList       = []; // lightweight history entries, max 50
let historyExpanded   = false;
let _costDownPct      = 20;   // %
let _costMonths       = 60;
let _costApr          = 7;    // %

// ============================================================
// Init
// ============================================================
async function init() {
  ui = getUiStrings();
  setupTabs();

  savedList = await getSavedCars();
  historyList = await getHistory();
  // Restore compare list from session storage (persists while browser session is open)
  const sess = await chrome.storage.session.get('car_compareList');
  compareList = (sess.car_compareList || []).filter(id => savedList.some(c => c.id === id));

  document.getElementById('btn-refresh-prices')?.addEventListener('click', refreshAllPrices);
  document.getElementById('btn-share-shortlist')?.addEventListener('click', shareShortlist);
  document.getElementById('btn-history-toggle')?.addEventListener('click', toggleHistory);
  document.getElementById('btn-history-clear')?.addEventListener('click', clearHistory);
  document.getElementById('btn-settings')?.addEventListener('click', openSettings);
  document.getElementById('btn-settings-close')?.addEventListener('click', closeSettings);
  document.getElementById('footer-brand')?.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('about.html') });
  });
  setupSectionToggle('btn-checklist-toggle', 'checklist-body', 'checklist-arrow');
  document.getElementById('btn-export-data')?.addEventListener('click', exportData);
  document.getElementById('btn-clear-saved')?.addEventListener('click', clearAllSaved);
  document.getElementById('btn-clear-hist-s')?.addEventListener('click', clearHistory);
  document.getElementById('toggle-notifications')?.addEventListener('change', onNotificationsToggle);
  initSettings();

  await queryActiveTab();
  renderSavedList();
  renderCompare();
  renderHistory();
}

// ============================================================
// Query active tab
// ============================================================
async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentUrl = tab.url || '';

  const isSupportedSite = /cargurus\.com|cargurus\.ca|autotrader\.com|autotrader\.co\.uk|autoscout24\.com/.test(currentUrl);
  if (!isSupportedSite) {
    setStatus('error', 'Not a supported listing page');
    show('not-listing');
    hide('info-section');
    return;
  }

  // CarGurus: __remixContext is in MAIN world — isolated world auto-inject only gets
  // VIN scan fallback. Always inject directly in MAIN world and get data via return value.
  if (/cargurus\.com|cargurus\.ca/.test(currentUrl)) {
    _extractCarGurusMain(tab.id);
    return;
  }

  // Other sites: try background cache first, then re-inject in isolated world
  chrome.runtime.sendMessage({ action: 'getCarData' }, async (resp) => {
    const data = resp?.data;
    if (data) {
      handleCarData(data);
    } else {
      try {
        const extractorFile = _getExtractorFile(currentUrl);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['extractors/base.js', extractorFile, 'content.js'],
        });
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'getCarData' }, (r) => {
            if (r?.data) handleCarData(r.data);
            else         handleNoData();
          });
        }, 1200);
      } catch (e) {
        handleNoData();
      }
    }
  });
}

function _getExtractorFile(url) {
  if (url.includes('cargurus.com'))     return 'extractors/cargurus.js';
  if (url.includes('autotrader.co.uk')) return 'extractors/autotrader_uk.js';
  if (url.includes('autoscout24.com'))  return 'extractors/autoscout24.js';
  if (url.includes('autotrader.com'))   return 'extractors/autotrader.js';
  return 'extractors/cargurus.js';
}

async function _extractCarGurusMain(tabId) {
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          // ---- Strategy A: __remixContext ----
          const loaderData = window.__remixContext?.state?.loaderData;
          if (loaderData) {
            const routeKey = Object.keys(loaderData).find(k =>
              k.includes('details.$listingId') || k.includes('details.$id') || /details\.\$/.test(k)
            );
            const routeData = routeKey && loaderData[routeKey];
            const l = routeData?.oldData?.listing;
            if (l) {
              const seller = routeData?.oldData?.seller || null;
              const vin = (!l.isFakeVIN && !l.isInvalidVin && l.vin) ? l.vin : null;
              const condMap = { NORMAL: 'used', CERTIFIED: 'certified', NEW: 'new' };

              // Parse listingDetailStatsSectionDto into flat key→{d,v} map
              const _sm = {};
              if (Array.isArray(l.listingDetailStatsSectionDto)) {
                for (const cat of l.listingDetailStatsSectionDto) {
                  for (const item of (cat.items || [])) {
                    if (item.key) _sm[item.key] = { d: item.displayValue ?? null, v: item.value ?? null };
                  }
                }
              }


              return {
                source: 'cargurus', strategy: 'remix', currency: 'USD',
                name:         l.listingTitleOnly || [l.year, l.makeName, l.modelName, l.trimName].filter(Boolean).join(' ') || null,
                make:         l.makeName         || null,
                model:        l.modelName        || null,
                trim:         l.trimName         || null,
                year:         l.year             || null,
                vin,
                price:        l.price            || null,
                mileage:      l.mileage          || null,
                mileageUnit:  'mi',
                condition:    condMap[String(l.listingCondition || l.vehicleCondition || '').toUpperCase()] || 'used',
                fuelType:     l.localizedFuelType       || null,
                transmission: l.localizedTransmission   || null,
                colour:        _sm.exteriorColor?.d  || l.localizedExteriorColor || null,
                interiorColour:_sm.interiorColor?.d  || l.localizedInteriorColor || null,
                driveTrain:    _sm.drivetrain?.d     || l.localizedDriveTrain   || null,
                engine:        _sm.engine?.d         || l.localizedEngineDisplayName || null,
                bodyType:      _sm.bodyType?.d       || null,
                cityMpg:       _sm.cityFuelEconomy?.d    || l.cityFuelEconomy?.value       || null,
                hwyMpg:        _sm.highwayFuelEconomy?.d || null,
                combinedMpg:   _sm.combinedFuelEconomy?.d || l.localizedCombinedFuelEconomy || null,
                dealRating:    l.dealRatingKey                        || null,
                dealerName:    seller?.name                           || null,
                dealerPhone:   seller?.phoneNumberString              || null,
                location:      seller?.address?.cityRegion
                               || (seller?.address?.city && seller?.address?.region ? `${seller.address.city}, ${seller.address.region}` : null)
                               || seller?.address?.postalCode
                               || null,
                priceDifferential: l.priceDifferential || null,
                expectedPrice: l.expectedPrice        || null,
                savedCount:    l.savedCount            || null,
              };
            }
          }

          // ---- Strategy B: VIN scan fallback ----
          const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
          let vin = null;
          for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const m = VIN_RE.exec(JSON.stringify(JSON.parse(s.textContent)));
              if (m) { vin = m[1].toUpperCase(); break; }
            } catch (_) {}
            VIN_RE.lastIndex = 0;
          }
          if (!vin) {
            const m = VIN_RE.exec(document.body?.innerText || '');
            if (m) vin = m[1].toUpperCase();
          }
          const name = document.querySelector('h1')?.textContent?.trim() || null;
          if (vin || name) {
            return { source: 'cargurus', strategy: 'vin-scan', currency: 'USD', vin, name, price: null, mileage: null, year: null, make: null, model: null };
          }

          return { _debug: { hasRemix: !!window.__remixContext, url: location.pathname } };
        } catch (e) {
          return { _error: e.message };
        }
      },
    });

    const result = inj?.result;
    if (result?._error) { console.error('[CarScope] extraction error:', result._error); handleNoData(); return; }
    if (result?._debug) { console.warn('[CarScope] no data found, debug:', result._debug); handleNoData(); return; }
    if (result) {
      chrome.runtime.sendMessage({ action: 'carData', data: result });
      handleCarData(result);
    } else {
      handleNoData();
    }
  } catch (e) {
    console.error('[CarScope] executeScript failed:', e);
    handleNoData();
  }
}

// ============================================================
// Handle extracted car data
// ============================================================
function handleCarData(data) {
  if (!data) { handleNoData(); return; }
  currentData = data;

  setStatus('ok', '');
  hide('not-listing');
  show('vehicle-info');

  // Source badge
  const badge = document.getElementById('source-badge');
  if (badge) badge.textContent = _sourceLabel(data.source);

  // Condition badge
  if (data.condition) {
    const cb = document.getElementById('condition-badge');
    if (cb) { cb.textContent = data.condition; show('condition-badge'); }
  }

  // Car name + dealer/location/phone subtitle
  setText('car-name', data.name || 'Unknown Vehicle');
  const dealerEl   = document.getElementById('dealer-info');
  const dealerText = [data.dealerName, data.location].filter(Boolean).join(' · ');
  if (dealerEl && (dealerText || data.dealerPhone)) {
    dealerEl.innerHTML = dealerText
      ? `📍 ${dealerText}${data.dealerPhone ? ` · <a href="tel:${data.dealerPhone.replace(/\D/g,'')}\" class=\"dealer-phone\">${data.dealerPhone}</a>` : ''}`
      : `<a href="tel:${data.dealerPhone.replace(/\D/g,'')}" class="dealer-phone">${data.dealerPhone}</a>`;
    show('dealer-info');
  } else {
    hide('dealer-info');
  }

  // Specs chips
  renderSpecs(data);

  // Refresh saved car: backfill missing fields + track price change
  _refreshSavedCar(data);

  // Save button state
  updateSaveButton();

  // Link-out buttons
  setupLinkOuts(data);

  // UK: reg plate input（先嘗試從 storage 補回上次填的車牌）
  if (data.source === 'autotrader_uk') {
    show('reg-plate-row');
    const regKey = `reg_${urlToId(currentUrl)}`;
    chrome.storage.local.get(regKey, (res) => {
      if (res[regKey] && !currentData.regPlate) {
        currentData.regPlate = res[regKey];
      }
      setupRegPlateInput(data);
    });
  }

  // Show recall + complaints sections if make/model/year available
  if (data.make && data.model && data.year) {
    show('section-recalls');
    setupRecallsToggle(data);
    show('section-complaints');
    setupComplaintsToggle(data);
  }

  // Show VIN section if VIN available
  if (data.vin) {
    show('section-vin');
    setupVinToggle(data.vin);
  }

  // MAIN world fallback for missing data
  if (!data.make || !data.model) {
    fetchCarDetailsMain();
  }

  // Monthly cost estimate (shown when price available)
  if (data.price) {
    show('section-cost');
    setupSectionToggle('btn-cost-toggle', 'cost-body', 'cost-arrow', () => renderCostEstimate(data));
  }

  // Log to browsing history
  _logHistory(data);
}

function _refreshSavedCar(data) {
  if (!data.price) return;
  const id  = urlToId(currentUrl);
  const idx = savedList.findIndex(c => c.id === id);
  if (idx < 0) return; // not saved yet
  const car = savedList[idx];
  let changed = false;

  // Backfill any missing fields from current extraction (fixes old saved cars)
  const backfill = ['location', 'dealerName', 'dealerPhone', 'combinedMpg', 'cityMpg', 'hwyMpg',
                    'bodyType', 'engine', 'driveTrain', 'colour', 'dealRating'];
  for (const f of backfill) {
    if (!car[f] && data[f]) { car[f] = data[f]; changed = true; }
  }

  // Price history
  const history = car.priceHistory || [];
  const lastPrice = history.length ? history[history.length - 1].price : null;
  if (lastPrice !== data.price) {
    history.push({ price: data.price, date: new Date().toISOString().slice(0, 10) });
    if (history.length > 10) history.shift();
    car.priceHistory = history;
    changed = true;
  }

  if (changed) { setSavedCars(savedList); renderSavedList(); }
}

function handleNoData() {
  setStatus('error', 'Could not detect vehicle data');
  show('not-listing');
}

// ============================================================
// Specs rendering
// ============================================================
function renderSpecs(data) {
  const row = document.getElementById('specs-row');
  if (!row) return;
  row.innerHTML = '';

  if (data.price) {
    row.innerHTML += `<span class="spec-chip price">${_formatPrice(data.price, data.currency)}</span>`;
  }
  if (data.mileage) {
    const unit = data.mileageUnit || 'mi';
    const warnThreshold = unit === 'km' ? 160000 : 100000;
    const warn = data.mileage > warnThreshold;
    row.innerHTML += `<span class="spec-chip${warn ? ' warn' : ''}">${data.mileage.toLocaleString()} ${unit}</span>`;
  }
  if (data.year)         row.innerHTML += `<span class="spec-chip">${data.year}</span>`;
  if (data.fuelType)     row.innerHTML += `<span class="spec-chip">${data.fuelType}</span>`;
  if (data.transmission) row.innerHTML += `<span class="spec-chip">${data.transmission}</span>`;
  if (data.driveTrain)   row.innerHTML += `<span class="spec-chip">${data.driveTrain}</span>`;
  if (data.engine)       row.innerHTML += `<span class="spec-chip" title="Engine">${data.engine}</span>`;
  if (data.bodyType)     row.innerHTML += `<span class="spec-chip">${data.bodyType}</span>`;
  if (data.colour)       row.innerHTML += `<span class="spec-chip">${data.colour}</span>`;
  if (data.dealRating) {
    const map = {
      GREAT_DEAL:  { label: '🟢 Great Deal',  cls: 'deal-great' },
      GREAT_PRICE: { label: '🟢 Great Price', cls: 'deal-great' },
      GOOD_DEAL:   { label: '🟢 Good Deal',   cls: 'deal-good'  },
      GOOD_PRICE:  { label: '🟢 Good Price',  cls: 'deal-good'  },
      FAIR_PRICE:  { label: '🟡 Fair Price',  cls: 'deal-fair'  },
      HIGH_PRICE:  { label: '🟠 High Price',  cls: 'deal-high'  },
      OVERPRICED:  { label: '🔴 Overpriced',  cls: 'deal-over'  },
    };
    const d = map[data.dealRating] || {
      label: data.dealRating.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
      cls: 'deal-fair',
    };
    row.innerHTML += `<span class="spec-chip ${d.cls}" title="CarGurus deal rating">${d.label}</span>`;
  }
  if (data.cityMpg && data.hwyMpg) row.innerHTML += `<span class="spec-chip" title="Fuel economy">${data.cityMpg}/${data.hwyMpg} mpg</span>`;
  if (data.dealerRating) {
    const rec = data.dealerRecommend ? ` · ${data.dealerRecommend}% rec` : '';
    row.innerHTML += `<span class="spec-chip dealer-rating" title="Dealer rating">⭐ ${data.dealerRating}${data.dealerReviewCount ? ` (${data.dealerReviewCount})` : ''}${rec}</span>`;
  }
  if (data.huDate) row.innerHTML += `<span class="spec-chip" title="German TÜV/HU expiry">HU ${data.huDate}</span>`;
  if (data.vin)    row.innerHTML += `<span class="spec-chip" title="VIN">VIN: ${data.vin.slice(0,8)}…</span>`;

  if (row.children.length > 0) show('specs-row');
}

// ============================================================
// NHTSA Recalls section
// ============================================================
function setupRecallsToggle(data) {
  const btn  = document.getElementById('btn-recalls-toggle');
  const body = document.getElementById('recalls-body');
  const arrow= document.getElementById('recalls-arrow');
  if (!btn) return;

  btn.onclick = () => {
    const isOpen = body.classList.toggle('hidden');
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
    if (!isOpen && !recallsFetched) {
      recallsFetched = true;
      fetchRecalls(data);
    }
  };
}

function fetchRecalls(data) {
  const content = document.getElementById('recalls-content');
  if (content) content.innerHTML = '<div class="recalls-loading">Checking recalls…</div>';

  chrome.runtime.sendMessage(
    { action: 'fetchRecalls', make: data.make, model: data.model, year: data.year },
    (resp) => {
      if (!content) return;
      if (!resp?.success) {
        content.innerHTML = `<div class="recalls-loading" style="color:var(--danger)">Could not load recall data</div>`;
        return;
      }
      const results = resp.data?.results || [];

      // Persist recall count so Compare tab can show it
      const savedIdx = savedList.findIndex(c => c.id === urlToId(currentUrl));
      if (savedIdx >= 0) {
        savedList[savedIdx].recalls = results.length;
        savedList[savedIdx].recallsFetchedAt = new Date().toISOString();
        setSavedCars(savedList);
      }

      if (results.length === 0) {
        content.innerHTML = `<div class="recalls-ok">✅ No open recalls found for ${data.year} ${data.make} ${data.model}</div>`;
        return;
      }
      content.innerHTML = results.map(r => {
        const campaignLink = r.NHTSACampaignNumber
          ? `<a href="https://www.nhtsa.gov/recalls?nhtsaId=${r.NHTSACampaignNumber}" target="_blank" class="item-link">View on NHTSA ↗</a>`
          : '';
        return `
          <div class="recall-item">
            <div class="recall-component">${r.Component || 'Unknown Component'}</div>
            <div class="recall-summary">${r.Summary || r.Consequence || ''}</div>
            <div class="recall-date">Campaign: ${r.NHTSACampaignNumber || '—'} ${campaignLink}</div>
          </div>`;
      }).join('');
    }
  );
}

// ============================================================
// NHTSA Complaints section
// ============================================================
function setupComplaintsToggle(data) {
  const btn  = document.getElementById('btn-complaints-toggle');
  const body = document.getElementById('complaints-body');
  const arrow= document.getElementById('complaints-arrow');
  if (!btn) return;

  btn.onclick = () => {
    const isOpen = body.classList.toggle('hidden');
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
    if (!isOpen && !complaintsFetched) {
      complaintsFetched = true;
      fetchComplaintsData(data);
    }
  };
}

function fetchComplaintsData(data) {
  const content = document.getElementById('complaints-content');
  if (content) content.innerHTML = '<div class="recalls-loading">Loading complaints…</div>';

  chrome.runtime.sendMessage(
    { action: 'fetchComplaints', make: data.make, model: data.model, year: data.year },
    (resp) => {
      if (!content) return;
      if (!resp?.success) {
        content.innerHTML = `<div class="recalls-loading" style="color:var(--danger)">Could not load complaint data</div>`;
        return;
      }
      const results = resp.data?.results || [];
      const count   = resp.data?.count   || results.length;
      if (results.length === 0) {
        content.innerHTML = `<div class="recalls-ok">✅ No complaints found for ${data.year} ${data.make} ${data.model}</div>`;
        return;
      }
      const label = document.querySelector('#section-complaints .group-label-complaints');
      if (label) label.textContent = `💬 NHTSA Complaints (${count})`;

      content.innerHTML = results.slice(0, 5).map(r => {
        const flags = [
          r.crash    ? '💥 Crash'    : '',
          r.fire     ? '🔥 Fire'     : '',
          r.injuries ? `🤕 ${r.injuries} inj` : '',
          r.deaths   ? `💀 ${r.deaths} death` : '',
        ].filter(Boolean).join(' · ');
        const date = r.dateOfIncident ? String(r.dateOfIncident).slice(0, 4) : '';
        return `
          <div class="recall-item">
            <div class="recall-component">${r.components || r.component || 'Unknown Component'}</div>
            ${flags ? `<div class="complaint-flags">${flags}</div>` : ''}
            <div class="recall-summary">${(r.summary || r.description || '').slice(0, 200)}${(r.summary || r.description || '').length > 200 ? '…' : ''}</div>
            <div class="recall-date">${date ? `Incident: ${date}` : ''}${r.odiNumber ? ` · ODI: ${r.odiNumber}` : ''}</div>
          </div>`;
      }).join('') + (count > 5 ? `<div class="recalls-source" style="margin-top:6px">Showing 5 of ${count} complaints · <a href="https://www.nhtsa.gov/complaints" target="_blank" class="source-link">Search full database on NHTSA.gov ↗</a></div>` : '');
    }
  );
}

// ============================================================
// VIN Decode section
// ============================================================
function setupVinToggle(vin) {
  const btn  = document.getElementById('btn-vin-toggle');
  const body = document.getElementById('vin-body');
  const arrow= document.getElementById('vin-arrow');
  if (!btn) return;

  btn.onclick = () => {
    const isOpen = body.classList.toggle('hidden');
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
    if (!isOpen && !vinDecodeFetched) {
      vinDecodeFetched = true;
      fetchVinDecode(vin);
    }
  };
}

function fetchVinDecode(vin) {
  const content = document.getElementById('vin-content');
  if (content) content.innerHTML = '<div class="vin-loading">Decoding VIN…</div>';

  chrome.runtime.sendMessage({ action: 'decodeVin', vin }, (resp) => {
    if (!content) return;
    if (!resp?.success) {
      content.innerHTML = `<div class="vin-loading" style="color:var(--danger)">Could not decode VIN</div>`;
      return;
    }
    const r = resp.data?.Results?.[0];
    if (!r) { content.innerHTML = '<div class="vin-loading">No data found</div>'; return; }

    const fields = [
      ['Make',         r.Make],
      ['Model',        r.Model],
      ['Model Year',   r.ModelYear],
      ['Trim',         r.Trim],
      ['Body Style',   r.BodyClass],
      ['Drive Type',   r.DriveType],
      ['Engine',       r.DisplacementL ? `${r.DisplacementL}L ${r.FuelTypePrimary || ''}`.trim() : null],
      ['Transmission', r.TransmissionStyle],
      ['Country',      r.PlantCountry],
      ['Manufacturer', r.Manufacturer],
    ].filter(([, v]) => v && v !== 'Not Applicable');

    if (fields.length === 0) {
      content.innerHTML = '<div class="vin-loading">No decoded data available</div>';
      return;
    }

    // Update currentData with decoded make/model if missing
    if (!currentData.make && r.Make) {
      currentData.make  = r.Make;
      currentData.model = r.Model || currentData.model;
      currentData.year  = parseInt(r.ModelYear) || currentData.year;
      renderSpecs(currentData);
      // Now we have make/model/year, show recalls section
      if (!document.getElementById('section-recalls').classList.contains('hidden') === false) {
        show('section-recalls');
        setupRecallsToggle(currentData);
      }
    }

    content.innerHTML = `
      <table class="vin-table">
        ${fields.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
      </table>
    `;
  });
}

// ============================================================
// MAIN world fallback（補抓 make/model）
// ============================================================
function fetchCarDetailsMain() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs?.[0]) return;
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world:  'MAIN',
      func: () => {
        try {
          // CarGurus: data lives in window.__remixContext
          const loaderData = window.__remixContext?.state?.loaderData;
          if (loaderData) {
            const routeKey = Object.keys(loaderData).find(k => k.includes('details.$listingId'));
            const l = routeKey && loaderData[routeKey]?.oldData?.listing;
            if (l) {
              return {
                vin:     l.vin       || null,
                make:    l.makeName  || null,
                model:   l.modelName || null,
                year:    l.year      || null,
                price:   l.price     || null,
                mileage: l.mileage   || null,
              };
            }
          }
          return null;
        } catch (e) { return null; }
      },
    }, (results) => {
      const extra = results?.[0]?.result;
      if (!extra || !currentData) return;
      if (extra.make  && !currentData.make)    currentData.make  = extra.make;
      if (extra.model && !currentData.model)   currentData.model = extra.model;
      if (extra.year  && !currentData.year)    currentData.year  = extra.year;
      if (extra.price && !currentData.price)   currentData.price = extra.price;
      if (extra.mileage && !currentData.mileage) currentData.mileage = extra.mileage;
      if (extra.vin   && !currentData.vin)     currentData.vin   = extra.vin;
      renderSpecs(currentData);
      if (currentData.make && currentData.model && currentData.year) {
        show('section-recalls');
        setupRecallsToggle(currentData);
      }
    });
  });
}

// ============================================================
// Link-out buttons
// ============================================================
function setupLinkOuts(data) {
  const isUK = data.source === 'autotrader_uk';

  if (isUK) {
    _setLinkBtn('btn-link1', 'MOT History', () => {
      // Read input field directly so user doesn't need to press ✓ first
      const inputVal = document.getElementById('input-reg-plate')?.value?.trim() || '';
      const reg = (inputVal || currentData?.regPlate || '').replace(/\s/g, '');
      openUrl(reg
        ? `https://www.check-mot.service.gov.uk/?registration=${encodeURIComponent(reg)}`
        : 'https://www.check-mot.service.gov.uk/');
    });
    _setLinkBtn('btn-link2', 'Car History', () => {
      // HPI Check: finance lien, stolen, write-off category — most important pre-purchase check in UK
      openUrl('https://www.hpicheck.com/');
    });
    _setLinkBtn('btn-link3', 'Market Value', () => {
      // Motorway: free instant valuation by reg plate
      const inputVal = document.getElementById('input-reg-plate')?.value?.trim() || '';
      const reg = (inputVal || currentData?.regPlate || '').replace(/\s/g, '');
      openUrl(reg
        ? `https://www.motorway.co.uk/car-valuation/?reg=${encodeURIComponent(reg)}`
        : 'https://www.motorway.co.uk/car-valuation/');
    });
  } else if (data.source === 'autoscout24') {
    _setLinkBtn('btn-link1', 'Car History', () => {
      // Carvertical: European VIN-based history check
      openUrl('https://www.carvertical.com/');
    });
    _setLinkBtn('btn-link2', 'EU Recalls', () => {
      // Official EU recall portal
      openUrl('https://www.vehicle-recalls.eu/');
    });
    _setLinkBtn('btn-link3', 'Similar Cars', () => {
      // Search AutoScout24 for same make/model
      if (data.make && data.model) {
        const make  = encodeURIComponent(data.make.toLowerCase().replace(/\s+/g, '-'));
        const model = encodeURIComponent(data.model.toLowerCase().replace(/\s+/g, '-'));
        openUrl(`https://www.autoscout24.com/lst/${make}/${model}`);
      } else {
        openUrl('https://www.autoscout24.com/');
      }
    });
  } else {
    // CarGurus / AutoTrader.com (US)
    _setLinkBtn('btn-link1', 'CARFAX', () => {
      if (data.vin) openUrl(`https://www.carfax.com/vehicle/${data.vin}`);
      else          openUrl('https://www.carfax.com/');
    });
    _setLinkBtn('btn-link2', 'KBB Value', () => {
      if (data.make && data.model && data.year)
        openUrl(`https://www.kbb.com/${encodeURIComponent(data.make.toLowerCase())}/${encodeURIComponent(data.model.toLowerCase())}/${data.year}/`);
      else openUrl('https://www.kbb.com/');
    });
    _setLinkBtn('btn-link3', 'Edmunds', () => {
      if (data.make && data.model && data.year)
        openUrl(`https://www.edmunds.com/${encodeURIComponent(data.make.toLowerCase())}/${encodeURIComponent(data.model.toLowerCase())}/${data.year}/`);
      else openUrl('https://www.edmunds.com/');
    });
  }
}

function _setLinkBtn(id, label, handler) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.textContent = label;
  btn.onclick = handler;
}

// ============================================================
// Reg plate input（UK only）
// ============================================================
function setupRegPlateInput(data) {
  const input = document.getElementById('input-reg-plate');
  const btn   = document.getElementById('btn-reg-save');
  if (!input || !btn) return;

  input.value = currentData.regPlate || data.regPlate || '';

  const save = () => {
    const raw = input.value.trim().toUpperCase().replace(/\s+/g, '');
    const plate = /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(raw)
      ? `${raw.slice(0, 4)} ${raw.slice(4)}`
      : raw || null;

    currentData.regPlate = plate;
    input.value = plate || '';

    // 持久化到 storage.local（per listing）
    const regKey = `reg_${urlToId(currentUrl)}`;
    if (plate) chrome.storage.local.set({ [regKey]: plate });
    else        chrome.storage.local.remove(regKey);

    // 如果已 save，同步更新 savedList
    const idx = savedList.findIndex(c => c.id === urlToId(currentUrl));
    if (idx >= 0) {
      savedList[idx].regPlate = plate;
      setSavedCars(savedList);
    }
  };

  btn.onclick = save;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

// ============================================================
// Save / unsave
// ============================================================
function updateSaveButton() {
  const id  = urlToId(currentUrl);
  const btn = document.getElementById('btn-save');
  if (!btn) return;
  const isSaved = savedList.some(c => c.id === id);
  btn.classList.toggle('is-saved', isSaved);
  document.getElementById('label-save').textContent = isSaved ? 'Saved ✓' : 'Save';
  btn.onclick = handleSaveToggle;
}

async function handleSaveToggle() {
  if (!currentData) return;
  const id = urlToId(currentUrl);
  const idx = savedList.findIndex(c => c.id === id);
  if (idx >= 0) {
    savedList.splice(idx, 1);
  } else {
    savedList.push(makeCar(currentUrl, currentData.source, currentData));
  }
  await setSavedCars(savedList);
  updateSaveButton();
  renderSavedList();
}

// ============================================================
// Saved list rendering
// ============================================================
function renderSavedList() {
  const list  = document.getElementById('saved-list');
  const empty = document.getElementById('saved-empty');
  if (!list) return;

  const filter = document.querySelector('#saved-filter-bar .filter-pill.active')?.dataset.filter || 'ALL';

  // Body style filter — dynamic pills (only if 2+ distinct types)
  const bodyTypes = [...new Set(savedList.map(c => c.bodyType).filter(Boolean))];
  const bodyBar = document.getElementById('saved-body-filter-bar');
  if (bodyBar) {
    if (bodyTypes.length >= 2) {
      bodyBar.innerHTML = ['ALL', ...bodyTypes].map(bt =>
        `<button class="filter-pill body-pill${bt === savedBodyFilter ? ' active' : ''}" data-body="${bt}">${bt === 'ALL' ? 'All Types' : bt}</button>`
      ).join('');
      bodyBar.classList.remove('hidden');
      bodyBar.onclick = (e) => {
        const pill = e.target.closest('[data-body]');
        if (!pill) return;
        savedBodyFilter = pill.dataset.body;
        renderSavedList();
      };
    } else {
      bodyBar.classList.add('hidden');
      savedBodyFilter = 'ALL';
    }
  }

  const filtered = savedList.filter(c =>
    (filter === 'ALL'           || c.viewingStatus === filter) &&
    (savedBodyFilter === 'ALL'  || c.bodyType === savedBodyFilter)
  );

  if (filtered.length === 0) {
    list.innerHTML = '';
    show('saved-empty');
    return;
  }
  hide('saved-empty');

  list.innerHTML = filtered.map(car => {
    const stars = [1,2,3,4,5].map(i =>
      `<span class="star${(car.viewingRating||0) >= i ? ' filled' : ''}" data-rating="${i}" data-id="${car.id}">★</span>`
    ).join('');
    const hint = [
      car.viewingRating ? '★'.repeat(car.viewingRating) : '',
      car.viewingNote   ? '📝' : '',
    ].filter(Boolean).join(' ');

    const activeTags = car.tags || [];
    const tagChips = PRESET_TAGS.map(t =>
      `<button class="tag-chip${activeTags.includes(t.label) ? ' active' : ''}" data-action="tag" data-id="${car.id}" data-tag="${t.label}">${t.label}</button>`
    ).join('');

    return `
    <div class="saved-card" data-id="${car.id}">
      <div class="saved-card-header">
        <label class="cmp-checkbox" title="Add to Compare">
          <input type="checkbox" ${compareList.includes(car.id) ? 'checked' : ''} data-action="compare-check" data-id="${car.id}">
        </label>
        <div class="saved-card-name">${car.name || 'Unknown Vehicle'}</div>
        <button class="status-pill status-${car.viewingStatus}" data-action="status" data-id="${car.id}">${_statusLabel(car.viewingStatus)}</button>
        <button class="card-del-quick" data-action="delete" data-id="${car.id}" title="Delete">×</button>
      </div>
      <div class="saved-card-meta">
        ${car.price   ? `<span class="saved-card-price">${_formatPrice(car.price, car.currency)}</span>` : ''}
        ${(() => {
          const h = car.priceHistory || [];
          if (h.length < 2) return '';
          const diff = h[h.length-1].price - h[h.length-2].price;
          if (!diff) return '';
          const cls = diff < 0 ? 'price-drop' : 'price-rise';
          const sym = diff < 0 ? '↓' : '↑';
          return `<span class="${cls}">${sym}$${Math.abs(diff).toLocaleString()}</span>`;
        })()}
        ${car.mileage ? `<span>${car.mileage.toLocaleString()} ${car.mileageUnit || 'mi'}</span>` : ''}
        ${car.year    ? `<span>${car.year}</span>` : ''}
        ${car.location ? `<span>📍 ${car.location}</span>` : ''}
        <button class="card-meta-open" data-action="open" data-id="${car.id}" title="Open listing">↗</button>
      </div>
      <button class="card-expand-btn" data-action="expand" data-id="${car.id}">${hint || '···'}</button>
      <div class="card-expand-area hidden" id="expand-${car.id}">
        ${(() => {
          const h = car.priceHistory || [];
          if (h.length < 2) return '';
          const items = h.slice(-5).map((e, i, arr) => {
            const prev = arr[i - 1];
            const diff = prev ? e.price - prev.price : 0;
            const cls  = diff < 0 ? 'price-drop' : diff > 0 ? 'price-rise' : '';
            const sym  = diff < 0 ? `↓$${Math.abs(diff).toLocaleString()}` : diff > 0 ? `↑$${Math.abs(diff).toLocaleString()}` : '';
            return `<div class="ph-row"><span class="ph-date">${e.date}</span><span class="ph-price ${cls}">${_formatPrice(e.price, car.currency)} ${sym}</span></div>`;
          }).reverse().join('');
          return `<div class="price-history"><div class="ph-label">Price History</div>${items}</div>`;
        })()}
        <div class="card-stars">${stars}</div>
        <div class="tag-row">${tagChips}</div>
        <textarea class="card-note" id="note-${car.id}" placeholder="Add a note…">${car.viewingNote || ''}</textarea>
        <div class="card-actions">
          <button class="card-btn card-btn-save" data-action="save-note" data-id="${car.id}">Save note</button>
        </div>
      </div>
    </div>`;
  }).join('');

  list.onclick = (e) => {
    // Checkbox for compare (label click must not trigger expand)
    const cb = e.target.closest('input[data-action="compare-check"]');
    if (cb) { toggleCompare(cb.dataset.id); return; }

    const star = e.target.closest('.star');
    if (star) { setRating(star.dataset.id, parseInt(star.dataset.rating)); return; }

    const btn = e.target.closest('[data-action]');
    if (btn) {
      const { action, id } = btn.dataset;
      if      (action === 'status')    cycleStatus(id);
      else if (action === 'expand')    toggleExpand(id);
      else if (action === 'open')      openCar(id);
      else if (action === 'save-note') saveNote(id);
      else if (action === 'delete')    deleteCar(id);
      else if (action === 'tag')       toggleTag(id, btn.dataset.tag, btn);
      return;
    }

    // 點卡片任意處（非 label/checkbox/expanded area）→ 展開/收合
    const card = e.target.closest('.saved-card');
    if (card && !e.target.closest('.cmp-checkbox') && !e.target.closest('.card-expand-area')) {
      toggleExpand(card.dataset.id);
    }
  };
}

function cycleStatus(id) {
  const idx = savedList.findIndex(c => c.id === id);
  if (idx < 0) return;
  const cycle = { unseen: 'scheduled', scheduled: 'seen', seen: 'unseen' };
  savedList[idx].viewingStatus = cycle[savedList[idx].viewingStatus] || 'unseen';
  setSavedCars(savedList);
  renderSavedList();
}

function toggleExpand(id) {
  document.getElementById(`expand-${id}`)?.classList.toggle('hidden');
}

function openCar(id) {
  const car = savedList.find(c => c.id === id);
  if (car) openUrl(car.url);
}

async function saveNote(id) {
  const idx = savedList.findIndex(c => c.id === id);
  if (idx < 0) return;
  const textarea = document.getElementById(`note-${id}`);
  if (textarea) savedList[idx].viewingNote = textarea.value.trim();
  await setSavedCars(savedList);
  const btn = document.querySelector(`[data-action="save-note"][data-id="${id}"]`);
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save note'; }, 1500); }
}

async function setRating(id, rating) {
  const idx = savedList.findIndex(c => c.id === id);
  if (idx < 0) return;
  savedList[idx].viewingRating = savedList[idx].viewingRating === rating ? null : rating;
  await setSavedCars(savedList);
  const newRating = savedList[idx].viewingRating || 0;
  document.querySelectorAll(`.star[data-id="${id}"]`).forEach(s =>
    s.classList.toggle('filled', parseInt(s.dataset.rating) <= newRating)
  );
}

async function deleteCar(id) {
  savedList.splice(savedList.findIndex(c => c.id === id), 1);
  const ci = compareList.indexOf(id);
  if (ci >= 0) { compareList.splice(ci, 1); chrome.storage.session.set({ car_compareList: compareList }); }
  await setSavedCars(savedList);
  renderSavedList();
  renderCompare();
  updateSaveButton();
}

async function toggleTag(id, tag, btn) {
  const idx = savedList.findIndex(c => c.id === id);
  if (idx < 0) return;
  const tags = savedList[idx].tags || [];
  const i = tags.indexOf(tag);
  if (i >= 0) tags.splice(i, 1);
  else tags.push(tag);
  savedList[idx].tags = tags;
  await setSavedCars(savedList);
  btn.classList.toggle('active', tags.includes(tag));
}

const PRESET_TAGS = [
  { label: '✅ Top Pick' },
  { label: '📅 Test Drive' },
  { label: '🔍 Inspect' },
  { label: '💰 Negotiate' },
  { label: '⚠️ Issues' },
  { label: '❌ Pass' },
];

// ============================================================
// Compare tab
// ============================================================
function toggleCompare(id) {
  const i = compareList.indexOf(id);
  if (i >= 0) compareList.splice(i, 1);
  else if (compareList.length < 3) compareList.push(id);
  chrome.storage.session.set({ car_compareList: compareList });
  renderSavedList();
  renderCompare();
}

function renderCompare() {
  const grid  = document.getElementById('compare-grid');
  const empty = document.getElementById('compare-empty');
  if (!grid) return;

  const cars = compareList.map(id => savedList.find(c => c.id === id)).filter(Boolean);
  if (cars.length === 0) { grid.innerHTML = ''; show('compare-empty'); return; }
  hide('compare-empty');

  const abbr = {
    'Continuously Variable Transmission': 'CVT',
    'Automatic': 'Auto', 'Manual': 'Manual',
    'Front-Wheel Drive': 'FWD', 'Rear-Wheel Drive': 'RWD',
    'All-Wheel Drive': 'AWD', 'Four-Wheel Drive': '4WD',
    'All Wheel Drive': 'AWD', 'Four Wheel Drive': '4WD',
  };
  const fmt = (v) => abbr[v] || v || '—';

  const fields = [
    { label: 'Price',        get: c => c.price   ? _formatPrice(c.price, c.currency) : '—', cmp: c => c.price,   best: 'min' },
    { label: 'Mileage',      get: c => c.mileage ? `${c.mileage.toLocaleString()} mi` : '—', cmp: c => c.mileage, best: 'min' },
    { label: 'Year',         get: c => c.year    || '—',                                      cmp: c => c.year,    best: 'max' },
    { label: 'Body',         get: c => c.bodyType || '—' },
    { label: 'Engine',       get: c => c.engine   || '—' },
    { label: 'Fuel',         get: c => c.fuelType || '—' },
    { label: 'Trans.',       get: c => fmt(c.transmission) },
    { label: 'Drive',        get: c => fmt(c.driveTrain)   },
    { label: 'MPG',          get: c => c.combinedMpg ? `${c.combinedMpg} mpg` : '—', cmp: c => c.combinedMpg, best: 'max' },
    { label: 'Color',        get: c => c.colour   || '—' },
    { label: 'Deal',         get: c => c.dealRating ? c.dealRating.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,x=>x.toUpperCase()) : '—' },
    { label: 'Recalls',      get: c => c.recalls != null ? (c.recalls === 0 ? '✅ None' : `⚠️ ${c.recalls}`) : '—', cmp: c => c.recalls, best: 'min' },
    { label: 'Location',     get: c => c.location || '—' },
  ];

  const n = cars.length;
  const rows = fields.map(f => {
    const vals = cars.map(c => f.get(c));
    let bestIdx = -1;
    if (f.cmp && f.best) {
      const nums = cars.map(c => { const v = f.cmp(c); return typeof v === 'number' && v > 0 ? v : null; });
      if (nums.some(v => v !== null)) {
        bestIdx = f.best === 'min'
          ? nums.reduce((bi, v, i) => v !== null && (bi < 0 || v < nums[bi]) ? i : bi, -1)
          : nums.reduce((bi, v, i) => v !== null && (bi < 0 || v > nums[bi]) ? i : bi, -1);
      }
    }
    return `<div class="cmp-label">${f.label}</div>` +
      vals.map((v, i) => `<div class="cmp-val${i === bestIdx ? ' cmp-best' : ''}">${v}</div>`).join('');
  }).join('');

  grid.innerHTML = `
    <div class="cmp-grid" style="grid-template-columns:64px ${'1fr '.repeat(n).trim()}">
      <div class="cmp-head-label"></div>
      ${cars.map(c => `
        <div class="cmp-head">
          <div class="cmp-name">${c.name || 'Unknown'}</div>
          <button class="cmp-remove" data-id="${c.id}">✕</button>
        </div>`).join('')}
      ${rows}
    </div>
    ${cars.length < 3 ? `<div class="cmp-hint">Add up to ${3-cars.length} more from Saved ↑</div>` : ''}
    <button id="btn-cmp-copy" class="cmp-copy-btn">📋 Copy comparison</button>
  `;

  grid.onclick = (e) => {
    const rm = e.target.closest('.cmp-remove');
    if (rm) { toggleCompare(rm.dataset.id); return; }
  };

  document.getElementById('btn-cmp-copy')?.addEventListener('click', () => {
    const lines = [`CarScope Compare — ${new Date().toLocaleDateString()}\n`];
    cars.forEach(c => {
      lines.push(`── ${c.name || 'Unknown'} ──`);
      fields.forEach(f => lines.push(`  ${f.label.padEnd(10)} ${f.get(c)}`));
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const btn = document.getElementById('btn-cmp-copy');
      if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy comparison'; }, 2000); }
    }).catch(() => {});
  });
}

// ============================================================
// Browsing History (collapsible section inside Saved tab)
// ============================================================
async function _logHistory(data) {
  if (!currentUrl || !data?.name) return;
  const entry = makeHistoryEntry(currentUrl, data.source, data);
  historyList = historyList.filter(h => h.id !== entry.id);
  historyList.unshift(entry);
  if (historyList.length > 50) historyList = historyList.slice(0, 50);
  await setHistory(historyList);
  renderHistory();
}

function renderHistory() {
  const countEl = document.getElementById('history-count');
  if (countEl) countEl.textContent = historyList.length || '';

  const listEl  = document.getElementById('history-list');
  const footer  = document.getElementById('history-footer');
  if (!listEl) return;

  if (!historyExpanded) return; // only render content when expanded

  const savedIds = new Set(savedList.map(c => c.id));
  listEl.innerHTML = historyList.length === 0
    ? `<p class="hist-empty-msg">No browsing history yet.</p>`
    : historyList.map(h => {
        const isSaved = savedIds.has(h.id);
        const price   = h.price ? _formatPrice(h.price, h.currency) : null;
        const miles   = h.mileage ? `${Math.round(h.mileage / 1000)}k mi` : null;
        const meta    = [price, miles, h.location ? `📍 ${h.location}` : null].filter(Boolean).join(' · ');
        return `
          <div class="hist-card" data-id="${h.id}">
            <div class="hist-card-main">
              <div class="hist-card-name">${h.name || 'Unknown Vehicle'}</div>
              ${meta ? `<div class="hist-card-meta">${meta}</div>` : ''}
              <div class="hist-card-time">${_timeAgo(h.visitedAt)}</div>
            </div>
            ${isSaved
              ? `<span class="hist-saved-badge">✓ Saved</span>`
              : `<button class="hist-save-btn" data-action="hist-save" data-id="${h.id}">Save ⭐</button>`
            }
          </div>`;
      }).join('');

  if (footer) footer.classList.toggle('hidden', historyList.length === 0);

  listEl.onclick = (e) => {
    const btn = e.target.closest('[data-action="hist-save"]');
    if (btn) { saveFromHistory(btn.dataset.id); return; }
    const card = e.target.closest('.hist-card');
    if (card && !e.target.closest('button')) {
      const h = historyList.find(x => x.id === card.dataset.id);
      if (h) chrome.tabs.create({ url: h.url });
    }
  };
}

function toggleHistory() {
  historyExpanded = !historyExpanded;
  const listEl = document.getElementById('history-list');
  const arrow  = document.getElementById('history-arrow');
  if (listEl) listEl.classList.toggle('hidden', !historyExpanded);
  if (arrow)  arrow.textContent = historyExpanded ? '▼' : '▶';
  if (historyExpanded) renderHistory();
}

function saveFromHistory(id) {
  const h = historyList.find(x => x.id === id);
  if (!h || savedList.some(c => c.id === id)) return;
  const car = makeCar(h.url, h.source, h);
  savedList.unshift(car);
  setSavedCars(savedList);
  renderSavedList();
  renderHistory();
}

async function clearHistory() {
  historyList = [];
  await setHistory([]);
  renderHistory();
}

function _timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ============================================================
// Share Shortlist
// ============================================================
function shareShortlist() {
  if (savedList.length === 0) return;

  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const sep  = '─'.repeat(32);
  const lines = [`🚗 Car Shortlist — ${date}`, ''];

  savedList.forEach((car, i) => {
    lines.push(sep);
    const stars = car.viewingRating ? '★'.repeat(car.viewingRating) + '☆'.repeat(5 - car.viewingRating) : '';
    lines.push(`${i + 1}. ${car.name || 'Unknown Vehicle'}${stars ? '  ' + stars : ''}`);

    // Price + deal rating + drop indicator
    if (car.price) {
      const h = car.priceHistory || [];
      const dropped = h.length >= 2 && h[h.length - 1].price < h[h.length - 2].price;
      const deal = car.dealRating ? `  (${_dealRatingLabel(car.dealRating)})` : '';
      lines.push(`   Price:    ${_formatPrice(car.price, car.currency)}${dropped ? ' ↓ price dropped' : ''}${deal}`);
    }

    // Mileage
    if (car.mileage)
      lines.push(`   Mileage:  ${car.mileage.toLocaleString()} mi`);

    // Dealer + location
    const dealer = [car.dealerName, car.location].filter(Boolean).join(' — ');
    if (dealer) lines.push(`   Dealer:   ${dealer}`);

    // Phone (if available)
    if (car.dealerPhone)
      lines.push(`   Phone:    ${car.dealerPhone}`);

    // MPG
    const mpg = car.combinedMpg
      ? `${car.combinedMpg} MPG combined`
      : (car.cityMpg && car.hwyMpg ? `${car.cityMpg} city / ${car.hwyMpg} hwy MPG` : null);
    if (mpg) lines.push(`   MPG:      ${mpg}`);

    // Status
    if (car.viewingStatus && car.viewingStatus !== 'unseen')
      lines.push(`   Status:   ${_statusLabel(car.viewingStatus)}`);

    // Tags
    if (car.tags?.length)
      lines.push(`   Tags:     ${car.tags.map(t => '#' + t).join(' ')}`);

    // Notes — user's own observations, most useful when visiting dealer
    if (car.viewingNote?.trim())
      lines.push(`   Notes:    ${car.viewingNote.trim()}`);

    // Clean URL (strip tracking params)
    lines.push(`   Link:     ${_cleanUrl(car.url)}`);
    lines.push('');
  });

  lines.push(sep);
  lines.push('');
  lines.push('PRE-PURCHASE CHECKLIST');
  [
    '□ Run CARFAX or AutoCheck report (~$40)',
    '□ Book independent mechanic PPI (~$100–150)',
    '□ Get insurance quotes before committing',
    '□ Search "[year] [make] [model] common problems"',
    '□ Check panel gaps — uneven gaps = past collision',
    '□ Look for rust under car, wheel wells, door edges',
    '□ Confirm VIN matches title and door jamb sticker',
    '□ Check tire tread depth and wear pattern',
    '□ Test A/C, heat, windows, locks, Bluetooth, USB',
    '□ Test all lights: headlights, brake, signals, reverse',
    '□ Test drive 15+ min including highway speed',
    '□ Cold-start engine and listen for unusual noises',
    '□ Clean title (not salvage / rebuilt / flood)',
    '□ Request maintenance and service records',
  ].forEach(item => lines.push(item));

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = document.getElementById('btn-share-shortlist');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function _cleanUrl(url) {
  try {
    const u = new URL(url);
    // Keep only origin + pathname; strip all tracking/session query params
    return u.origin + u.pathname;
  } catch (_) { return url; }
}

function _dealRatingLabel(key) {
  const map = {
    GREAT_DEAL:  'Great Deal',
    GREAT_PRICE: 'Great Price',
    GOOD_PRICE:  'Good Price',
    FAIR_PRICE:  'Fair Price',
    HIGH_PRICE:  'High Price',
    OVERPRICED:  'Overpriced',
  };
  return map[key] || key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ============================================================
// Generic section toggle helper
// ============================================================
function setupSectionToggle(btnId, bodyId, arrowId, onOpen) {
  const btn  = document.getElementById(btnId);
  const body = document.getElementById(bodyId);
  const arrow= document.getElementById(arrowId);
  if (!btn) return;
  btn.onclick = () => {
    const wasHidden = body.classList.toggle('hidden');
    if (arrow) arrow.textContent = wasHidden ? '▶' : '▼';
    if (!wasHidden && onOpen) onOpen();
  };
}

// ============================================================
// Monthly Cost Estimate
// ============================================================
function renderCostEstimate(data) {
  const content = document.getElementById('cost-content');
  if (!content || !data?.price) return;

  const price = data.price;
  const mpg   = data.combinedMpg
    ? parseFloat(data.combinedMpg)
    : (data.cityMpg && data.hwyMpg ? (parseFloat(data.cityMpg) + parseFloat(data.hwyMpg)) / 2 : null);

  const loan   = price * (1 - _costDownPct / 100);
  const r      = (_costApr / 100) / 12;
  const n      = _costMonths;
  const pmt    = r === 0 ? loan / n : loan * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1);

  const annualMiles  = 12000;
  const gasPrice     = 3.50;
  const fuelMonthly  = mpg ? (annualMiles / mpg * gasPrice) / 12 : null;
  const total        = pmt + (fuelMonthly || 0);

  const chip = (val, label, field, active) =>
    `<button class="cost-chip${active ? ' active' : ''}" data-field="${field}" data-val="${val}">${label}</button>`;

  content.innerHTML = `
    <div class="cost-chips-row">
      <span class="cost-chips-label">Down</span>
      ${chip(10,'10%','down',_costDownPct===10)}${chip(20,'20%','down',_costDownPct===20)}${chip(30,'30%','down',_costDownPct===30)}
    </div>
    <div class="cost-chips-row">
      <span class="cost-chips-label">Term</span>
      ${chip(48,'48 mo','months',_costMonths===48)}${chip(60,'60 mo','months',_costMonths===60)}${chip(72,'72 mo','months',_costMonths===72)}
    </div>
    <div class="cost-chips-row">
      <span class="cost-chips-label">APR</span>
      ${chip(5,'5%','apr',_costApr===5)}${chip(7,'7%','apr',_costApr===7)}${chip(9,'9%','apr',_costApr===9)}
    </div>
    <div class="cost-result">
      <div class="cost-result-row">
        <span>Loan (${_costDownPct}% down, ${_costApr}% APR, ${_costMonths} mo)</span>
        <span class="cost-val">~$${Math.round(pmt).toLocaleString()}/mo</span>
      </div>
      <div class="cost-result-row">
        <span>Fuel (est. 12k mi/yr @ $3.50/gal)</span>
        <span class="cost-val">${fuelMonthly ? `~$${Math.round(fuelMonthly).toLocaleString()}/mo` : '— (MPG unknown)'}</span>
      </div>
      <div class="cost-result-row cost-total">
        <span>Estimated monthly total</span>
        <span class="cost-val cost-total-val">~$${Math.round(total).toLocaleString()}/mo</span>
      </div>
    </div>
    <div class="cost-note">Does not include insurance, maintenance, or registration fees.</div>`;

  content.onclick = (e) => {
    const chip = e.target.closest('.cost-chip');
    if (!chip) return;
    const val = +chip.dataset.val;
    if (chip.dataset.field === 'down')   _costDownPct = val;
    if (chip.dataset.field === 'months') _costMonths  = val;
    if (chip.dataset.field === 'apr')    _costApr     = val;
    renderCostEstimate(data);
  };
}

// ============================================================
// Settings
// ============================================================
async function initSettings() {
  const { car_notificationsEnabled = true } = await chrome.storage.local.get('car_notificationsEnabled');
  const toggle = document.getElementById('toggle-notifications');
  if (toggle) toggle.checked = car_notificationsEnabled;
}

function openSettings() {
  document.getElementById('pane-settings')?.classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('pane-settings')?.classList.add('hidden');
}


function onNotificationsToggle(e) {
  chrome.storage.local.set({ car_notificationsEnabled: e.target.checked });
}

function exportData() {
  const json = JSON.stringify(savedList, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = document.getElementById('btn-export-data');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Copied to clipboard!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

async function clearAllSaved() {
  if (!confirm(`Delete all ${savedList.length} saved cars? This cannot be undone.`)) return;
  savedList = [];
  compareList = [];
  await setSavedCars([]);
  await chrome.storage.session.set({ car_compareList: [] });
  renderSavedList();
  renderCompare();
  closeSettings();
}

// ============================================================
// Tabs
// ============================================================
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-pane').forEach(p =>
        p.classList.toggle('active', p.id === `pane-${btn.dataset.tab}`)
      );
    };
  });

  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.onclick = () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p === pill));
      renderSavedList();
    };
  });
}

// ============================================================
// Helpers
// ============================================================
function setStatus(state, text) {
  const bar = document.getElementById('status-bar');
  if (bar) bar.className = `state-${state}`;
  setText('status-text', text);
}

function _sourceLabel(source) {
  const map = { cargurus: 'CarGurus', autotrader: 'AutoTrader', autotrader_uk: 'AutoTrader UK', autoscout24: 'AutoScout24', cars_com: 'Cars.com' };
  return map[source] || source || '';
}

function _formatPrice(price, currency) {
  const sym = currency === 'GBP' ? '£' : '$';
  return `${sym}${price.toLocaleString()}`;
}

function _statusLabel(s) {
  const map = { unseen: 'Not Visited', scheduled: 'Scheduled', seen: 'Visited' };
  return map[s] || s;
}

function on(id, fn) {
  document.getElementById(id)?.addEventListener('click', fn);
}
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function openUrl(url) { chrome.tabs.create({ url }); }

// ============================================================
// Batch price refresh — delegated to background service worker
// ============================================================
function refreshAllPrices() {
  const btn = document.getElementById('btn-refresh-prices');
  if (!btn || btn.disabled) return;

  const cgCars = savedList.filter(c => c.url && /cargurus\.com|cargurus\.ca/.test(c.url));
  if (cgCars.length === 0) {
    btn.title = 'No CarGurus cars saved';
    setTimeout(() => { btn.title = 'Refresh prices'; }, 2500);
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳';
  chrome.runtime.sendMessage({ action: 'triggerPriceRefresh' });
}

// Listen for progress / done from background
chrome.runtime.onMessage.addListener((msg) => {
  const btn = document.getElementById('btn-refresh-prices');
  if (!btn) return;

  if (msg.action === 'refreshProgress') {
    btn.textContent = `⏳${msg.current}/${msg.total}`;
  }
  if (msg.action === 'refreshDone') {
    getSavedCars().then(list => {
      savedList = list;
      renderSavedList();
    });
    btn.disabled = false;
    btn.textContent = '✓';
    btn.title = `${msg.updated}/${msg.total} updated`;
    setTimeout(() => { btn.textContent = '🔄'; btn.title = 'Refresh prices'; }, 3000);
  }
});

document.addEventListener('DOMContentLoaded', init);
