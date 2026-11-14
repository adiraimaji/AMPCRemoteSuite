const $ = (sel, root = document) => root.querySelector(sel);

function storedNumber(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const state = {
  token: localStorage.getItem('am.token') || '',
  clientName: localStorage.getItem('am.name') || '',
  hello: null,
  remotes: [],
  remote: null,
  status: null,
  inputs: {},
  bindings: [],
  procsRefresh: null,
  screenTimer: null,
  sse: null,
  connected: false,
  drag: false,
  toastTimer: null,
  wakeLock: null,
  // Sticky Ctrl/Shift/Alt/Win for the special-key panel.
  mods: new Set(),
  // Touchpad feel, adjustable from the ⋯ settings sheet.
  pointerSpeed: storedNumber('am.pointerSpeed', 1.65),
  scrollSpeed: storedNumber('am.scrollSpeed', 1.5),
  keysOpen: localStorage.getItem('am.keysOpen') === '1'
};

const ORDER = [
  'am.trackpad', 'am.keyboard', 'am.media', 'am.screen', 'am.apps',
  'am.system', 'am.clipboard', 'am.presentation', 'am.browser', 'am.power'
];

// The Android shell injects window.AmpcApp. Every call is optional so the same
// web UI keeps working in a normal desktop browser.
function nativeCall(name, ...args) {
  try {
    const bridge = window.AmpcApp;
    if (bridge && typeof bridge[name] === 'function') return bridge[name](...args);
  } catch {
    /* the bridge must never break the UI */
  }
  return undefined;
}

function notifySession(token, name) {
  void nativeCall('setSession', token || '', name || '');
}

/**
 * The native app opens the remote with ?token=<issued token>. Store it, then
 * remove it from the address bar so it does not linger in history or get
 * copied into a screenshot.
 */
function consumeTokenHandoff() {
  try {
    const url = new URL(location.href);
    const token = url.searchParams.get('token');
    if (!token) return;
    state.token = token;
    localStorage.setItem('am.token', token);
    const name = url.searchParams.get('name');
    if (name) {
      state.clientName = name;
      localStorage.setItem('am.name', name);
    }
    url.searchParams.delete('token');
    url.searchParams.delete('name');
    const clean = `${url.pathname}${url.search}${url.hash}`;
    history.replaceState(null, '', clean);
  } catch {
    /* malformed URL: keep the current state */
  }
}

// Called by the Android shell when it revokes or re-pairs the session.
window.amSetToken = function amSetToken(token, name) {
  if (!token) return;
  state.token = token;
  localStorage.setItem('am.token', token);
  if (name) {
    state.clientName = name;
    localStorage.setItem('am.name', name);
  }
  start();
};

window.amClearSession = function amClearSession() {
  signOut(false);
};

// Returns true when the back gesture was consumed by the web UI.
window.amHandleBack = function amHandleBack() {
  const modal = $('#modal');
  if (modal && !modal.classList.contains('hidden')) {
    modalResolve?.(false);
    return true;
  }
  if (state.remote) {
    renderHome();
    return true;
  }
  return false;
};


function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

function vibrate(ms = 8) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (res.status === 401 && state.token) {
    signOut(false);
    throw new Error('Session expired — pair again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function deviceName() {
  if (state.clientName) return state.clientName;
  const ua = navigator.userAgent;
  let name = 'Browser';
  if (/iPhone/.test(ua)) name = 'iPhone';
  else if (/iPad/.test(ua)) name = 'iPad';
  else if (/Android/.test(ua)) name = 'Android phone';
  else if (/Macintosh/.test(ua)) name = 'Mac';
  else if (/Windows/.test(ua)) name = 'PC browser';
  state.clientName = name;
  localStorage.setItem('am.name', name);
  return name;
}

function showLogin(message = '') {
  $('#main').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#login-error').textContent = message;
  $('#login-url').textContent = `${location.host}/admin`;
  setTimeout(() => $('#pin').focus(), 120);
}

function showMain() {
  $('#login').classList.add('hidden');
  $('#main').classList.remove('hidden');
}

async function prepareLogin() {
  try {
    const hello = await api('/api/hello');
    state.hello = hello;
    $('#login-name').textContent = hello.name;
    document.title = hello.name;
    if (!hello.pinRequired) {
      $('#pin').classList.add('hidden');
      $('#login-error').textContent = '';
    }
    if (hello.locked > 0) {
      $('#login-error').textContent = `Too many attempts. Wait ${hello.locked}s.`;
    }
    showLogin();
  } catch (err) {
    showLogin('Cannot reach the server. Is it running?');
  }
}

async function pair() {
  const button = $('#pair');
  const pinInput = $('#pin');
  const pin = pinInput.value.trim();
  const pinRequired = state.hello ? state.hello.pinRequired : true;
  if (pinRequired && !/^\d{4,8}$/.test(pin)) {
    $('#login-error').textContent = 'Enter the PIN shown on your PC.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Connecting…';
  $('#login-error').textContent = '';
  try {
    const hello = await api('/api/hello');
    state.hello = hello;
    const proof = pinRequired ? await sha256(`${hello.nonce}:${pin}`) : '';
    const result = await api('/api/auth', {
      method: 'POST',
      body: {
        nonce: hello.nonce,
        proof,
        clientName: deviceName(),
        platform: navigator.userAgent.includes('Mobile') ? 'mobile-web' : 'web'
      }
    });
    state.token = result.token;
    localStorage.setItem('am.token', result.token);
    notifySession(result.token, deviceName());
    pinInput.value = '';
    await start();
  } catch (err) {
    $('#login-error').textContent = err.message === 'Wrong PIN.' ? 'Wrong PIN. Try again.' : err.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Connect';
  }
}

async function start() {
  try {
    const data = await api('/api/remotes');
    state.remotes = data.remotes || [];
    $('#title').textContent = data.server || 'AM PC Remote';
    document.title = data.server || 'AM PC Remote';
    showMain();
    renderHome();
    connectSse();
    refreshStatus();
    requestWakeLock();
  } catch (err) {
    if (state.token) {
      signOut(false);
      showLogin(err.message);
    }
  }
}

function signOut(callServer = true) {
  const token = state.token;
  state.token = '';
  localStorage.removeItem('am.token');
  notifySession('', '');
  if (state.sse) {
    state.sse.close();
    state.sse = null;
  }
  stopScreenLoop();
  document.documentElement.style.setProperty('--accent', '#5b8cff');
  if (callServer && token) {
    fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  prepareLogin('Disconnected.');
}

// ---------------------------------------------------------------- status
function batteryText(status) {
  if (!status || status.battery === undefined || status.battery < 0) return '';
  return `${status.battery}%${status.charging ? ' ⚡' : ''}`;
}

function formatUptime(seconds) {
  const s = Number(seconds) || 0;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function valueFor(bind, status) {
  if (!status) return '—';
  switch (bind) {
    case 'window': return status.window || 'Desktop';
    case 'process': return status.process || '';
    case 'battery': return status.battery < 0 ? 'AC power' : `${status.battery}%`;
    case 'uptime': return formatUptime(status.uptimeSec);
    case 'idle': return status.idleSec >= 0 ? `${Math.round(status.idleSec)}s` : '—';
    case 'time': return status.time || '—';
    case 'cpu': return status.cpu === undefined ? '—' : `${status.cpu}`;
    case 'mem': return status.mem === undefined ? '—' : `${status.mem}`;
    case 'volume': return status.volume === undefined ? '—' : `${status.volume}`;
    case 'muted': return status.muted ? 'Muted' : 'On';
    default: return status[bind] === undefined ? '—' : String(status[bind]);
  }
}

function applyStatus(status) {
  if (!status) return;
  state.status = status;
  const battery = $('#battery');
  const text = batteryText(status);
  battery.textContent = text;
  battery.classList.toggle('hidden', !text);
  if (state.remote) {
    $('#subtitle').textContent = status.window
      ? `${status.process || 'app'} — ${status.window}`
      : (state.remote.description || '');
  }
  for (const binding of state.bindings) {
    try {
      binding(status);
    } catch {
      /* keep the UI alive */
    }
  }
}

async function refreshStatus() {
  try {
    const data = await api('/api/state');
    applyStatus(data.status);
  } catch {
    /* offline */
  }
}

function connectSse() {
  if (state.sse) state.sse.close();
  if (!state.token) return;
  const source = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  state.sse = source;
  source.onopen = () => {
    state.connected = true;
    if (!state.remote) $('#subtitle').textContent = 'Connected';
  };
  source.onerror = () => {
    state.connected = false;
    if (!state.remote) $('#subtitle').textContent = 'Offline — retrying…';
  };
  source.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'status') applyStatus(message.status);
    if (message.type === 'hello') {
      state.connected = true;
      if (!state.remote) $('#subtitle').textContent = 'Connected';
    }
  };
}

// ---------------------------------------------------------------- rendering
function renderHome() {
  stopScreenLoop();
  state.remote = null;
  state.bindings = [];
  state.procsRefresh = null;
  state.drag = false;
  $('#remote-tools').textContent = '';
  $('#back').classList.add('hidden');
  $('#tabs').classList.remove('hidden');
  markTab('home');
  document.documentElement.style.setProperty('--accent', '#5b8cff');
  $('#title').textContent = state.hello?.name || 'AM PC Remote';

  const view = $('#view');
  view.textContent = '';
  const home = el('div', 'home');

  const hero = el('div', 'home-hero');
  const heroRow = el('div', 'hero-row');
  const heroText = el('div');
  heroText.appendChild(el('h2', null, 'Connected'));
  const heroSub = el('p', null, 'Pick a remote below.');
  heroText.appendChild(heroSub);
  heroRow.appendChild(heroText);
  const lockBtn = el('button', 'btn compact', '🔒 Lock');
  lockBtn.style.maxWidth = '96px';
  lockBtn.onclick = () => sendAction('am.power', '__power', { mode: 'lock' }).catch((e) => toast(e.message));
  heroRow.appendChild(lockBtn);
  hero.appendChild(heroRow);
  home.appendChild(hero);

  const grid = el('div', 'remote-grid');
  const sorted = [...state.remotes].sort((a, b) => {
    const ia = ORDER.indexOf(a.id);
    const ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const remote of sorted) {
    const card = el('button', 'remote-card');
    card.style.setProperty('--tint', remote.color || '#5b8cff');
    const icon = el('div', 'remote-icon', remote.icon || '•');
    const labels = el('div');
    labels.appendChild(el('div', 'remote-name', remote.name));
    labels.appendChild(el('div', 'remote-desc', remote.description || ''));
    card.append(icon, labels);
    card.onclick = () => openRemote(remote.id);
    grid.appendChild(card);
  }
  home.appendChild(grid);

  const foot = el('p', 'muted', 'AM PC Remote runs on your PC. Press the PC admin page for pairing details.');
  foot.style.fontSize = '11.5px';
  foot.style.textAlign = 'center';
  home.appendChild(foot);

  view.appendChild(home);
  if (state.status) applyStatus(state.status);
}

function markTab(id) {
  document.querySelectorAll('#tabs .tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === id);
  });
}

async function openRemote(id) {
  if (state.remote?.id === id) return;
  try {
    const remote = await api(`/api/remotes/${encodeURIComponent(id)}`);
    stopScreenLoop();
    state.remote = remote;
    state.bindings = [];
    state.procsRefresh = null;
    state.drag = false;
    state.inputs = {};
    document.documentElement.style.setProperty('--accent', remote.color || '#5b8cff');
    $('#title').textContent = remote.name;
    $('#subtitle').textContent = remote.description || '';
    $('#back').classList.remove('hidden');
    markTab(id);
    renderLayout(remote.layout);
    if (state.status) applyStatus(state.status);
  } catch (err) {
    toast(err.message);
  }
}

function renderLayout(layout) {
  liveResetters.clear();
  releaseMods();
  typingFocus = false;
  document.body.classList.toggle('keys-open', state.keysOpen);
  const tools = $('#remote-tools');
  tools.textContent = '';
  for (const tool of layout.tools || []) tools.appendChild(renderNode(tool));
  const view = $('#view');
  view.textContent = '';
  view.appendChild(renderNode(layout));
  // A remote can ask for the phone keyboard without a visible strip (the
  // Trackpad does): keep a 1px live input so the toolbar button can summon it.
  const wantsKeyboard = (layout.tools || []).some((tool) => tool.type === 'keyboardToggle');
  if (wantsKeyboard && !view.querySelector('.live-input')) {
    const ghost = renderLiveInput({ ghost: true });
    ghost.classList.add('live-ghost');
    view.appendChild(ghost);
  }
  updateKeyBadges();
}

function renderNode(node) {
  switch (node.type) {
    case 'grid': {
      const root = el('div', 'layout');
      for (const row of node.rows || []) {
        const rowEl = el('div', 'lrow');
        if (row.fixed) {
          rowEl.classList.add('fixed');
          rowEl.style.flex = '0 0 auto';
          rowEl.style.height = typeof row.fixed === 'number' ? `${row.fixed}px` : String(row.fixed);
        } else if (row.panel) {
          // Size and shrink behaviour come from CSS (e.g. the collapsible key
          // panel), so the row can give space back to the touchpad when the
          // phone keyboard is on screen.
        } else {
          rowEl.style.flexGrow = row.weight || 1;
          rowEl.style.flexBasis = '0';
        }
        if (row.className) rowEl.classList.add(...row.className.split(' '));
        for (const child of row.children || []) {
          const cell = el('div', 'lcell');
          if (child.grow) cell.style.flexGrow = child.grow;
          if (child.className) cell.classList.add(...child.className.split(' '));
          cell.appendChild(renderNode(child));
          rowEl.appendChild(cell);
        }
        root.appendChild(rowEl);
      }
      return root;
    }
    case 'row': {
      const rowEl = el('div', 'lrow');
      rowEl.style.flex = '1';
      for (const child of node.children || []) {
        const cell = el('div', 'lcell');
        cell.appendChild(renderNode(child));
        rowEl.appendChild(cell);
      }
      return rowEl;
    }
    case 'button':
      return renderButton(node);
    case 'slider':
      return renderSlider(node);
    case 'input':
      return renderInput(node);
    case 'liveInput':
      return renderLiveInput(node);
    case 'specialKeys':
      return renderSpecialKeys(node);
    case 'keysToggle':
      return renderKeysToggle(node);
    case 'keyboardToggle':
      return renderKeyboardToggle(node);
    case 'trackpad':
      return renderTrackpad(node);
    case 'screen':
      return renderScreen(node);
    case 'status':
      return renderStatusChip(node);
    case 'stat':
      return renderStat(node);
    case 'procs':
      return renderProcs(node);
    case 'spacer':
      return el('div');
    case 'text':
      return el('p', 'muted', node.text || '');
    default:
      return el('div');
  }
}

function renderButton(node) {
  const button = el('button', 'btn');
  if (node.primary) button.classList.add('primary');
  if (node.danger) button.classList.add('danger');
  if (node.compact) button.classList.add('compact');
  if (node.icon) button.appendChild(el('span', 'ico', node.icon));
  if (node.text) button.appendChild(el('span', null, node.text));
  button.addEventListener('pointerdown', keepLiveFocus);
  button.addEventListener('mousedown', keepLiveFocus);
  button.onclick = async () => {
    vibrate();
    for (const reset of liveResetters) reset();
    if (node.local) return runLocal(node);
    if (node.confirm) {
      const ok = await confirmDialog(node.confirm, node.danger ? 'Continue' : 'OK');
      if (!ok) return;
    }
    const args = { ...(node.args || {}) };
    if (node.needsInput) args.text = state.inputs[node.needsInput] || '';
    if (node.confirm) args.confirm = true;
    button.disabled = true;
    try {
      const response = await sendAction(state.remote.id, node.action, args);
      if (node.fillsInput && response.result && typeof response.result.text === 'string') {
        setInput(node.fillsInput, response.result.text);
        toast('Loaded from PC');
      }
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  };
  return button;
}

function renderSlider(node) {
  const wrap = el('div', 'slider-wrap');
  const head = el('div', 'slider-head');
  const label = el('span', null, node.label || '');
  const value = el('b', null, '—');
  head.append(label, value);
  const input = el('input');
  input.type = 'range';
  input.min = node.min ?? 0;
  input.max = node.max ?? 100;
  input.value = state.status?.volume ?? 50;

  const show = (v) => {
    value.textContent = `${v}${node.unit || '%'}`;
    input.value = v;
  };
  show(Number(input.value));

  let lastSent = 0;
  let timer = null;
  const send = () => {
    const v = Number(input.value);
    lastSent = Date.now();
    sendAction(state.remote.id, node.action || '__volume', { op: 'set', value: v }).catch((err) => toast(err.message));
  };

  input.oninput = () => {
    value.textContent = `${input.value}${node.unit || '%'}`;
    if (Date.now() - lastSent > 140) send();
    else {
      clearTimeout(timer);
      timer = setTimeout(send, 160);
    }
  };
  wrap.append(head, input);

  if (node.bind) {
    state.bindings.push((status) => {
      if (document.activeElement === input) return;
      const v = status[node.bind];
      if (typeof v === 'number' && v >= 0) show(v);
      else if (node.bind === 'volume' && status.muted) value.textContent = 'Muted';
    });
  }
  return wrap;
}

function renderInput(node) {
  const wrap = el('div', 'input-wrap');
  const area = el('textarea');
  area.id = `input-${node.id}`;
  area.placeholder = node.placeholder || '';
  area.autocapitalize = 'sentences';
  area.spellcheck = false;
  if (!node.multiline) {
    area.rows = 1;
    area.style.resize = 'none';
  }
  area.value = state.inputs[node.id] || '';
  area.oninput = () => {
    state.inputs[node.id] = area.value;
  };
  if (node.enterToSend) {
    area.onkeydown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const text = area.value;
        if (!text) return;
        sendAction(state.remote.id, '__text', { text }).catch((err) => toast(err.message));
        state.inputs[node.id] = '';
        area.value = '';
      }
    };
  }
  wrap.appendChild(area);
  return wrap;
}

function setInput(id, text) {
  state.inputs[id] = text;
  const area = document.getElementById(`input-${id}`);
  if (area) area.value = text;
}

// ------------------------------------------------------------ live typing
// A one-line field that behaves like a real PC keyboard: tapping it opens the
// phone keyboard and every key press is streamed to the PC as it happens, so
// there is no "type, then press Send" step. The field is only a local mirror of
// what was typed; the difference between the previous and the new value is what
// gets sent, which keeps backspace, IME composing and autocorrect revisions in
// sync with the PC.
function renderLiveInput(node) {
  const wrap = el('div', node.ghost ? 'live-input-wrap live-ghost' : 'live-input-wrap');
  const area = document.createElement('input');
  area.type = 'text';
  area.className = 'live-input';
  area.placeholder = node.placeholder || 'Tap to type on your PC';
  area.autocomplete = 'off';
  area.autocapitalize = 'none';
  area.setAttribute('autocorrect', 'off');
  area.spellcheck = false;
  area.enterKeyHint = 'enter';
  area.setAttribute('aria-label', node.ghost ? 'Live typing' : area.placeholder);
  area.value = '';

  let sent = '';        // text the PC has already received from this field
  let muted = false;    // true while we clear the field ourselves

  const sendText = (text) => {
    if (!text) return;
    sendAction(state.remote.id, '__text', { text }).catch(() => {});
  };

  const sendKeys = (keys) => {
    if (!keys.length) return;
    sendAction(state.remote.id, '__keys', { keys }).catch(() => {});
  };

  // Characters the PC can be driven with while a modifier is latched. Anything
  // else (punctuation from an IME) is still sent as plain text.
  const keyForChar = (ch) => {
    if (/^[a-zA-Z]$/.test(ch)) return ch.toLowerCase();
    if (/^[0-9]$/.test(ch)) return ch;
    if (ch === ' ') return 'space';
    return '';
  };

  // Mirror the field to the PC: delete what disappeared, type what appeared.
  const sync = () => {
    const value = area.value;
    if (value === sent) return;
    let same = 0;
    while (same < value.length && same < sent.length && value[same] === sent[same]) same += 1;
    const removed = Math.min(sent.length - same, 200);
    const added = value.slice(same);

    const mods = MOD_ORDER.filter((mod) => state.mods.has(mod));
    if (mods.length) {
      // Ctrl/Shift/Alt/Win are held down on the PC, so a plain key already
      // arrives as Ctrl+A, Shift+Tab, Alt+F ... Attaching the modifier again
      // would release the hold when the combo finishes.
      if (removed > 0) sendKeys(Array(removed).fill('backspace'));
      for (const ch of added) {
        const key = keyForChar(ch);
        if (key) sendKeys([key]);
        else sendText(ch);
      }
      reset();
      return;
    }

    if (removed > 0) sendKeys(Array(removed).fill('backspace'));
    sendText(added);
    sent = value;
  };

  const reset = () => {
    muted = true;
    area.value = '';
    sent = '';
    muted = false;
  };

  area.addEventListener('input', () => {
    if (!muted) sync();
  });
  area.addEventListener('compositionend', () => {
    if (!muted) sync();
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendKeys([comboFor('enter')]);
      reset();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      sendKeys([comboFor('tab')]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      sendKeys([comboFor('esc')]);
      return;
    }
    if (event.key === 'Backspace' && !area.value) {
      event.preventDefault();
      sendKeys([comboFor('backspace')]);
    }
  });
  area.addEventListener('focus', () => {
    typingFocus = true;
    syncTypingBadge();
  });
  area.addEventListener('blur', () => {
    typingFocus = false;
    reset();
    syncTypingBadge();
  });

  liveResetters.add(reset);
  wrap.appendChild(area);
  return wrap;
}

// ------------------------------------------------------------ special keys
const MOD_ORDER = ['ctrl', 'shift', 'alt', 'win'];
const HELD_KEY = 'am.heldMods';

// Ctrl/Shift/Alt/Win are held down on the PC while armed, so a key press never
// needs the modifier attached again: the PC already has it down. Attaching it
// would turn every tap into a full combo and release the hold (that is what
// made Alt-Tab switch once instead of keeping the switcher open).
function comboFor(key) {
  return key;
}

function updateKeyBadges() {
  const armed = MOD_ORDER.some((mod) => state.mods.has(mod));
  for (const toggle of document.querySelectorAll('.keys-toggle')) {
    toggle.classList.toggle('armed', armed);
    toggle.classList.toggle('active', state.keysOpen);
  }
}

function rememberHeld() {
  try {
    sessionStorage.setItem(HELD_KEY, JSON.stringify([...state.mods]));
  } catch {
    /* session storage is optional */
  }
}

// Lets go of every modifier that is still down on the PC.
function releaseMods() {
  const held = [...state.mods];
  if (!held.length) return;
  state.mods.clear();
  rememberHeld();
  for (const button of document.querySelectorAll('.key-mod.active')) button.classList.remove('active');
  updateKeyBadges();
  const remote = state.remote ? state.remote.id : 'am.keyboard';
  for (const mod of held) sendAction(remote, '__keyup', { keys: [mod] }).catch(() => {});
}

// Used when the page is going away: keepalive lets the request finish even
// after the WebView has torn the page down.
function sendReleaseKeepalive(keys) {
  const list = keys.filter((mod) => MOD_ORDER.includes(mod));
  if (!list.length || !state.token) return;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` };
  const body = JSON.stringify({ remote: 'am.keyboard', action: '__keyup', args: { keys: list } });
  try {
    fetch('/api/action', { method: 'POST', headers, body, keepalive: true }).catch(() => {});
  } catch {
    /* best effort */
  }
}

function toggleKeysPanel(force) {
  const open = force === undefined ? !state.keysOpen : force;
  state.keysOpen = open;
  localStorage.setItem('am.keysOpen', open ? '1' : '0');
  document.body.classList.toggle('keys-open', open);
  if (!open) releaseMods();
  updateKeyBadges();
}

function pressKey(combo, options = {}) {
  if (!options.silent) vibrate();
  for (const reset of liveResetters) reset();
  sendAction(state.remote.id, '__keys', { keys: [combo] }).catch((err) => toast(err.message));
}

function keyButton(label, key, options = {}) {
  const button = el('button', 'key-btn', label);
  button.addEventListener('pointerdown', keepLiveFocus);
  button.addEventListener('mousedown', keepLiveFocus);
  // A raw key ignores the held modifiers (used for the plain Win key).
  button.onclick = () => pressKey(options.raw ? key : comboFor(key));
  return button;
}

function modButton(mod, label) {
  const button = el('button', 'key-btn key-mod', label);
  if (state.mods.has(mod)) button.classList.add('active');
  button.addEventListener('pointerdown', keepLiveFocus);
  button.addEventListener('mousedown', keepLiveFocus);
  button.onclick = async () => {
    vibrate();
    const down = !state.mods.has(mod);
    if (down) state.mods.add(mod);
    else state.mods.delete(mod);
    button.classList.toggle('active', down);
    updateKeyBadges();
    rememberHeld();
    try {
      await sendAction(state.remote.id, down ? '__keydown' : '__keyup', { keys: [mod] });
    } catch (err) {
      // The PC refused the hold: keep the button honest.
      if (down) state.mods.delete(mod);
      else state.mods.add(mod);
      button.classList.toggle('active', !down);
      updateKeyBadges();
      rememberHeld();
      toast(err.message);
    }
  };
  return button;
}

// A key that fires once on tap and keeps repeating while the finger stays on
// it, like holding Tab on a real keyboard.
function repeatKeyButton(label, key) {
  const button = el('button', 'key-btn key-repeat', label);
  let delay = null;
  let repeat = null;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(repeat);
    delay = null;
    repeat = null;
    button.classList.remove('active');
  };
  const fire = () => pressKey(comboFor(key), { silent: true });
  button.addEventListener('pointerdown', (event) => {
    keepLiveFocus(event);
    if (!delay && !repeat) {
      fire();
      button.classList.add('active');
      delay = setTimeout(() => {
        repeat = setInterval(fire, 130);
      }, 380);
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button.addEventListener(type, stop);
  }
  return button;
}

// Ctrl/Shift/Alt/Win hold the key down on the PC: tap once to press it, tap
// again to let go. Tap Alt, then Tab as often as you like: the Alt-Tab
// switcher stays open and every Tab moves the highlight until Alt is released.
function renderSpecialKeys() {
  const panel = el('div', 'keys-panel');

  const mods = el('div', 'keys-grid mods');
  for (const [mod, label] of [['ctrl', 'Ctrl'], ['shift', 'Shift'], ['alt', 'Alt'], ['win', 'Win']]) {
    mods.appendChild(modButton(mod, label));
  }
  // Second Tab, in the modifier row: tap or hold to repeat.
  mods.appendChild(repeatKeyButton('Tab', 'tab'));
  panel.appendChild(mods);

  const edit = el('div', 'keys-grid six');
  for (const [label, key] of [
    ['Esc', 'esc'], ['Tab', 'tab'], ['Enter', 'enter'], ['Bksp', 'backspace'],
    ['Win', 'win'], ['Del', 'delete']
  ]) {
    // The plain Win key fires immediately, without latching and without mods.
    edit.appendChild(keyButton(label, key, { raw: key === 'win' }));
  }
  panel.appendChild(edit);

  const nav = el('div', 'keys-grid six');
  for (const [label, key] of [
    ['Ins', 'insert'], ['Home', 'home'], ['PgUp', 'pageup'], ['PgDn', 'pagedown'],
    ['End', 'end'], ['Spc', 'space']
  ]) {
    nav.appendChild(keyButton(label, key));
  }
  panel.appendChild(nav);

  const arrows = el('div', 'keys-grid arrows');
  arrows.append(el('span'), keyButton('↑', 'up'), el('span'));
  arrows.append(keyButton('←', 'left'), keyButton('↓', 'down'), keyButton('→', 'right'));
  panel.appendChild(arrows);

  const fn = el('div', 'keys-grid fn');
  for (let i = 1; i <= 12; i += 1) fn.appendChild(keyButton(`F${i}`, `f${i}`));
  panel.appendChild(fn);

  return panel;
}

function renderKeysToggle() {
  const button = el('button', 'btn compact keys-toggle');
  button.appendChild(el('span', 'ico', '▦'));
  button.appendChild(el('span', 'keys-toggle-label', 'Keys'));
  button.addEventListener('pointerdown', keepLiveFocus);
  button.addEventListener('mousedown', keepLiveFocus);
  button.onclick = () => {
    vibrate();
    toggleKeysPanel();
  };
  if (state.keysOpen) button.classList.add('active');
  if (MOD_ORDER.some((mod) => state.mods.has(mod))) button.classList.add('armed');
  return button;
}

// Toolbar button that brings up the phone keyboard for live typing, even when
// the remote has no visible typing strip (the Trackpad hides it to save room).
function renderKeyboardToggle() {
  const button = el('button', 'icon-btn kbd-toggle');
  button.setAttribute('aria-label', 'Show the phone keyboard');
  button.title = 'Type on the PC';
  button.appendChild(el('span', 'ico', '⌨'));
  button.onclick = () => {
    vibrate();
    const input = document.querySelector('.live-input');
    if (!input) {
      toast('Live typing is not available on this screen');
      return;
    }
    input.focus();
    typingFocus = true;
    syncTypingBadge();
  };
  return button;
}

function syncTypingBadge() {
  for (const button of document.querySelectorAll('.kbd-toggle')) {
    button.classList.toggle('active', typingFocus);
  }
}

document.addEventListener('focusin', syncTypingBadge);
document.addEventListener('focusout', () => setTimeout(syncTypingBadge, 60));

// ---------------------------------------------------------------- settings
function openSettings() {
  if ($('.sheet-backdrop')) return;
  const backdrop = el('div', 'sheet-backdrop');
  const card = el('div', 'sheet-card');
  card.appendChild(el('h2', null, 'Settings'));

  const sliders = [
    { key: 'pointerSpeed', label: 'Pointer speed', min: 0.6, max: 3, step: 0.05 },
    { key: 'scrollSpeed', label: 'Scroll speed', min: 0.5, max: 3, step: 0.05 }
  ];
  for (const item of sliders) {
    const field = el('div', 'sheet-field');
    const head = el('div', 'sheet-head');
    head.appendChild(el('span', null, item.label));
    const value = el('b', null, `${state[item.key].toFixed(2)}x`);
    head.appendChild(value);
    const range = el('input', 'sheet-range');
    range.type = 'range';
    range.min = item.min;
    range.max = item.max;
    range.step = item.step;
    range.value = state[item.key];
    range.oninput = () => {
      const speed = Number(range.value);
      state[item.key] = speed;
      localStorage.setItem(`am.${item.key}`, String(speed));
      value.textContent = `${speed.toFixed(2)}x`;
    };
    field.append(head, range);
    card.appendChild(field);
  }

  card.appendChild(el('p', 'muted sheet-hint', 'Pointer speed changes how far the PC cursor moves for the same swipe on the touchpad.'));

  const actions = el('div', 'sheet-actions');
  const logout = el('button', 'btn danger compact', 'Log out');
  logout.onclick = () => {
    close();
    signOut(true);
  };
  const closeButton = el('button', 'btn primary compact', 'Done');
  closeButton.onclick = () => close();
  actions.append(logout, closeButton);
  card.appendChild(actions);

  backdrop.appendChild(card);
  backdrop.onclick = (event) => {
    if (event.target === backdrop) close();
  };
  document.body.appendChild(backdrop);

  function close() {
    backdrop.remove();
  }
}

function renderStatusChip(node) {
  const chip = el('div', 'status-chip');
  chip.appendChild(el('span', 's-label', node.label || 'Status'));
  const value = el('span', 's-value', '—');
  chip.appendChild(value);
  const bind = node.bind || 'window';
  state.bindings.push((status) => {
    value.textContent = valueFor(bind, status);
  });
  if (state.status) value.textContent = valueFor(bind, state.status);
  return chip;
}

function renderStat(node) {
  const card = el('div', 'stat');
  const label = el('div', 'l', node.label || '');
  const number = el('div', 'n');
  const value = el('span', null, '—');
  const unit = el('small', null, node.unit || '');
  number.append(value, unit);
  const bar = el('div', 'bar');
  const fill = el('i');
  bar.appendChild(fill);
  card.append(label, number, bar);

  const bind = node.bind || 'cpu';
  state.bindings.push((status) => {
    const raw = status[bind];
    if (typeof raw === 'number' && raw >= 0) {
      value.textContent = raw;
      const max = node.max || 100;
      fill.style.width = `${Math.min(100, (raw / max) * 100)}%`;
    } else if (bind === 'battery' && raw < 0) {
      value.textContent = 'AC';
      unit.textContent = '';
      fill.style.width = '100%';
    } else if (bind === 'idle') {
      value.textContent = Math.round(raw || 0);
    } else {
      value.textContent = '—';
    }
  });
  if (state.status) {
    const raw = state.status[bind];
    if (typeof raw === 'number') {
      value.textContent = raw < 0 ? 'AC' : raw;
      fill.style.width = `${Math.min(100, (Math.max(0, raw) / (node.max || 100)) * 100)}%`;
    }
  }
  return card;
}

function renderProcs(node) {
  const card = el('div', 'procs');
  card.appendChild(el('h3', null, node.title || 'Processes'));
  const body = el('div');
  card.appendChild(body);

  const load = async () => {
    try {
      const response = await sendAction(state.remote.id, '__procs', { count: node.count || 6 });
      const rows = Array.isArray(response.result) ? response.result : [];
      body.textContent = '';
      if (!rows.length) body.appendChild(el('div', 'empty', 'No data'));
      for (const row of rows) {
        const line = el('div', 'proc-row');
        line.appendChild(el('span', null, row.name));
        line.appendChild(el('span', 'm', `${row.memMb} MB`));
        body.appendChild(line);
      }
    } catch (err) {
      body.textContent = '';
      body.appendChild(el('div', 'empty', err.message));
    }
  };
  state.procsRefresh = load;
  load();
  return card;
}

// ---------------------------------------------------------------- trackpad
function renderTrackpad(node) {
  const pad = el('div', 'trackpad');
  // Do not steal focus from live typing when the pad is used.
  pad.addEventListener('pointerdown', keepLiveFocus);
  pad.addEventListener('mousedown', keepLiveFocus);
  const dot = el('div', 'tp-dot');
  pad.appendChild(dot);
  if (node.hint) pad.appendChild(el('div', 'tp-hint', node.hint));
  if (state.drag) pad.classList.add('dragging');

  const pointers = new Map();
  let last = null;
  let start = null;
  let moved = 0;
  let longTimer = null;
  let longFired = false;
  let dragging = false;
  let twoStart = null;
  let twoMoved = 0;
  let twoLast = null;
  let twoActive = false;
  let twoStartT = 0;
  let threeActive = false;
  let threeStartT = 0;
  let threeMoved = 0;
  let threeLast = null;
  let lastTap = null;
  let pendingDx = 0;
  let pendingDy = 0;
  let pendingScroll = 0;
  let sender = null;

  const flush = () => {
    if (pendingDx || pendingDy) {
      sendAction(state.remote.id, '__pointer', {
        op: 'move',
        dx: Math.round(pendingDx * state.pointerSpeed),
        dy: Math.round(pendingDy * state.pointerSpeed)
      }).catch(() => {});
      pendingDx = 0;
      pendingDy = 0;
    }
    if (pendingScroll) {
      sendAction(state.remote.id, '__pointer', {
        op: 'scroll',
        dy: Math.round(pendingScroll * state.scrollSpeed)
      }).catch(() => {});
      pendingScroll = 0;
    }
    if (!pendingDx && !pendingDy && !pendingScroll) {
      clearInterval(sender);
      sender = null;
    }
  };

  const ensureSender = () => {
    if (!sender) sender = setInterval(flush, 18);
  };

  const average = () => {
    let x = 0;
    let y = 0;
    for (const point of pointers.values()) {
      x += point.x;
      y += point.y;
    }
    return { x: x / pointers.size, y: y / pointers.size };
  };

  pad.addEventListener('pointerdown', (event) => {
    pad.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pad.classList.add('touching');
    dot.style.left = `${event.clientX - pad.getBoundingClientRect().left}px`;
    dot.style.top = `${event.clientY - pad.getBoundingClientRect().top}px`;

    if (pointers.size === 1) {
      const now = Date.now();
      // The second tap of a double tap presses the left button straight away,
      // so the finger that stays down drags immediately (no press and hold).
      const secondTap = lastTap && now - lastTap.t < 400
        && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 48;
      last = { x: event.clientX, y: event.clientY };
      start = { x: event.clientX, y: event.clientY, t: now };
      moved = 0;
      longFired = false;
      twoActive = false;
      threeActive = false;
      clearTimeout(longTimer);
      if (secondTap) {
        lastTap = null;
        dragging = true;
        vibrate(16);
        pad.classList.add('dragging');
        sendAction(state.remote.id, '__pointer', { op: 'down', button: 'left' }).catch(() => {});
      } else {
        longTimer = setTimeout(() => {
          if (moved < 16 && pointers.size === 1 && !longFired) {
            // Press and hold, then move: drag like a laptop touchpad.
            longFired = true;
            dragging = true;
            vibrate(16);
            pad.classList.add('dragging');
            sendAction(state.remote.id, '__pointer', { op: 'down', button: 'left' }).catch(() => {});
          }
        }, 500);
      }
    } else if (pointers.size === 2) {
      clearTimeout(longTimer);
      if (dragging) {
        // A second finger means scrolling, not dragging: let the button go.
        dragging = false;
        pad.classList.remove('dragging');
        if (!state.drag) {
          sendAction(state.remote.id, '__pointer', { op: 'up', button: 'left' }).catch(() => {});
        }
      }
      twoStart = average();
      twoLast = { ...twoStart };
      twoMoved = 0;
      twoActive = true;
      twoStartT = Date.now();
    } else if (pointers.size === 3) {
      // Three fingers are only used for the middle click, never for scrolling.
      clearTimeout(longTimer);
      if (dragging) {
        dragging = false;
        pad.classList.remove('dragging');
        if (!state.drag) {
          sendAction(state.remote.id, '__pointer', { op: 'up', button: 'left' }).catch(() => {});
        }
      }
      // If the two fingers were already scrolling, this is not a clean tap.
      threeActive = !twoActive || twoMoved < 16;
      threeStartT = Date.now();
      threeMoved = 0;
      threeLast = average();
      twoActive = false;
      twoLast = null;
    } else {
      // Four or more fingers: never treat this as a tap or a click.
      twoActive = false;
      threeActive = false;
    }
  });

  pad.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1 && last) {
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      pendingDx += dx;
      pendingDy += dy;
      if (moved > 16) clearTimeout(longTimer);
      ensureSender();
    } else if (pointers.size === 2 && twoLast) {
      const avg = average();
      const dy = avg.y - twoLast.y;
      const dx = avg.x - twoLast.x;
      twoLast = avg;
      twoMoved += Math.abs(dy) + Math.abs(dx);
      // Ignore finger jitter so a two-finger tap never scrolls the page.
      if (twoMoved > 10) pendingScroll -= dy;
      ensureSender();
    } else if (pointers.size === 3 && threeLast) {
      const avg = average();
      threeMoved += Math.abs(avg.x - threeLast.x) + Math.abs(avg.y - threeLast.y);
      threeLast = avg;
    }
  });

  const endPointer = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      pad.classList.remove('touching');
      clearTimeout(longTimer);
      const now = Date.now();
      const duration = start ? now - start.t : 999;
      const twoTap = twoActive && twoMoved < 16 && now - twoStartT < 420;
      const threeTap = threeActive && threeMoved < 24 && now - threeStartT < 480;
      const wasDragging = dragging;
      dragging = false;
      if (wasDragging) {
        // Release the button that the tap-drag or hold-drag pressed down.
        if (!state.drag) {
          pad.classList.remove('dragging');
          sendAction(state.remote.id, '__pointer', { op: 'up', button: 'left' }).catch(() => {});
        }
      } else if (threeTap) {
        // Three-finger tap = middle click.
        vibrate(16);
        sendAction(state.remote.id, '__pointer', { op: 'middleclick' }).catch(() => {});
      } else if (twoTap) {
        // Two-finger single tap = right click.
        vibrate(16);
        sendAction(state.remote.id, '__pointer', { op: 'rightclick' }).catch(() => {});
      } else if (!twoActive && !threeActive && start && moved < 12 && duration < 500 && !longFired) {
        vibrate();
        sendAction(state.remote.id, '__pointer', { op: 'click' }).catch(() => {});
        // Remember this tap so a quick second tap becomes a drag.
        lastTap = { x: start.x, y: start.y, t: now };
      }
      last = null;
      start = null;
      twoLast = null;
      twoStart = null;
      twoActive = false;
      threeLast = null;
      threeActive = false;
      setTimeout(flush, 40);
    } else if (pointers.size === 2) {
      // Coming down from three fingers must not start a two-finger scroll.
      twoActive = false;
      twoLast = null;
      last = average();
    } else if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      last = { ...remaining };
      twoLast = null;
    }
  };
  pad.addEventListener('pointerup', endPointer);
  pad.addEventListener('pointercancel', endPointer);
  pad.addEventListener('contextmenu', (event) => event.preventDefault());

  return pad;
}

// ---------------------------------------------------------------- screen
function renderScreen(node) {
  const wrap = el('div', 'screen-wrap');
  const img = el('img');
  img.alt = 'PC screen';
  img.draggable = false;
  const badge = el('div', 'screen-badge');
  badge.appendChild(el('i'));
  badge.appendChild(el('span', null, 'live'));
  wrap.append(img, badge);

  const update = () => {
    if (document.hidden) return;
    img.src = `/api/screen.jpg?token=${encodeURIComponent(state.token)}&t=${Date.now()}`;
  };
  update();
  state.screenTimer = setInterval(update, node.refreshMs || 1000);
  img.onerror = () => badge.querySelector('span').textContent = 'no signal';
  img.onload = () => badge.querySelector('span').textContent = 'live';

  wrap.onclick = async (event) => {
    if (!img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;
    const x = (event.clientX - rect.left - ox) / dw;
    const y = (event.clientY - rect.top - oy) / dh;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    vibrate();
    try {
      await sendAction(state.remote.id, '__pointer', { op: 'clickat', x, y });
    } catch (err) {
      toast(err.message);
    }
  };
  return wrap;
}

function stopScreenLoop() {
  if (state.screenTimer) clearInterval(state.screenTimer);
  state.screenTimer = null;
}

// ---------------------------------------------------------------- actions
// Actions must reach the PC in the order they were produced, otherwise fast
// typing can arrive as "pohne" instead of "phone". Every action goes through a
// single promise chain so the previous request always finishes first.
let actionChain = Promise.resolve();

// Live keyboard fields register a reset here. Pressing any key button on the
// page clears the mirror buffer, so the phone side and the PC cannot drift.
const liveResetters = new Set();

// True while the phone keyboard is up for live typing; drives the toolbar badge.
let typingFocus = false;

// Tapping a key button or the trackpad must not steal focus from the live
// typing field, otherwise the phone keyboard closes after every key.
function keepLiveFocus(event) {
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains('live-input')) {
    event.preventDefault();
  }
}

async function sendAction(remote, action, args = {}) {
  const run = () => api('/api/action', { method: 'POST', body: { remote, action, args } });
  const next = actionChain.then(run, run);
  actionChain = next.then(() => {}, () => {});
  return next;
}

async function runLocal(node) {
  const kind = node.local;
  if (kind === 'drag') {
    state.drag = !state.drag;
    toast(state.drag ? 'Drag on: swipe to move windows' : 'Drag off');
    try {
      await sendAction(state.remote.id, '__pointer', { op: state.drag ? 'down' : 'up', button: 'left' });
    } catch (err) {
      toast(err.message);
    }
    const pad = document.querySelector('.trackpad');
    pad?.classList.toggle('dragging', state.drag);
    return;
  }
  if (kind === 'copy') {
    const text = state.inputs[node.source] || '';
    if (nativeCall('copyText', text) === true) {
      toast('Copied');
      return;
    }
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // The phone UI is served over plain HTTP on the LAN, where the async
        // Clipboard API is unavailable. execCommand still works in that case.
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand('copy');
        area.remove();
        if (!copied) throw new Error('copy failed');
      }
      toast('Copied');
    } catch {
      toast('Clipboard is blocked by the browser');
    }
    return;
  }
  if (kind === 'refresh') {
    state.procsRefresh?.();
    refreshStatus();
    toast('Refreshed');
    return;
  }
}

// ---------------------------------------------------------------- modal
let modalResolve = null;

function confirmDialog(text, okLabel = 'Continue') {
  const modal = $('#modal');
  $('#modal-title').textContent = okLabel === 'Continue' ? 'Please confirm' : 'Confirm';
  $('#modal-text').textContent = text;
  $('#modal-ok').textContent = okLabel;
  modal.classList.remove('hidden');
  return new Promise((resolve) => {
    modalResolve = (value) => {
      modal.classList.add('hidden');
      modalResolve = null;
      resolve(value);
    };
    $('#modal-ok').onclick = () => modalResolve?.(true);
    $('#modal-cancel').onclick = () => modalResolve?.(false);
    modal.onclick = (event) => {
      if (event.target === modal) modalResolve?.(false);
    };
  });
}

// ---------------------------------------------------------------- boot
$('#pair').onclick = pair;
$('#pin').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') pair();
});
$('#pin').addEventListener('input', () => {
  $('#pin').value = $('#pin').value.replace(/\D/g, '').slice(0, 8);
});

$('#back').onclick = () => renderHome();
$('#menu').onclick = () => openSettings();

document.querySelectorAll('#tabs .tab').forEach((tab) => {
  tab.onclick = () => {
    if (tab.dataset.tab === 'home') return renderHome();
    openRemote(tab.dataset.tab);
  };
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshStatus();
    if (state.screenTimer) {
      const img = document.querySelector('.screen-wrap img');
      if (img) img.src = `/api/screen.jpg?token=${encodeURIComponent(state.token)}&t=${Date.now()}`;
    }
  }
});

// Never leave a modifier stuck when the page is closed or reloaded. The stored
// marker stays behind, so the next load can release it again if this request
// did not make it through.
window.addEventListener('pagehide', () => {
  const held = [...state.mods];
  state.mods.clear();
  sendReleaseKeepalive(held);
});

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
      });
    }
  } catch {
    /* wake lock is optional */
  }
}

if ('serviceWorker' in navigator) {
  const build = document.querySelector('meta[name="app-build"]')?.content || '';
  const version = build && build !== '__BUILD__' ? `?v=${build}` : '';
  navigator.serviceWorker.register(`/sw.js${version}`).catch(() => {});
}

// A page that was closed or reloaded mid-hold can leave a key down; let go of
// anything the previous page still had pressed.
(function releaseLeftovers() {
  let held = [];
  try {
    held = JSON.parse(sessionStorage.getItem(HELD_KEY) || '[]');
    sessionStorage.removeItem(HELD_KEY);
  } catch {
    return;
  }
  if (Array.isArray(held)) sendReleaseKeepalive(held);
})();

(async function boot() {
  consumeTokenHandoff();
  if (state.token) {
    try {
      await start();
      return;
    } catch {
      /* fall through to login */
    }
  }
  await prepareLogin();
})();
