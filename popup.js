// ============================================================
// CarScope — Popup Script
// ============================================================
'use strict';

let ui          = null;
let currentData = null;
let currentUrl  = '';
let savedList   = [];
let recallsFetched  = false;
let vinDecodeFetched = false;

// ============================================================
// Init
// ============================================================
async function init() {
  ui = getUiStrings();
  setupTabs();

  savedList = await getSavedCars();
  await queryActiveTab();
  renderSavedList();
  renderCompare();
}

// ============================================================
// Query active tab
// ============================================================
async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentUrl = tab.url || '';

  const isSupportedSite = /cargurus\.com|autotrader\.com/.test(currentUrl);
  if (!isSupportedSite) {
    setStatus('error', 'Not a supported listing page');
    show('not-listing');
    hide('info-section');
    return;
  }

  // Try to get data from background cache first
  chrome.runtime.sendMessage({ action: 'getCarData' }, async (resp) => {
    const data = resp?.data;
    if (data) {
      handleCarData(data);
    } else {
      // Re-inject content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['extractors/base.js', _getExtractorFile(currentUrl), 'content.js'],
        });
        // Wait a moment then try again
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
  if (url.includes('cargurus.com'))   return 'extractors/cargurus.js';
  if (url.includes('autotrader.com')) return 'extractors/autotrader.js';
  return 'extractors/cargurus.js';
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

  // Car name
  setText('car-name', data.name || 'Unknown Vehicle');

  // Specs chips
  renderSpecs(data);

  // Save button state
  updateSaveButton();

  // Link-out buttons
  setupLinkOuts(data);

  // Show recall section if make/model/year available
  if (data.make && data.model && data.year) {
    show('section-recalls');
    setupRecallsToggle(data);
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
    row.innerHTML += `<span class="spec-chip price">$${data.price.toLocaleString()}</span>`;
  }
  if (data.mileage) {
    const warn = data.mileage > 100000;
    row.innerHTML += `<span class="spec-chip${warn ? ' warn' : ''}">${data.mileage.toLocaleString()} mi</span>`;
  }
  if (data.year)  row.innerHTML += `<span class="spec-chip">${data.year}</span>`;
  if (data.make)  row.innerHTML += `<span class="spec-chip">${data.make}</span>`;
  if (data.model) row.innerHTML += `<span class="spec-chip">${data.model}</span>`;
  if (data.trim)  row.innerHTML += `<span class="spec-chip">${data.trim}</span>`;
  if (data.vin)   row.innerHTML += `<span class="spec-chip" title="VIN">VIN: ${data.vin.slice(0,8)}…</span>`;

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
      if (results.length === 0) {
        content.innerHTML = `<div class="recalls-ok">✅ No open recalls found for ${data.year} ${data.make} ${data.model}</div>`;
        return;
      }
      content.innerHTML = results.map(r => `
        <div class="recall-item">
          <div class="recall-component">${r.Component || 'Unknown Component'}</div>
          <div class="recall-summary">${r.Summary || r.Consequence || ''}</div>
          <div class="recall-date">Campaign: ${r.NHTSACampaignNumber || '—'}</div>
        </div>
      `).join('');
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
          // CarGurus: window.__CARGURUS_DATA__ or window.cgData
          const cg = window.__CARGURUS_DATA__ || window.cgData || window.pageData;
          if (cg) {
            const s = JSON.stringify(cg);
            // Extract VIN, make, model from the object tree
            const vinM   = s.match(/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/i);
            const makeM  = s.match(/"make"\s*:\s*"([^"]+)"/i);
            const modelM = s.match(/"model"\s*:\s*"([^"]+)"/i);
            const yearM  = s.match(/"year"\s*:\s*(\d{4})/i);
            const priceM = s.match(/"price"\s*:\s*(\d+)/i);
            const mileM  = s.match(/"mileage"\s*:\s*(\d+)/i);
            return {
              vin:     vinM?.[1]  || null,
              make:    makeM?.[1] || null,
              model:   modelM?.[1]|| null,
              year:    yearM ? parseInt(yearM[1]) : null,
              price:   priceM ? parseInt(priceM[1]) : null,
              mileage: mileM  ? parseInt(mileM[1])  : null,
            };
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
  on('btn-carfax', () => {
    if (data.vin) openUrl(`https://www.carfax.com/VehicleHistory/p/Report_.cfx?partner=TRK_0&vin=${data.vin}`);
    else          openUrl('https://www.carfax.com/');
  });
  on('btn-nhtsa', () => {
    if (data.vin) openUrl(`https://www.nhtsa.gov/vehicle/${data.vin}/complaints`);
    else if (data.make && data.model && data.year)
      openUrl(`https://www.nhtsa.gov/vehicle-safety/recalls#${data.year}-${encodeURIComponent(data.make)}-${encodeURIComponent(data.model)}`);
    else          openUrl('https://www.nhtsa.gov/');
  });
  on('btn-kbb', () => {
    if (data.make && data.model && data.year)
      openUrl(`https://www.kbb.com/${encodeURIComponent(data.make.toLowerCase())}/${encodeURIComponent(data.model.toLowerCase())}/${data.year}/`);
    else openUrl('https://www.kbb.com/');
  });
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

  const filter = document.querySelector('.filter-pill.active')?.dataset.filter || 'ALL';
  const filtered = filter === 'ALL' ? savedList : savedList.filter(c => c.viewingStatus === filter);

  if (filtered.length === 0) {
    list.innerHTML = '';
    show('saved-empty');
    return;
  }
  hide('saved-empty');

  list.innerHTML = filtered.map(car => `
    <div class="saved-card" data-id="${car.id}">
      <div class="saved-card-name">${car.name || 'Unknown Vehicle'}</div>
      <div class="saved-card-meta">
        ${car.price    ? `<span class="saved-card-price">$${car.price.toLocaleString()}</span>` : ''}
        ${car.mileage  ? `<span>${car.mileage.toLocaleString()} mi</span>` : ''}
        ${car.year     ? `<span>${car.year}</span>` : ''}
        <span class="status-label status-${car.viewingStatus}">${_statusLabel(car.viewingStatus)}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.saved-card').forEach(card => {
    card.onclick = () => openUrl(savedList.find(c => c.id === card.dataset.id)?.url);
  });
}

// ============================================================
// Compare (stub — Phase 2)
// ============================================================
function renderCompare() {
  // Phase 2
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
  const map = { cargurus: 'CarGurus', autotrader: 'AutoTrader', cars_com: 'Cars.com' };
  return map[source] || source || '';
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

document.addEventListener('DOMContentLoaded', init);
