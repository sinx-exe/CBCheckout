// =============================================
//  CHROMEBOOK CHECKOUT — app.js
//  Firebase Firestore real-time sync
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─────────────────────────────────────────────
//  🔥 PASTE YOUR FIREBASE CONFIG HERE
// ─────────────────────────────────────────────
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBHfS7Vhrrm92n1cG0Nxu4WcYWTQYtNjZI",
  authDomain: "chromebook-checkout-1a1cf.firebaseapp.com",
  databaseURL: "https://chromebook-checkout-1a1cf-default-rtdb.firebaseio.com",
  projectId: "chromebook-checkout-1a1cf",
  storageBucket: "chromebook-checkout-1a1cf.firebasestorage.app",
  messagingSenderId: "1021439496440",
  appId: "1:1021439496440:web:111cc94f650569be1e2b0d",
  measurementId: "G-PM9WWBY0MW"
};

// ─────────────────────────────────────────────

const TOTAL = 32;
const CREDS = { username: "username", password: "password" };

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Firestore collection/doc references
const devicesCol    = collection(db, "chromebooks");
const globalLogCol  = collection(db, "activityLog");

// ── LOCAL STATE ──
let isLoggedIn     = false;
let currentAction  = null;
let openDeviceIndex = null;
let chromebooks    = []; // populated from Firestore
let unsubDevices   = null;
let unsubGlobalLog = null;
let deviceLogUnsubs = {}; // per-device log listeners keyed by cb id

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  setSyncStatus('syncing', 'Connecting...');

  // Keyboard shortcuts for modals
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

  await seedDevicesIfNeeded();
  subscribeToDevices();
  subscribeToGlobalLog();
});

// ══════════════════════════════════════════════
//  FIRESTORE — SEED INITIAL DATA
//  Only runs once if the collection is empty
// ══════════════════════════════════════════════
async function seedDevicesIfNeeded() {
  try {
    const snapshot = await getDocs(devicesCol);
    if (!snapshot.empty) return; // already seeded

    setSyncStatus('syncing', 'Setting up...');
    const batch = writeBatch(db);

    for (let i = 1; i <= TOTAL; i++) {
      const ref = doc(db, "chromebooks", String(i));
      batch.set(ref, {
        id:           i,
        barcode:      `BC-${String(i).padStart(6, '0')}`,
        serial:       `CB-${String(i).padStart(6, '0')}`,
        checkedOut:   false,
        studentId:    null,
        checkoutTime: null,
      });
    }

    await batch.commit();
    console.log("Seeded 32 Chromebooks to Firestore.");
  } catch (err) {
    console.error("Seed error:", err);
    setSyncStatus('disconnected', 'Setup failed');
  }
}

// ══════════════════════════════════════════════
//  FIRESTORE — REAL-TIME LISTENERS
// ══════════════════════════════════════════════
function subscribeToDevices() {
  if (unsubDevices) unsubDevices();

  unsubDevices = onSnapshot(
    query(devicesCol, orderBy("id")),
    (snapshot) => {
      chromebooks = snapshot.docs.map(d => ({ ...d.data(), firestoreId: d.id }));
      renderGrid();
      updateStats();
      setSyncStatus('connected', 'Live');

      // If device modal is open, refresh it
      if (openDeviceIndex !== null) {
        const cb = chromebooks.find(c => c.id === openDeviceIndex);
        if (cb) refreshOpenDeviceModal(cb);
      }
    },
    (err) => {
      console.error("Device listener error:", err);
      setSyncStatus('disconnected', 'Disconnected');
    }
  );
}

function subscribeToGlobalLog() {
  if (unsubGlobalLog) unsubGlobalLog();

  unsubGlobalLog = onSnapshot(
    query(globalLogCol, orderBy("time", "desc")),
    (snapshot) => {
      renderLogFromDocs(snapshot.docs);
    },
    (err) => console.error("Global log listener error:", err)
  );
}

function subscribeToDeviceLog(cbId) {
  // Unsubscribe previous if switching devices
  if (deviceLogUnsubs[cbId]) return; // already subscribed

  const deviceLogCol = collection(db, "chromebooks", String(cbId), "log");

  deviceLogUnsubs[cbId] = onSnapshot(
    query(deviceLogCol, orderBy("time", "desc")),
    (snapshot) => {
      // Only update UI if this device's modal is open
      if (openDeviceIndex === cbId) {
        renderDeviceLogFromDocs(snapshot.docs);
      }
    },
    (err) => console.error(`Device log listener error (cb ${cbId}):`, err)
  );
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
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
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');
  closeModal('action-modal');
  closeModal('device-modal');
}

// ══════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════
function toggleTheme() {
  const html   = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
}

// ══════════════════════════════════════════════
//  GRID
// ══════════════════════════════════════════════
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

function updateStats() {
  const out = chromebooks.filter(c => c.checkedOut).length;
  document.getElementById('available-count').textContent  = TOTAL - out;
  document.getElementById('checkedout-count').textContent = out;
}

// ══════════════════════════════════════════════
//  ACTION MODAL (CHECKOUT / CHECKIN)
// ══════════════════════════════════════════════
function openModal(type) {
  if (!isLoggedIn) return;
  currentAction = type;

  document.getElementById('modal-error').classList.add('hidden');
  const submitBtn = document.getElementById('modal-submit-btn');

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
  document.getElementById(id).classList.add('hidden');
}

async function submitAction() {
  if (!isLoggedIn) return;
  const errEl = document.getElementById('modal-error');
  errEl.classList.add('hidden');

  const submitBtn = document.getElementById('modal-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'SAVING...';

  try {
    if (currentAction === 'checkout') {
      const serial    = document.getElementById('co-serial').value.trim();
      const studentId = document.getElementById('co-student').value.trim();

      if (!serial || !studentId) {
        showModalError('Please fill in both Serial # and Student ID.');
        return;
      }

      const cb = chromebooks.find(c => c.serial.toLowerCase() === serial.toLowerCase());

      if (!cb) {
        showModalError(`No Chromebook found with serial "${serial}".`);
        return;
      }
      if (cb.checkedOut) {
        showModalError(`Chromebook #${cb.id} is already checked out.`);
        return;
      }

      const now = new Date();
      const deviceRef = doc(db, "chromebooks", String(cb.id));
      await updateDoc(deviceRef, {
        checkedOut:   true,
        studentId:    studentId,
        checkoutTime: now,
      });

      const msg = `#${cb.id} (${cb.serial}) checked out to Student ${studentId}`;
      await writeLog('checkout', msg, cb.id);

    } else {
      const studentId = document.getElementById('ci-student').value.trim();

      if (!studentId) {
        showModalError('Please enter a Student ID.');
        return;
      }

      const cb = chromebooks.find(c =>
        c.checkedOut &&
        c.studentId &&
        c.studentId.toLowerCase() === studentId.toLowerCase()
      );

      if (!cb) {
        showModalError(`No Chromebook found checked out to Student ID "${studentId}".`);
        return;
      }

      const prevStudent = cb.studentId;
      const deviceRef = doc(db, "chromebooks", String(cb.id));
      await updateDoc(deviceRef, {
        checkedOut:   false,
        studentId:    null,
        checkoutTime: null,
      });

      const msg = `#${cb.id} (${cb.serial}) returned by Student ${prevStudent}`;
      await writeLog('checkin', msg, cb.id);
    }

    closeModal('action-modal');

  } catch (err) {
    console.error("Submit error:", err);
    showModalError('Failed to save. Check your connection.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'SUBMIT';
  }
}

function showModalError(msg) {
  const errEl = document.getElementById('modal-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
  document.getElementById('modal-submit-btn').disabled = false;
  document.getElementById('modal-submit-btn').textContent = 'SUBMIT';
}

// ══════════════════════════════════════════════
//  DEVICE DETAIL MODAL
// ══════════════════════════════════════════════
function openDeviceModal(id) {
  openDeviceIndex = id;
  const cb = chromebooks.find(c => c.id === id);
  if (!cb) return;

  populateDeviceModal(cb);
  subscribeToDeviceLog(id);
  document.getElementById('device-modal').classList.remove('hidden');
}

function populateDeviceModal(cb) {
  document.getElementById('dm-number').textContent  = String(cb.id).padStart(2, '0');
  document.getElementById('dm-title').textContent   = `CHROMEBOOK #${cb.id}`;
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
    document.getElementById('dm-time').textContent    = cb.checkoutTime
      ? formatDateTime(cb.checkoutTime.toDate ? cb.checkoutTime.toDate() : new Date(cb.checkoutTime))
      : '—';
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
}

function refreshOpenDeviceModal(cb) {
  populateDeviceModal(cb);
}

// ══════════════════════════════════════════════
//  INLINE EDIT
// ══════════════════════════════════════════════
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

  const input  = document.getElementById(`dm-${field}-input`);
  const val    = input.value.trim();
  if (!val) return;

  const oldVal = field === 'barcode' ? cb.barcode : cb.serial;
  if (val === oldVal) { cancelEdit(field); return; }

  try {
    const deviceRef = doc(db, "chromebooks", String(cb.id));
    await updateDoc(deviceRef, { [field]: val });

    const msg = `#${cb.id} ${field} changed: "${oldVal}" → "${val}"`;
    await writeLog('edit', msg, cb.id);

    cancelEdit(field);
  } catch (err) {
    console.error("Save field error:", err);
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

// ══════════════════════════════════════════════
//  LOG HELPERS
// ══════════════════════════════════════════════
async function writeLog(type, message, cbId) {
  const entry = { type, message, time: serverTimestamp() };

  // Write to global log
  await addDoc(globalLogCol, entry);

  // Write to device-specific subcollection
  if (cbId != null) {
    const deviceLogCol = collection(db, "chromebooks", String(cbId), "log");
    await addDoc(deviceLogCol, entry);
  }
}

function renderLogFromDocs(docs) {
  const container = document.getElementById('activity-log');
  if (docs.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity recorded yet.</div>';
    return;
  }
  container.innerHTML = docs.map(d => {
    const data = d.data();
    const time = data.time ? (data.time.toDate ? data.time.toDate() : new Date(data.time)) : null;
    return logEntryHTML(data.type, data.message, time);
  }).join('');
}

function renderDeviceLogFromDocs(docs) {
  const container = document.getElementById('dm-log');
  const countEl   = document.getElementById('dm-log-count');
  if (!container || !countEl) return;

  countEl.textContent = docs.length === 1 ? '1 event' : `${docs.length} events`;

  if (docs.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity for this device yet.</div>';
    return;
  }

  container.innerHTML = docs.map(d => {
    const data = d.data();
    const time = data.time ? (data.time.toDate ? data.time.toDate() : new Date(data.time)) : null;
    return deviceLogEntryHTML(data.type, data.message, time);
  }).join('');
}

function logEntryHTML(type, message, time) {
  const typeClass = type === 'checkout' ? 'checkout' : 'checkin';
  const typeLabel = type === 'checkout' ? 'OUT' : type === 'checkin' ? 'IN' : 'EDIT';
  return `
    <div class="log-entry">
      <span class="log-time">${formatDateTime(time)}</span>
      <span class="log-type ${typeClass}">${typeLabel}</span>
      <span class="log-message">${escapeHtml(message)}</span>
    </div>`;
}

function deviceLogEntryHTML(type, message, time) {
  const typeClass = type === 'checkout' ? 'checkout' : 'checkin';
  const typeLabel = type === 'checkout' ? 'OUT' : type === 'checkin' ? 'IN' : 'EDIT';
  return `
    <div class="device-log-entry">
      <span class="log-time">${formatDateTime(time)}</span>
      <span class="log-type ${typeClass}">${typeLabel}</span>
      <span class="log-message">${escapeHtml(message)}</span>
    </div>`;
}

async function clearLog() {
  if (!isLoggedIn) return;
  if (!confirm('Clear the entire activity log? This cannot be undone.')) return;

  try {
    const snapshot = await getDocs(globalLogCol);
    const batch    = writeBatch(db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    console.error("Clear log error:", err);
  }
}

// ══════════════════════════════════════════════
//  SYNC STATUS INDICATOR
// ══════════════════════════════════════════════
function setSyncStatus(state, label) {
  const dot   = document.getElementById('sync-dot');
  const text  = document.getElementById('sync-label');
  if (!dot || !text) return;
  dot.className  = `sync-dot ${state}`;
  text.textContent = label;
}

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function formatDateTime(d) {
  if (!d) return '—';
  const pad  = n => String(n).padStart(2, '0');
  const date = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  const hrs  = d.getHours();
  const ampm = hrs >= 12 ? 'PM' : 'AM';
  const h12  = (hrs % 12) || 12;
  return `${date} ${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── MODAL OVERLAY CLOSE ──
document.addEventListener('click', (e) => {
  if (e.target.id === 'action-modal') closeModal('action-modal');
  if (e.target.id === 'device-modal') {
    closeModal('device-modal');
    openDeviceIndex = null;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal('action-modal');
    closeModal('device-modal');
    openDeviceIndex = null;
  }
});

// ── EXPOSE GLOBALS (called from HTML onclick) ──
window.doLogin       = doLogin;
window.doLogout      = doLogout;
window.toggleTheme   = toggleTheme;
window.openModal     = openModal;
window.closeModal    = closeModal;
window.submitAction  = submitAction;
window.editField     = editField;
window.saveField     = saveField;
window.cancelEdit    = cancelEdit;
window.clearLog      = clearLog;