(function () {
  'use strict';

  const C = window.HazeCore;
  const $ = function (id) { return document.getElementById(id); };
  const REFRESH_MS = 10 * 60 * 1000;
  const STALE_MS = 5 * 60 * 1000;

  let settings = Object.assign({}, C.DEFAULT_SETTINGS);
  let data = null;
  let refreshing = false;
  let deferredInstall = null;
  let backgroundOk = false;
  let lastResult = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' });
  }

  function regionNames() {
    return Object.keys((data && data.regions) || {}).length ? Object.keys(data.regions) : C.REGIONS;
  }

  function bandClass(v) {
    const b = C.bandFor(v);
    return b ? ' b-' + b.key : '';
  }

  function valueText(v) { return v == null ? '–' : String(v); }

  // ---------- rendering ----------
  function metric(label, value, sub) {
    const b = C.bandFor(value);
    const m = el('div', 'metric' + bandClass(value));
    m.append(el('div', 'm-label', label), el('div', 'm-num', valueText(value)));
    m.append(b ? el('span', 'chip', b.label) : el('span', 'chip', 'No data'));
    if (sub) m.append(el('div', 'm-sub', sub));
    return m;
  }

  function renderHero() {
    const hero = $('hero');
    hero.replaceChildren();
    const r = data && data.regions[settings.region];
    const head = el('div', 'hero-head');
    head.append(el('span', 'region-name', C.cap(settings.region)));
    head.append(el('span', 'monitoring', settings.enabled
      ? 'Alert at ' + settings.threshold + '+ on ' + C.MEASURES[settings.measure]
      : 'Alerts off'));
    hero.append(head);
    if (!r) {
      hero.append(el('p', 'hint', data ? 'No reading for this region.' : 'Waiting for data…'));
      return;
    }
    const metrics = el('div', 'metrics');
    metrics.append(
      metric('24-hour PSI', r.psi24, data.psiTime ? 'For ' + fmtTime(data.psiTime) : ''),
      metric('1-hour PSI (est.)', r.psi1, r.pm25 != null ? 'PM2.5 ' + r.pm25 + ' µg/m³' : '')
    );
    hero.append(metrics);
  }

  function renderGrid() {
    const grid = $('grid');
    grid.replaceChildren();
    regionNames().forEach(function (name) {
      const r = (data && data.regions[name]) || {};
      const b = el('button', 'rcard');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(name === settings.region));
      b.setAttribute('aria-label', C.cap(name) + ': 24-hour PSI ' + valueText(r.psi24) + ', 1-hour PSI ' + valueText(r.psi1) + '. Select to watch this region.');
      b.append(el('span', 'rname', C.cap(name)));
      [['24-hr', r.psi24], ['1-hr', r.psi1]].forEach(function (p) {
        const row = el('span', 'rrow');
        row.append(el('span', null, p[0]));
        const s = el('strong');
        s.append(el('i', 'dot' + bandClass(p[1])), document.createTextNode(valueText(p[1])));
        row.append(s);
        b.append(row);
      });
      b.addEventListener('click', function () {
        settings.region = name;
        $('region').value = name;
        persist();
      });
      grid.append(b);
    });
  }

  function renderHeader() {
    const u = $('updated');
    if (!data) { u.textContent = 'Loading…'; return; }
    const t = data.psiUpdated || data.pmUpdated;
    u.textContent = t ? 'Updated ' + fmtTime(t) + ' SGT' : 'Updated ' + fmtTime(data.fetchedAt);
  }

  function renderForm() {
    const rs = $('region');
    if (!rs.options.length || rs.options.length !== regionNames().length) {
      rs.replaceChildren();
      regionNames().forEach(function (n) {
        const o = el('option', null, C.cap(n));
        o.value = n;
        rs.append(o);
      });
    }
    rs.value = settings.region;
    const ms = $('measure');
    if (!ms.options.length) {
      Object.keys(C.MEASURES).forEach(function (k) {
        const o = el('option', null, C.MEASURES[k]);
        o.value = k;
        ms.append(o);
      });
    }
    ms.value = settings.measure;
    if (document.activeElement !== $('threshold')) $('threshold').value = settings.threshold;
    const b = C.bandFor(settings.threshold);
    $('t-band').textContent = b ? 'Level ' + settings.threshold + ' is in the “' + b.label + '” range.' : '';
    const t = $('toggle');
    t.textContent = settings.enabled ? 'Turn off alerts' : 'Turn on alerts';
    t.classList.toggle('on', settings.enabled);
  }

  function renderStatus() {
    const s = $('alert-status');
    const supported = 'Notification' in window;
    if (!supported) {
      s.textContent = 'This browser can’t show notifications here. On iPhone, add the app to your Home Screen first (iOS 16.4 or later), then open it from there.';
      return;
    }
    if (Notification.permission === 'denied') {
      s.textContent = 'Notifications are blocked for this app. Allow them in your browser or phone settings, then turn alerts on again.';
      return;
    }
    if (!settings.enabled) { s.textContent = 'Alerts are off.'; return; }
    const v = C.readValue(data, settings.region, settings.measure);
    let msg = 'Alerts on: ' + C.cap(settings.region) + ', ' + C.MEASURES[settings.measure] + ' at ' + settings.threshold + ' or higher.';
    if (v != null) {
      const b = C.bandFor(v);
      msg += ' Right now it is ' + v + ' (' + b.label + '), ' + (v >= settings.threshold ? 'at or above' : 'below') + ' your level.';
    }
    msg += backgroundOk
      ? ' This phone is also set to check in the background when it allows.'
      : ' Checks run every 10 minutes while the app is open; background checks aren’t available on this device.';
    s.textContent = msg;
  }

  function render() {
    renderHeader();
    renderHero();
    renderGrid();
    renderForm();
    renderStatus();
  }

  function showBanner(msg, kind) {
    const b = $('banner');
    b.textContent = msg;
    b.className = 'banner' + (kind ? ' ' + kind : '');
    b.hidden = false;
  }
  function hideBanner() { $('banner').hidden = true; }

  // ---------- data + alerts ----------
  async function getRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(function (r) { setTimeout(function () { r(null); }, 3000); })
      ]);
    } catch (e) { return null; }
  }

  async function runAlerts() {
    if (!data || !settings.enabled) return;
    lastResult = await C.processData(data, await getRegistration());
    renderStatus();
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    $('refresh').classList.add('spin');
    try {
      data = await C.fetchLatest();
      try { localStorage.setItem('haze:last', JSON.stringify(data)); } catch (e) { /* ignore */ }
      const miss = data.missing || [];
      if (miss.includes('psi')) showBanner('NEA’s 24-hour PSI feed isn’t responding right now, so that reading is unavailable.');
      else if (miss.includes('pm25')) showBanner('NEA’s hourly PM2.5 feed isn’t responding right now, so the 1-hour estimate is unavailable.');
      else hideBanner();
      render();
      await runAlerts();
    } catch (err) {
      if (data) {
        showBanner('You appear to be offline. Showing the last reading we have (' + fmtTime(data.psiUpdated || data.fetchedAt) + ').');
      } else {
        showBanner('Couldn’t load PSI data. Check your connection, then tap refresh.', 'error');
      }
      render();
    } finally {
      refreshing = false;
      $('refresh').classList.remove('spin');
    }
  }

  // Settings are normalised synchronously (so quick successive changes never see a stale
  // copy) and written to storage in order.
  let saveChain = Promise.resolve();
  function persist() {
    settings = C.sanitize(settings);
    const snapshot = Object.assign({}, settings);
    render();
    saveChain = saveChain.then(function () { return C.saveSettings(snapshot); }).catch(function () {});
    return saveChain.then(function () { return settings.enabled ? runAlerts() : null; });
  }

  async function registerBackground() {
    backgroundOk = false;
    try {
      const reg = await getRegistration();
      if (reg && 'periodicSync' in reg) {
        await reg.periodicSync.register('haze-check', { minInterval: 15 * 60 * 1000 });
        backgroundOk = true;
      }
    } catch (e) { backgroundOk = false; }
  }

  async function unregisterBackground() {
    try {
      const reg = await getRegistration();
      if (reg && 'periodicSync' in reg) await reg.periodicSync.unregister('haze-check');
    } catch (e) { /* ignore */ }
    backgroundOk = false;
  }

  // ---------- events ----------
  function bindEvents() {
    $('refresh').addEventListener('click', refresh);

    $('region').addEventListener('change', function (e) { settings.region = e.target.value; persist(); });
    $('measure').addEventListener('change', function (e) { settings.measure = e.target.value; persist(); });
    $('threshold').addEventListener('change', function (e) {
      settings.threshold = e.target.value === '' ? C.DEFAULT_SETTINGS.threshold : Number(e.target.value);
      persist();
      $('threshold').value = settings.threshold;
    });
    document.querySelectorAll('.chip-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        settings.threshold = Number(b.dataset.t);
        persist();
      });
    });

    $('toggle').addEventListener('click', async function () {
      if (settings.enabled) {
        settings.enabled = false;
        await unregisterBackground();
        await persist();
        return;
      }
      if (!('Notification' in window)) { renderStatus(); return; }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') { renderStatus(); return; }
      settings.enabled = true;
      await C.resetState();
      await registerBackground();
      await persist();
    });

    $('test').addEventListener('click', async function () {
      if (!('Notification' in window)) { renderStatus(); return; }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') { renderStatus(); return; }
      const reg = await getRegistration();
      const v = C.readValue(data, settings.region, settings.measure);
      const n = C.buildNotification(settings, v == null ? settings.threshold : v);
      n.options.tag = 'haze-test';
      try {
        if (reg) await reg.showNotification('Test: ' + n.title, n.options);
        else new Notification('Test: ' + n.title, n.options);
      } catch (e) {
        $('alert-status').textContent = 'Couldn’t show a test notification on this device.';
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && (!data || Date.now() - data.fetchedAt > STALE_MS)) refresh();
    });
    window.addEventListener('online', refresh);
    setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
  }

  // ---------- install ----------
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function setupInstall() {
    if (isStandalone()) return;
    const card = $('install-card');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      $('install-text').textContent = 'Install Haze Tracker to open it like an app and get alerts.';
      $('install-btn').hidden = false;
      card.hidden = false;
    });
    $('install-btn').addEventListener('click', async function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      card.hidden = true;
    });
    window.addEventListener('appinstalled', function () { card.hidden = true; });
    if (isIos()) {
      $('install-text').textContent = 'Tap the Share button in Safari, then “Add to Home Screen”. On iPhone, alerts only work once the app is added to the Home Screen.';
      card.hidden = false;
    }
  }

  // ---------- start ----------
  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* needs https or localhost */ });
    }
    settings = await C.loadSettings();
    try {
      const cached = JSON.parse(localStorage.getItem('haze:last') || 'null');
      if (cached && cached.regions) data = cached;
    } catch (e) { /* ignore */ }
    bindEvents();
    setupInstall();
    render();
    if (settings.enabled) registerBackground().then(renderStatus);
    refresh();
  }

  init();
})();
