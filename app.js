// =============================================
//  CHROMEBOOK CHECKOUT — app.js
// =============================================

const TOTAL = 32;
const CREDS = { username: "username", password: "password" };

// ── STATE ──
let isLoggedIn = false;
let currentAction = null; // 'checkout' | 'checkin'
let openDeviceIndex = null; // which chromebook is open in detail modal

const chromebooks = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  barcode:  `BC-${String(i + 1).padStart(6, '0')}`,
  serial:   `CB-${String(i + 1).padStart(6, '0')}`,
  checkedOut: false,
  studentId: null,
  checkoutTime: null,
  log: [], // per-device activity history
}));

const activityLog = [];

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  renderGrid();
  updateStats();

  // Allow Enter key in login fields
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
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');
  // Close any open modals
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
  const avail = TOTAL - out;
  document.getElementById('available-count').textContent = avail;
  document.getElementById('checkedout-count').textContent = out;
}

// ── ACTION MODAL ──
function openModal(type) {
  if (!isLoggedIn) return;
  currentAction = type;

  const modal  = document.getElementById('action-modal');
  const title  = document.getElementById('modal-title');
  const desc   = document.getElementById('modal-desc');
  const coFlds = document.getElementById('checkout-fields');
  const ciFlds = document.getElementById('checkin-fields');
  const errEl  = document.getElementById('modal-error');
  const submitBtn = document.getElementById('modal-submit-btn');

  errEl.classList.add('hidden');

  if (type === 'checkout') {
    title.textContent = 'CHECK OUT';
    desc.textContent  = 'Assign a Chromebook to a student.';
    coFlds.classList.remove('hidden');
    ciFlds.classList.add('hidden');
    submitBtn.style.background = 'var(--red)';
    document.getElementById('co-serial').value  = '';
    document.getElementById('co-student').value = '';
    setTimeout(() => document.getElementById('co-serial').focus(), 100);
  } else {
    title.textContent = 'CHECK IN';
    desc.textContent  = 'Return a Chromebook to inventory.';
    coFlds.classList.add('hidden');
    ciFlds.classList.remove('hidden');
    submitBtn.style.background = 'var(--green)';
    document.getElementById('ci-student').value = '';
    setTimeout(() => document.getElementById('ci-student').focus(), 100);
  }

  modal.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function submitAction() {
  const errEl = document.getElementById('modal-error');
  errEl.classList.add('hidden');

  if (currentAction === 'checkout') {
    const serial    = document.getElementById('co-serial').value.trim();
    const studentId = document.getElementById('co-student').value.trim();

    if (!serial || !studentId) {
      showModalError('Please fill in both Serial # and Student ID.');
      return;
    }

    const cb = chromebooks.find(c =>
      c.serial.toLowerCase() === serial.toLowerCase()
    );

    if (!cb) {
      showModalError(`No Chromebook found with serial "${serial}".`);
      return;
    }
    if (cb.checkedOut) {
      showModalError(`Chromebook #${cb.id} is already checked out.`);
      return;
    }

    cb.checkedOut = true;
    cb.studentId  = studentId;
    cb.checkoutTime = new Date();
    addLog('checkout', `Chromebook #${cb.id} (${cb.serial}) checked out to Student ${studentId}`, cb.id);

  } else {
    // checkin — find by student ID
    const studentId = document.getElementById('ci-student').value.trim();

    if (!studentId) {
      showModalError('Please enter a Student ID.');
      return;
    }

    const cb = chromebooks.find(c =>
      c.checkedOut && c.studentId && c.studentId.toLowerCase() === studentId.toLowerCase()
    );

    if (!cb) {
      showModalError(`No Chromebook found checked out to Student ID "${studentId}".`);
      return;
    }

    cb.checkedOut   = false;
    cb.studentId    = null;
    cb.checkoutTime = null;
    addLog('checkin', `Chromebook #${cb.id} (${cb.serial}) returned by Student ${studentId}`, cb.id);
  }

  renderGrid();
  updateStats();
  closeModal('action-modal');
}

function showModalError(msg) {
  const errEl = document.getElementById('modal-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

// ── DEVICE DETAIL MODAL ──
function openDeviceModal(id) {
  openDeviceIndex = id;
  const cb = chromebooks.find(c => c.id === id);
  if (!cb) return;

  document.getElementById('dm-number').textContent = String(id).padStart(2, '0');
  document.getElementById('dm-title').textContent  = `CHROMEBOOK #${id}`;
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

  // Show/hide edit buttons based on login
  ['dm-barcode-edit-btn', 'dm-serial-edit-btn'].forEach(id => {
    document.getElementById(id).style.display = isLoggedIn ? '' : 'none';
  });

  // Hide any inline edits
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

function saveField(field) {
  if (!isLoggedIn) return;
  const cb    = chromebooks.find(c => c.id === openDeviceIndex);
  if (!cb) return;
  const input = document.getElementById(`dm-${field}-input`);
  const val   = input.value.trim();
  if (!val) return;

  const oldVal = field === 'barcode' ? cb.barcode : cb.serial;
  if (field === 'barcode') cb.barcode = val;
  else                     cb.serial  = val;

  addLog('edit', `Chromebook #${cb.id} ${field} changed from "${oldVal}" to "${val}"`, cb.id);

  document.getElementById(`dm-${field}`).textContent = val;
  cancelEdit(field);
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
  const entry = { type, message, time: new Date() };
  activityLog.unshift(entry);
  if (cbId != null) {
    const cb = chromebooks.find(c => c.id === cbId);
    if (cb) cb.log.unshift({ type, message, time: entry.time });
  }
  renderLog();
}

function renderDeviceLog(cb) {
  const container = document.getElementById('dm-log');
  const countEl   = document.getElementById('dm-log-count');
  if (!container) return;
  countEl.textContent = cb.log.length === 1 ? '1 event' : `${cb.log.length} events`;
  if (cb.log.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity for this device yet.</div>';
    return;
  }
  container.innerHTML = cb.log.map(entry => {
    const typeClass = entry.type === 'checkout' ? 'checkout'
                    : entry.type === 'checkin'  ? 'checkin'
                    : 'checkin';
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
    const typeClass = entry.type === 'checkout' ? 'checkout'
                    : entry.type === 'checkin'  ? 'checkin'
                    : 'checkin'; // 'edit' uses green styling
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

function clearLog() {
  if (!isLoggedIn) return;
  activityLog.length = 0;
  renderLog();
}

// ── HELPERS ──
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

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'action-modal') closeModal('action-modal');
  if (e.target.id === 'device-modal') closeModal('device-modal');
});

// ESC to close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal('action-modal');
    closeModal('device-modal');
  }
});