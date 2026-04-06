// ============================================================
// CarScope — i18n (English only)
// ============================================================
'use strict';

function getUiStrings() {
  return {
    app_name:         'CarScope',
    tab_search:       '🔍 Vehicle',
    tab_saved:        '🚗 Saved',
    tab_compare:      '⚖️ Compare',

    detecting:        'Detecting vehicle…',
    not_listing:      'Go to a vehicle listing page on CarGurus or AutoTrader to use CarScope.',
    source_cargurus:  'CarGurus',
    source_autotrader:'AutoTrader',

    save:             'Save',
    saved:            'Saved ✓',
    view_on_map:      'View on Map',

    label_vin:        'VIN',
    label_price:      'Price',
    label_mileage:    'Mileage',
    label_year:       'Year',
    label_make:       'Make',
    label_model:      'Model',
    label_trim:       'Trim',
    label_condition:  'Condition',

    recalls_title:    '⚠️ NHTSA Recalls',
    recalls_loading:  'Checking recalls…',
    recalls_none:     '✅ No open recalls found',
    recalls_found:    (n) => `${n} open recall${n !== 1 ? 's' : ''} found`,
    recalls_error:    'Could not load recall data',
    recalls_hint:     'Requires make, model, and year',

    section_vin:      '🔑 VIN Details',
    vin_loading:      'Decoding VIN…',

    status_unseen:    'Not Visited',
    status_scheduled: 'Scheduled',
    status_seen:      'Visited',

    note_placeholder: 'Add notes about this car…',
    no_saved:         'No saved cars yet.\nClick Save on any listing.',
    compare_hint:     'Select 2–5 cars from your saved list to compare.',

    btn_carfax:       'CARFAX',
    btn_nhtsa:        'NHTSA',
    btn_kbb:          'KBB Value',
  };
}
