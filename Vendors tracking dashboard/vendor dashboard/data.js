/* data.js — empty bootstrap. All data is loaded dynamically by fetchFullstackData() in clientData.js.
   Do not add static/demo records here — the app should show real ETO data or clear empty states. */

window.PROJECTS            = [];
window.VENDORS             = [];
window.PURCHASE_ORDERS     = [];
window.PURCHASE_ORDERS_RAW = [];
window.SPEND_BY_CATEGORY   = [];
window.SPEND_TIMELINE      = [];
window.ACTIVITY            = [];
window.PO_AGING            = [];
window.QUARTERLY_SPEND     = [];   // [{quarter, actual($K), target($K)}] — last 8 quarters
window.COSTING_MAP         = {};
