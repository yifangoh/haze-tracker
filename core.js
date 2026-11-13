/* Haze Tracker SG: shared logic (used by the page and the service worker). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HazeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_BASE = 'https://api-open.data.gov.sg/v2/real-time/api/';
  const REGIONS = ['north', 'south', 'east', 'west', 'central'];

  // NEA PSI bands.
  const BANDS = [
    { max: 50, key: 'good', label: 'Good' },
    { max: 100, key: 'moderate', label: 'Moderate' },
    { max: 200, key: 'unhealthy', label: 'Unhealthy' },
    { max: 300, key: 'very-unhealthy', label: 'Very unhealthy' },
    { max: Infinity, key: 'hazardous', label: 'Hazardous' }
  ];

  const MEASURES = {
    psi24: '24-hour PSI',
    psi1: '1-hour PSI (est.)'
  };

  const DEFAULT_SETTINGS = { region: 'central', measure: 'psi24', threshold: 101, enabled: false };

  function bandFor(value) {
    if (value == null || !isFinite(value)) return null;
    return BANDS.find(function (b) { return value <= b.max; });
  }

  // NEA does not publish an hourly PSI, only the hourly PM2.5 concentration (ug/m3).
  // The 1-hour PSI here is the PM2.5 sub-index worked out from that reading using
  // NEA's PM2.5 breakpoints (12 -> 50, 55 -> 100, 150 -> 200, 250 -> 300, 350 -> 400, 500 -> 500).
  const PM25_POINTS = [[0, 0], [12, 50], [55, 100], [150, 200], [250, 300], [350, 400], [500, 500]];
  function pm25ToPsi(c) {
    if (c == null || !isFinite(c) || c < 0) return null;
    const pts = PM25_POINTS;
    let i = 1;
    while (i < pts.length - 1 && c > pts[i][0]) i++;
    const a = pts[i - 1], b = pts[i];
    return Math.round(a[1] + (c - a[0]) * (b[1] - a[1]) / (b[0] - a[0]));
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  async function getLatestItem(endpoint, fetchFn) {
    const res = await fetchFn(API_BASE + endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.errorMsg || 'API error');
    const items = json.data && json.data.items;
    if (!items || !items.length) throw new Error('No data');
    return items[items.length - 1];
  }

  function buildData(psiItem, pmItem) {
    const psi24 = (psiItem && psiItem.readings && psiItem.readings.psi_twenty_four_hourly) || {};
    const pm1 = (pmItem && pmItem.readings && pmItem.readings.pm25_one_hourly) || {};
    const names = REGIONS.concat(['national'].filter(function (n) { return n in psi24 || n in pm1; }));
    const regions = {};
    names.forEach(function (n) {
      const pm = num(pm1[n]);
      regions[n] = { psi24: num(psi24[n]), pm25: pm, psi1: pm == null ? null : pm25ToPsi(pm) };
    });
    return {
      psiUpdated: psiItem ? psiItem.updatedTimestamp : null,
      psiTime: psiItem ? psiItem.timestamp : null,
      pmUpdated: pmItem ? pmItem.updatedTimestamp : null,
      pmTime: pmItem ? pmItem.timestamp : null,
      regions: regions,
      missing: [psiItem ? null : 'psi', pmItem ? null : 'pm25'].filter(Boolean),
      fetchedAt: Date.now()
    };
  }

  async function fetchLatest(fetchFn) {
    fetchFn = fetchFn || function (u, o) { return fetch(u, o); };
    const results = await Promise.allSettled([getLatestItem('psi', fetchFn), getLatestItem('pm25', fetchFn)]);
    if (results[0].status === 'rejected' && results[1].status === 'rejected') throw results[0].reason;
    return buildData(
      results[0].status === 'fulfilled' ? results[0].value : null,
      results[1].status === 'fulfilled' ? results[1].value : null
    );
  }

  function readValue(data, region, measure) {
    const r = data && data.regions && data.regions[region];
    if (!r) return null;
    return measure === 'psi1' ? r.psi1 : r.psi24;
  }

  function signature(s) {
    return [s.region, s.measure, s.threshold].join('|');
  }

  // Decide whether to notify. An alert fires when the value reaches the threshold and
  // stays quiet until the value has dropped back below it (or the settings change).
  function evaluate(data, settings, state) {
    state = state || {};
    const sig = signature(settings);
    let alerted = state.sig === sig ? !!state.alerted : false;
    const value = readValue(data, settings.region, settings.measure);
    if (value == null) return { value: null, above: false, notify: false, state: { sig: sig, alerted: alerted } };
    const above = value >= settings.threshold;
    let notify = false;
    if (above && !alerted) { notify = true; alerted = true; }
    else if (!above) { alerted = false; }
    return { value: value, above: above, notify: notify, state: { sig: sig, alerted: alerted } };
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function buildNotification(settings, value) {
    const band = bandFor(value);
    return {
      title: 'Haze alert: ' + cap(settings.region) + ' PSI ' + value,
      options: {
        body: MEASURES[settings.measure] + ' is ' + value + (band ? ' (' + band.label + ')' : '') +
          ', at or above your alert level of ' + settings.threshold + '.',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'haze-alert',
        renotify: true,
        data: { url: './' }
      }
    };
  }

  // Small key-value store in IndexedDB (readable from the service worker, unlike localStorage).
  const mem = {};
  function openDb() {
    return new Promise(function (resolve, reject) {
      const r = indexedDB.open('haze-tracker', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  async function kvGet(key) {
    try {
      const db = await openDb();
      return await new Promise(function (resolve, reject) {
        const q = db.transaction('kv').objectStore('kv').get(key);
        q.onsuccess = function () { resolve(q.result); };
        q.onerror = function () { reject(q.error); };
      });
    } catch (e) { return mem[key]; }
  }
  async function kvSet(key, value) {
    mem[key] = value;
    try {
      const db = await openDb();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    } catch (e) { /* storage unavailable: in-memory copy only */ }
  }

  function sanitize(s) {
    s = Object.assign({}, DEFAULT_SETTINGS, s || {});
    if (!REGIONS.concat('national').includes(s.region)) s.region = DEFAULT_SETTINGS.region;
    if (!MEASURES[s.measure]) s.measure = DEFAULT_SETTINGS.measure;
    let t = Math.round(Number(s.threshold));
    if (!isFinite(t)) t = DEFAULT_SETTINGS.threshold;
    s.threshold = Math.min(500, Math.max(0, t));
    s.enabled = !!s.enabled;
    return s;
  }

  async function loadSettings() { return sanitize(await kvGet('settings')); }
  async function saveSettings(s) { s = sanitize(s); await kvSet('settings', s); return s; }
  async function resetState() { await kvSet('state', null); }

  function canNotify() {
    try { return typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
    catch (e) { return false; }
  }

  // Check the latest data against the saved alert settings and notify if needed.
  async function processData(data, registration) {
    const settings = await loadSettings();
    if (!settings.enabled) return null;
    const prev = await kvGet('state');
    const res = evaluate(data, settings, prev);
    let newState = res.state;
    if (res.notify) {
      try {
        if (!registration || !canNotify()) throw new Error('cannot notify');
        const n = buildNotification(settings, res.value);
        await registration.showNotification(n.title, n.options);
      } catch (e) {
        newState = prev || { sig: res.state.sig, alerted: false }; // try again next check
        res.notify = false;
      }
    }
    await kvSet('state', newState);
    return res;
  }

  return {
    REGIONS: REGIONS, BANDS: BANDS, MEASURES: MEASURES, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    bandFor: bandFor, pm25ToPsi: pm25ToPsi, buildData: buildData, fetchLatest: fetchLatest,
    readValue: readValue, evaluate: evaluate, buildNotification: buildNotification,
    sanitize: sanitize, loadSettings: loadSettings, saveSettings: saveSettings,
    resetState: resetState, processData: processData, cap: cap
  };
});
