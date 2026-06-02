// =============================================
//  CHROMEBOOK CHECKOUT — app.js
// =============================================

const TOTAL = 32;
const CREDS = { username: "username", password: "password" };
const STORAGE_KEY = 'cbcheckout-state-v1';
const API_BASE = '';

// ── STATE ──
let isLoggedIn = false;
let currentAction = null;
let openDeviceIndex = null;
let scannerStream = null;
let scannerDetector = null;
let scannerTargetInputId = null;
let scannerAnimationId = null;
let scannerActive = false;
let backendConnected = false;
let stateEvents = null;

const initialState = loadSavedState();
const chromebooks = initialState.chromebooks;
const activityLog = initialState.activityLog;

function createDefaultChromebooks() {
  return Array.from({ length: TOTAL }, (_, i) => ({
    id: i + 1,
    barcode:  `BC-${String(i + 1).padStart(6, '0')}`,
    serial:   `CB-${String(i + 1).padStart(6, '0')}`,
    checkedOut: false,
    studentId: null,
    checkoutTime: null,
    log: [],
  }));
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  renderGrid();
  updateStats();
  renderLog();
  connectBackend();

  ['login-username', 'login-password'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
  });

  ['co-serial', 'co-student', 'ci-student'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') submitAction();
    });
  });

  window.addEventListener('storage', syncStateFromStorage);
});

// ── AUTH ──
function doLogin() {
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value;
  const err  = document.getElementById('login-error');

  if (user === CREDS.username && pass === CREDS.password) {
    isLoggedIn = true;
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('logged-in-user').textContent = user;
    err.classList.add('hidden');
  } else {
    err.classList.remove('hidden');
    document.getElementById('login-password').value = '';
  }
}

function doLogout() {
  isLoggedIn = false;
  closeScanner();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');
  closeModal('action-modal');
  closeModal('device-modal');
}

// ── THEME ──
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
}

// ── GRID ──
function renderGrid() {
  const grid = document.getElementById('chromebook-grid');
  grid.innerHTML = '';
  chromebooks.forEach(cb => {
    const btn = document.createElement('button');
    btn.className = `cb-btn ${cb.checkedOut ? 'checked-out' : 'available'}`;
    btn.setAttribute('title', cb.checkedOut
      ? `#${cb.id} – Checked out by ${cb.studentId}`
      : `#${cb.id} – Available`
    );
    btn.innerHTML = `
      <span class="cb-num">${String(cb.id).padStart(2, '0')}</span>
      <span class="cb-status-dot"></span>
    `;
    btn.addEventListener('click', () => openDeviceModal(cb.id));
    grid.appendChild(btn);
  });
}

// ── STATS ──
function updateStats() {
  const out = chromebooks.filter(c => c.checkedOut).length;
  document.getElementById('available-count').textContent = TOTAL - out;
  document.getElementById('checkedout-count').textContent = out;
}

// ── ACTION MODAL ──
function openModal(type) {
  if (!isLoggedIn) return;
  currentAction = type;

  const errEl     = document.getElementById('modal-error');
  const submitBtn = document.getElementById('modal-submit-btn');
  errEl.classList.add('hidden');

  if (type === 'checkout') {
    document.getElementById('modal-title').textContent = 'CHECK OUT';
    document.getElementById('modal-desc').textContent  = 'Assign a Chromebook to a student.';
    document.getElementById('checkout-fields').classList.remove('hidden');
    document.getElementById('checkin-fields').classList.add('hidden');
    submitBtn.style.background = 'var(--red)';
    document.getElementById('co-serial').value  = '';
    document.getElementById('co-student').value = '';
    setTimeout(() => document.getElementById('co-serial').focus(), 100);
  } else {
    document.getElementById('modal-title').textContent = 'CHECK IN';
    document.getElementById('modal-desc').textContent  = 'Return a Chromebook to inventory.';
    document.getElementById('checkout-fields').classList.add('hidden');
    document.getElementById('checkin-fields').classList.remove('hidden');
    submitBtn.style.background = 'var(--green)';
    document.getElementById('ci-student').value = '';
    setTimeout(() => document.getElementById('ci-student').focus(), 100);
  }

  document.getElementById('action-modal').classList.remove('hidden');
}

function closeModal(id) {
  if (id === 'action-modal') closeScanner();
  document.getElementById(id).classList.add('hidden');
}

async function submitAction() {
  const errEl = document.getElementById('modal-error');
  errEl.classList.add('hidden');
  const submitBtn = document.getElementById('modal-submit-btn');
  submitBtn.disabled = true;

  try {
    if (currentAction === 'checkout') {
      const deviceCode = document.getElementById('co-serial').value.trim();
      const studentId = document.getElementById('co-student').value.trim();

      if (!deviceCode || !studentId) {
        showModalError('Please fill in both Chromebook barcode/serial and Student ID.');
        return;
      }

      if (backendConnected) {
        const nextState = await apiRequest('/api/checkout', {
          method: 'POST',
          body: { deviceCode, studentId },
        });
        applyState(nextState, { persist: true });
      } else {
        const cb = findChromebookByDeviceCode(deviceCode);

        if (!cb) {
          showModalError(`No Chromebook found with barcode or serial "${deviceCode}".`);
          return;
        }
        if (cb.checkedOut) {
          showModalError(`Chromebook #${cb.id} is already checked out.`);
          return;
        }

        cb.checkedOut   = true;
        cb.studentId    = studentId;
        cb.checkoutTime = new Date();
        addLog('checkout', `#${cb.id} (${cb.barcode} / ${cb.serial}) checked out to Student ${studentId}`, cb.id);
      }

    } else {
      const studentId = document.getElementById('ci-student').value.trim();

      if (!studentId) {
        showModalError('Please enter a Student ID.');
        return;
      }

      if (backendConnected) {
        const nextState = await apiRequest('/api/checkin', {
          method: 'POST',
          body: { studentId },
        });
        applyState(nextState, { persist: true });
      } else {
        const cb = chromebooks.find(c =>
          c.checkedOut && c.studentId && c.studentId.toLowerCase() === studentId.toLowerCase()
        );

        if (!cb) {
          showModalError(`No Chromebook found checked out to Student ID "${studentId}".`);
          return;
        }

        const prevStudent = cb.studentId;
        cb.checkedOut   = false;
        cb.studentId    = null;
        cb.checkoutTime = null;
        addLog('checkin', `#${cb.id} (${cb.serial}) returned by Student ${prevStudent}`, cb.id);
      }
    }

    renderGrid();
    updateStats();
    closeModal('action-modal');
  } catch (err) {
    showModalError(err.message || 'Unable to update checkout data.');
  } finally {
    submitBtn.disabled = false;
  }
}

function showModalError(msg) {
  const errEl = document.getElementById('modal-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

function findChromebookByDeviceCode(code) {
  const normalized = code.trim().toLowerCase();
  return chromebooks.find(c =>
    c.barcode.toLowerCase() === normalized || c.serial.toLowerCase() === normalized
  );
}

// ── BARCODE SCANNER ──
async function openScanner(targetInputId, label) {
  if (!isLoggedIn) return;
  if (scannerActive || scannerStream) closeScanner();

  scannerTargetInputId = targetInputId;
  scannerActive = true;

  const modal = document.getElementById('scanner-modal');
  const title = document.getElementById('scanner-title');
  const desc = document.getElementById('scanner-desc');
  const status = document.getElementById('scanner-status');
  const video = document.getElementById('scanner-video');

  title.textContent = `SCAN ${label.toUpperCase()}`;
  desc.textContent = `Point the camera at the ${label.toLowerCase()}.`;
  status.textContent = 'Starting camera...';
  modal.classList.remove('hidden');

  if (!('BarcodeDetector' in window)) {
    status.textContent = 'Barcode scanning is not supported in this browser. Try Chrome or Edge, or enter the value manually.';
    scannerActive = false;
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.textContent = 'Camera access is not available in this browser.';
    scannerActive = false;
    return;
  }

  try {
    const formats = await getSupportedBarcodeFormats();
    scannerDetector = new BarcodeDetector({ formats });
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    video.srcObject = scannerStream;
    await video.play();
    status.textContent = 'Scanning...';
    scanVideoFrame();
  } catch (err) {
    status.textContent = `Unable to start scanner: ${err.message || 'camera permission was denied'}.`;
    stopScannerStream();
    scannerActive = false;
  }
}

async function getSupportedBarcodeFormats() {
  const fallbackFormats = ['code_128', 'code_39', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e'];
  if (!BarcodeDetector.getSupportedFormats) return fallbackFormats;

  const supported = await BarcodeDetector.getSupportedFormats();
  const preferred = fallbackFormats.filter(format => supported.includes(format));
  return preferred.length ? preferred : supported.length ? supported : fallbackFormats;
}

async function scanVideoFrame() {
  if (!scannerActive || !scannerDetector) return;

  const video = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');

  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const barcodes = await scannerDetector.detect(video);
      if (barcodes.length > 0) {
        const value = (barcodes[0].rawValue || '').trim();
        if (value) {
          fillScannedValue(value);
          status.textContent = `Scanned ${value}`;
          closeScanner();
          return;
        }
      }
    }
  } catch (err) {
    status.textContent = 'Scanner paused. Move the barcode into the camera frame.';
  }

  scannerAnimationId = requestAnimationFrame(scanVideoFrame);
}

function fillScannedValue(value) {
  const input = document.getElementById(scannerTargetInputId);
  if (!input) return;

  input.value = value;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function closeScanner() {
  scannerActive = false;
  if (scannerAnimationId) {
    cancelAnimationFrame(scannerAnimationId);
    scannerAnimationId = null;
  }
  stopScannerStream();

  const modal = document.getElementById('scanner-modal');
  const video = document.getElementById('scanner-video');
  if (video) video.srcObject = null;
  if (modal) modal.classList.add('hidden');

  scannerDetector = null;
  scannerTargetInputId = null;
}

function stopScannerStream() {
  if (!scannerStream) return;
  scannerStream.getTracks().forEach(track => track.stop());
  scannerStream = null;
}

// ── DEVICE DETAIL MODAL ──
function openDeviceModal(id) {
  openDeviceIndex = id;
  const cb = chromebooks.find(c => c.id === id);
  if (!cb) return;

  document.getElementById('dm-number').textContent  = String(id).padStart(2, '0');
  document.getElementById('dm-title').textContent   = `CHROMEBOOK #${id}`;
  document.getElementById('dm-barcode').textContent = cb.barcode;
  document.getElementById('dm-serial').textContent  = cb.serial;

  const pill = document.getElementById('dm-status-pill');
  if (cb.checkedOut) {
    pill.textContent = 'CHECKED OUT';
    pill.className   = 'status-pill checked-out';
  } else {
    pill.textContent = 'AVAILABLE';
    pill.className   = 'status-pill available';
  }

  const studentRow = document.getElementById('dm-student-row');
  const timeRow    = document.getElementById('dm-time-row');
  if (cb.checkedOut) {
    document.getElementById('dm-student').textContent = cb.studentId || '—';
    document.getElementById('dm-time').textContent    = formatDateTime(cb.checkoutTime);
    studentRow.style.display = '';
    timeRow.style.display    = '';
  } else {
    studentRow.style.display = 'none';
    timeRow.style.display    = 'none';
  }

  ['dm-barcode-edit-btn', 'dm-serial-edit-btn'].forEach(btnId => {
    document.getElementById(btnId).style.display = isLoggedIn ? '' : 'none';
  });

  cancelEdit('barcode');
  cancelEdit('serial');

  renderDeviceLog(cb);

  document.getElementById('device-modal').classList.remove('hidden');
}

// ── INLINE EDIT ──
function editField(field) {
  if (!isLoggedIn) return;
  const cb = chromebooks.find(c => c.id === openDeviceIndex);
  if (!cb) return;

  const valueEl = document.getElementById(`dm-${field}`);
  const editDiv = document.getElementById(`dm-${field}-edit`);
  const editBtn = document.getElementById(`dm-${field}-edit-btn`);
  const input   = document.getElementById(`dm-${field}-input`);

  input.value = field === 'barcode' ? cb.barcode : cb.serial;
  valueEl.style.display = 'none';
  editBtn.style.display = 'none';
  editDiv.classList.remove('hidden');
  input.focus();
  input.select();

  input.onkeydown = (e) => {
    if (e.key === 'Enter')  saveField(field);
    if (e.key === 'Escape') cancelEdit(field);
  };
}

async function saveField(field) {
  if (!isLoggedIn) return;
  const cb  = chromebooks.find(c => c.id === openDeviceIndex);
  if (!cb) return;
  const input = document.getElementById(`dm-${field}-input`);
  const val   = input.value.trim();
  if (!val) return;

  try {
    if (backendConnected) {
      const nextState = await apiRequest(`/api/devices/${cb.id}`, {
        method: 'PATCH',
        body: { field, value: val },
      });
      applyState(nextState, { persist: true });
    } else {
      const oldVal = field === 'barcode' ? cb.barcode : cb.serial;
      if (field === 'barcode') cb.barcode = val;
      else                     cb.serial  = val;

      addLog('edit', `#${cb.id} ${field} changed: "${oldVal}" -> "${val}"`, cb.id);
    }

    const updatedCb = chromebooks.find(c => c.id === openDeviceIndex);
    document.getElementById(`dm-${field}`).textContent = updatedCb ? updatedCb[field] : val;
    cancelEdit(field);

    if (updatedCb) renderDeviceLog(updatedCb);
  } catch (err) {
    showModalError(err.message || `Unable to save ${field}.`);
  }
}

function cancelEdit(field) {
  const valueEl = document.getElementById(`dm-${field}`);
  const editDiv = document.getElementById(`dm-${field}-edit`);
  const editBtn = document.getElementById(`dm-${field}-edit-btn`);
  if (valueEl) valueEl.style.display = '';
  if (editBtn) editBtn.style.display = isLoggedIn ? '' : 'none';
  if (editDiv) editDiv.classList.add('hidden');
}

// ── ACTIVITY LOG ──
function addLog(type, message, cbId) {
  const now   = new Date();
  const entry = { type, message, time: now };
  activityLog.unshift(entry);

  if (cbId != null) {
    const cb = chromebooks.find(c => c.id === cbId);
    if (cb) {
      cb.log.unshift({ type, message, time: now });
    }
  }

  renderLog();
  persistState();
}

function renderDeviceLog(cb) {
  const container = document.getElementById('dm-log');
  const countEl   = document.getElementById('dm-log-count');
  if (!container || !countEl) return;

  const count = cb.log.length;
  countEl.textContent = count === 1 ? '1 event' : `${count} events`;

  if (count === 0) {
    container.innerHTML = '<div class="log-empty">No activity for this device yet.</div>';
    return;
  }

  container.innerHTML = cb.log.map(entry => {
    const typeClass = entry.type === 'checkout' ? 'checkout' : 'checkin';
    const typeLabel = entry.type === 'checkout' ? 'OUT'
                    : entry.type === 'checkin'  ? 'IN'
                    : 'EDIT';
    return `
      <div class="device-log-entry">
        <span class="log-time">${formatDateTime(entry.time)}</span>
        <span class="log-type ${typeClass}">${typeLabel}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
      </div>
    `;
  }).join('');
}

function renderLog() {
  const container = document.getElementById('activity-log');
  if (activityLog.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity recorded yet.</div>';
    return;
  }

  container.innerHTML = activityLog.map(entry => {
    const typeClass = entry.type === 'checkout' ? 'checkout' : 'checkin';
    const typeLabel = entry.type === 'checkout' ? 'OUT'
                    : entry.type === 'checkin'  ? 'IN'
                    : 'EDIT';
    return `
      <div class="log-entry">
        <span class="log-time">${formatDateTime(entry.time)}</span>
        <span class="log-type ${typeClass}">${typeLabel}</span>
        <span class="log-message">${escapeHtml(entry.message)}</span>
      </div>
    `;
  }).join('');
}

async function clearLog() {
  if (!isLoggedIn) return;
  if (backendConnected) {
    try {
      const nextState = await apiRequest('/api/log/clear', { method: 'POST' });
      applyState(nextState, { persist: true });
      return;
    } catch (err) {
      console.warn(err);
    }
  }

  activityLog.length = 0;
  chromebooks.forEach(cb => {
    cb.log = [];
  });
  renderLog();
  persistState();
}

// ── HELPERS ──
async function connectBackend() {
  try {
    const nextState = await apiRequest('/api/state');
    backendConnected = true;
    applyState(nextState, { persist: true });
    connectStateEvents();
  } catch (err) {
    backendConnected = false;
    console.warn('Using local-only fallback state:', err.message);
  }
}

function connectStateEvents() {
  if (!window.EventSource || stateEvents) return;

  stateEvents = new EventSource(`${API_BASE}/api/events`);
  stateEvents.addEventListener('state', e => {
    backendConnected = true;
    applyState(JSON.parse(e.data), { persist: true });
  });
  stateEvents.onerror = () => {
    console.warn('Live update connection interrupted; retrying automatically.');
  };
}

async function apiRequest(path, options = {}) {
  const fetchOptions = {
    method: options.method || 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  };

  if (options.body) {
    fetchOptions.headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_BASE}${path}`, fetchOptions);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}.`);
  return data;
}

function applyState(nextState, options = {}) {
  chromebooks.splice(
    0,
    chromebooks.length,
    ...createDefaultChromebooks().map(defaultCb => reviveChromebook({
      ...defaultCb,
      ...(nextState.chromebooks || []).find(savedCb => savedCb.id === defaultCb.id),
    }))
  );
  activityLog.splice(
    0,
    activityLog.length,
    ...(Array.isArray(nextState.activityLog) ? nextState.activityLog.map(reviveLogEntry) : [])
  );

  renderGrid();
  updateStats();
  renderLog();

  const deviceModal = document.getElementById('device-modal');
  if (openDeviceIndex && deviceModal && !deviceModal.classList.contains('hidden')) {
    openDeviceModal(openDeviceIndex);
  }

  if (options.persist) persistState();
}

function loadSavedState() {
  const defaults = createDefaultChromebooks();
  const fallback = { chromebooks: defaults, activityLog: [] };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    return {
      chromebooks: defaults.map(defaultCb => reviveChromebook({
        ...defaultCb,
        ...(parsed.chromebooks || []).find(savedCb => savedCb.id === defaultCb.id),
      })),
      activityLog: Array.isArray(parsed.activityLog)
        ? parsed.activityLog.map(reviveLogEntry)
        : [],
    };
  } catch (err) {
    return fallback;
  }
}

function persistState() {
  try {
    const data = {
      chromebooks: chromebooks.map(cb => ({
        ...cb,
        checkoutTime: cb.checkoutTime ? cb.checkoutTime.toISOString() : null,
        log: cb.log.map(serializeLogEntry),
      })),
      activityLog: activityLog.map(serializeLogEntry),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    // Continue with in-memory state if storage is unavailable.
  }
}

function syncStateFromStorage(e) {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  if (backendConnected) return;

  try {
    const parsed = JSON.parse(e.newValue);
    applyState(parsed);
  } catch (err) {
    // Ignore malformed storage updates.
  }
}

function reviveChromebook(cb) {
  return {
    ...cb,
    checkoutTime: cb.checkoutTime ? new Date(cb.checkoutTime) : null,
    log: Array.isArray(cb.log) ? cb.log.map(reviveLogEntry) : [],
  };
}

function serializeLogEntry(entry) {
  return {
    ...entry,
    time: entry.time ? entry.time.toISOString() : null,
  };
}

function reviveLogEntry(entry) {
  return {
    ...entry,
    time: entry.time ? new Date(entry.time) : new Date(),
  };
}

function formatDateTime(d) {
  if (!d) return '—';
  const pad  = n => String(n).padStart(2, '0');
  const date = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  const hrs  = d.getHours();
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  const h12  = (hrs % 12) || 12;
  const time = `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
  return `${date} ${time}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── MODAL OVERLAY CLICK TO CLOSE ──
document.addEventListener('click', (e) => {
  if (e.target.id === 'action-modal') closeModal('action-modal');
  if (e.target.id === 'device-modal') closeModal('device-modal');
  if (e.target.id === 'scanner-modal') closeScanner();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeScanner();
    closeModal('action-modal');
    closeModal('device-modal');
  }
});
