  /*
  Chromebook Checkout - Google Apps Script Backend

  How this works:
  - Deploy this file as a Google Apps Script Web App.
  - The frontend on GitHub Pages calls this Web App URL with fetch().
  - One Google Sheets spreadsheet stores all shared checkout data.

  Spreadsheet tabs created/used by this script:
  1. Devices
     ID | Barcode | Serial | Status | StudentID | CheckoutTime | UpdatedAt | Notes
  2. ActivityLog
     Timestamp | Type | DeviceID | Message
  3. OUT
     ID | Barcode | Serial | StudentID | CheckoutTime | Notes
*/

const TOTAL_DEVICES = 32;

// If this script is bound to the Google Sheet, leave this blank.
// If this is a standalone Apps Script project, paste your Sheet ID here.
const SPREADSHEET_ID = '19mq5Y_fighXt1KX3oO7LhST142hJdfh0yDIXAcN7waY';

const DEVICES_SHEET = 'Devices';
const LOG_SHEET = 'ActivityLog';
const OUT_SHEET = 'OUT';
const BACKEND_VERSION = 'remove-device-out-report-2026-06-05-v1';

function doGet(e) {
  try {
    setupSpreadsheet_();

    const params = e && e.parameter ? e.parameter : {};
    const action = (params.action || 'state').toLowerCase();
    if (action === 'state') {
      return json_({ ok: true, version: BACKEND_VERSION, state: getState_() });
    }

    if (action === 'setup') {
      updateOutSheet_();
      return json_({
        ok: true,
        version: BACKEND_VERSION,
        message: 'Spreadsheet setup complete.',
        state: getState_(),
      });
    }

    if (action === 'debug') {
      return json_({ ok: true, version: BACKEND_VERSION, debug: getDebugInfo_() });
    }

    return json_({ ok: false, error: 'Unknown GET action.' });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

// Run this from the Apps Script editor once to create the Sheet tabs,
// headers, and default Chromebook rows.
function setupSpreadsheet() {
  setupSpreadsheet_();
  updateOutSheet_();
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    setupSpreadsheet_();
    const body = parseBody_(e);
    const action = body.action;

    if (action === 'checkout') {
      checkout_(body.deviceCode, body.studentId);
    } else if (action === 'checkin') {
      checkin_(body.studentId);
    } else if (action === 'updateDevice') {
      updateDevice_(body.id, body.field, body.value);
    } else if (action === 'updateNote') {
      updateNote_(body.id, body.note);
    } else if (action === 'addDevice') {
      addDevice_(body.barcode, body.serial);
    } else if (action === 'removeDevice') {
      removeDevice_(body.id);
    } else if (action === 'clearLog') {
      clearLog_();
    } else {
      throw new Error('Unknown POST action.');
    }

    updateOutSheet_();
    return json_({ ok: true, version: BACKEND_VERSION, state: getState_() });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function parseBody_(e) {
  if (!e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function checkout_(deviceCode, studentId) {
  const cleanDeviceCode = String(deviceCode || '').trim();
  const cleanStudentId = String(studentId || '').trim();

  if (!cleanDeviceCode || !cleanStudentId) {
    throw new Error('Please fill in both Chromebook number/barcode/serial and Student ID.');
  }

  const match = findDeviceByCode_(cleanDeviceCode);
  if (!match) {
    throw new Error(`No Chromebook found with number, barcode, or serial "${cleanDeviceCode}".`);
  }

  const device = match.device;
  if (isDeviceOut_(device)) {
    throw new Error(`Chromebook #${device.ID} is already checked out.`);
  }

  const now = new Date();
  updateDeviceRow_(match.rowNumber, {
    Status: 'out',
    StudentID: cleanStudentId,
    CheckoutTime: now,
    UpdatedAt: now,
  });

  addLog_(
    'checkout',
    device.ID,
    `Chromebook ${device.ID} checked out to Student ${cleanStudentId}`
  );
}

function checkin_(studentOrDeviceCode) {
  const cleanLookup = String(studentOrDeviceCode || '').trim();
  if (!cleanLookup) throw new Error('Please enter a Student ID or Chromebook number.');

  const devices = getDeviceRows_();
  const studentMatch = devices.find(item =>
    isDeviceOut_(item.device) &&
    String(item.device.StudentID || '').toLowerCase() === cleanLookup.toLowerCase()
  );
  const deviceMatch = findDeviceByCode_(cleanLookup);
  const match = studentMatch || (deviceMatch && isDeviceOut_(deviceMatch.device) ? deviceMatch : null);

  if (!match) {
    throw new Error(`No checked-out Chromebook found for "${cleanLookup}".`);
  }

  const device = match.device;
  const checkedOutStudentId = String(device.StudentID || '');
  const now = new Date();
  updateDeviceRow_(match.rowNumber, {
    Status: 'in',
    StudentID: '',
    CheckoutTime: '',
    UpdatedAt: now,
  });

  addLog_('checkin', device.ID, `Chromebook ${device.ID} checked in from Student ${checkedOutStudentId || cleanLookup}`);
}

function updateDevice_(id, field, value) {
  const cleanId = Number(id);
  const cleanField = String(field || '').trim();
  const cleanValue = String(value || '').trim();

  if (!cleanId) throw new Error('Missing Chromebook ID.');
  if (!['barcode', 'serial'].includes(cleanField)) {
    throw new Error('Only barcode and serial can be edited.');
  }
  if (!cleanValue) throw new Error('Please enter a value.');

  const columnName = cleanField === 'barcode' ? 'Barcode' : 'Serial';
  const devices = getDeviceRows_();
  const match = devices.find(item => Number(item.device.ID) === cleanId);
  if (!match) throw new Error('Chromebook not found.');

  const duplicate = devices.find(item =>
    Number(item.device.ID) !== cleanId &&
    String(item.device[columnName] || '').toLowerCase() === cleanValue.toLowerCase()
  );
  if (duplicate) {
    throw new Error(`Chromebook #${duplicate.device.ID} already uses that ${cleanField}.`);
  }

  const oldValue = match.device[columnName];
  updateDeviceRow_(match.rowNumber, {
    [columnName]: cleanValue,
    UpdatedAt: new Date(),
  });

  addLog_('edit', cleanId, `#${cleanId} ${cleanField} changed: "${oldValue}" -> "${cleanValue}"`);
}

function updateNote_(id, note) {
  const cleanId = Number(id);
  const cleanNote = String(note || '').trim();

  if (!cleanId) throw new Error('Missing Chromebook ID.');

  const devices = getDeviceRows_();
  const match = devices.find(item => Number(item.device.ID) === cleanId);
  if (!match) throw new Error('Chromebook not found.');

  updateDeviceRow_(match.rowNumber, {
    Notes: cleanNote,
    UpdatedAt: new Date(),
  });

  addLog_('edit', cleanId, cleanNote ? `#${cleanId} note saved` : `#${cleanId} note cleared`);
}

function addDevice_(barcode, serial) {
  const sheet = getSheet_(DEVICES_SHEET);
  const devices = getDeviceRows_();
  const nextId = devices.reduce((max, item) => Math.max(max, Number(item.device.ID) || 0), 0) + 1;
  const cleanBarcode = String(barcode || '').trim() || `BC-${String(nextId).padStart(6, '0')}`;
  const cleanSerial = String(serial || '').trim() || `CB-${String(nextId).padStart(6, '0')}`;

  const barcodeDuplicate = devices.find(item =>
    String(item.device.Barcode || '').toLowerCase() === cleanBarcode.toLowerCase()
  );
  if (barcodeDuplicate) {
    throw new Error(`Chromebook #${barcodeDuplicate.device.ID} already uses that barcode.`);
  }

  const serialDuplicate = devices.find(item =>
    String(item.device.Serial || '').toLowerCase() === cleanSerial.toLowerCase()
  );
  if (serialDuplicate) {
    throw new Error(`Chromebook #${serialDuplicate.device.ID} already uses that serial.`);
  }

  const now = new Date();
  sheet.appendRow([
    nextId,
    cleanBarcode,
    cleanSerial,
    'in',
    '',
    '',
    now,
    '',
  ]);

  addLog_('edit', nextId, `#${nextId} (${cleanBarcode} / ${cleanSerial}) added to inventory`);
}

function removeDevice_(id) {
  const cleanId = Number(id);
  if (!cleanId) throw new Error('Missing Chromebook ID.');

  const sheet = getSheet_(DEVICES_SHEET);
  const devices = getDeviceRows_();
  const match = devices.find(item => Number(item.device.ID) === cleanId);
  if (!match) throw new Error('Chromebook not found.');
  if (isDeviceOut_(match.device)) {
    throw new Error(`Chromebook #${cleanId} is checked out. Check it in before removing it.`);
  }

  const barcode = String(getDeviceValue_(match.device, 'Barcode') || '');
  const serial = String(getDeviceValue_(match.device, 'Serial') || '');
  sheet.deleteRow(match.rowNumber);
  addLog_('edit', cleanId, `#${cleanId} (${barcode} / ${serial}) removed from inventory`);
}

function clearLog_() {
  const sheet = getSheet_(LOG_SHEET);
  sheet.clear();
  sheet.appendRow(['Timestamp', 'Type', 'DeviceID', 'Message']);
}

function getState_() {
  const logs = getLogs_();
  const chromebooks = getDeviceRows_().map(item => {
    const device = item.device;
    const id = Number(device.ID);

    return {
      id,
      barcode: String(getDeviceValue_(device, 'Barcode') || ''),
      serial: String(getDeviceValue_(device, 'Serial') || ''),
      checkedOut: isDeviceOut_(device),
      studentId: getDeviceValue_(device, 'StudentID') ? String(getDeviceValue_(device, 'StudentID')) : null,
      checkoutTime: getDeviceValue_(device, 'CheckoutTime') ? new Date(getDeviceValue_(device, 'CheckoutTime')).toISOString() : null,
      notes: String(getDeviceValue_(device, 'Notes') || ''),
      log: logs
        .filter(entry => Number(entry.DeviceID) === id)
        .map(logToFrontend_),
    };
  });

  return {
    chromebooks,
    activityLog: logs.map(logToFrontend_),
  };
}

function getDebugInfo_() {
  const devices = getSheet_(DEVICES_SHEET);
  const lastColumn = Math.max(devices.getLastColumn(), 1);
  const headers = devices.getRange(1, 1, 1, lastColumn).getValues()[0];
  const firstDataRow = devices.getLastRow() >= 2
    ? devices.getRange(2, 1, 1, lastColumn).getValues()[0]
    : [];

  return {
    spreadsheetId: getSpreadsheet_().getId(),
    devicesSheet: DEVICES_SHEET,
    headers,
    firstDataRow,
    statusColumnIndex: headers.findIndex(header => normalizeHeader_(header) === normalizeHeader_('Status')) + 1,
    notesColumnIndex: headers.findIndex(header => normalizeHeader_(header) === normalizeHeader_('Notes')) + 1,
    supportedPostActions: ['checkout', 'checkin', 'updateDevice', 'updateNote', 'addDevice', 'removeDevice', 'clearLog'],
  };
}

function setupSpreadsheet_() {
  const devices = getSheet_(DEVICES_SHEET);
  const logs = getSheet_(LOG_SHEET);

  ensureHeaders_(devices, ['ID', 'Barcode', 'Serial', 'Status', 'StudentID', 'CheckoutTime', 'UpdatedAt', 'Notes']);
  ensureHeaders_(logs, ['Timestamp', 'Type', 'DeviceID', 'Message']);
  ensureHeaders_(getSheet_(OUT_SHEET), ['ID', 'Barcode', 'Serial', 'StudentID', 'CheckoutTime', 'Notes']);
  normalizeDeviceStatuses_();

  if (devices.getLastRow() < 2) {
    const now = new Date();
    const rows = [];
    for (let i = 1; i <= TOTAL_DEVICES; i += 1) {
      rows.push([
        i,
        `BC-${String(i).padStart(6, '0')}`,
        `CB-${String(i).padStart(6, '0')}`,
        'in',
        '',
        '',
        now,
        '',
      ]);
    }
    devices.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function updateOutSheet_() {
  const outSheet = getSheet_(OUT_SHEET);
  const headers = ['ID', 'Barcode', 'Serial', 'StudentID', 'CheckoutTime', 'Notes'];
  outSheet.clear();
  outSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const rows = getDeviceRows_()
    .filter(item => isDeviceOut_(item.device))
    .map(item => {
      const device = item.device;
      return [
        Number(getDeviceValue_(device, 'ID')),
        String(getDeviceValue_(device, 'Barcode') || ''),
        String(getDeviceValue_(device, 'Serial') || ''),
        String(getDeviceValue_(device, 'StudentID') || ''),
        getDeviceValue_(device, 'CheckoutTime') || '',
        String(getDeviceValue_(device, 'Notes') || ''),
      ];
    });

  if (rows.length > 0) {
    outSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function normalizeDeviceStatuses_() {
  const sheet = getSheet_(DEVICES_SHEET);
  if (sheet.getLastRow() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusColumn = getColumnIndex_(headers, 'Status');
  if (statusColumn < 1) return;

  const statusRange = sheet.getRange(2, statusColumn, sheet.getLastRow() - 1, 1);
  const values = statusRange.getValues();
  let changed = false;

  const normalized = values.map(row => {
    const status = String(row[0] || '').trim().toLowerCase();
    if (status === 'in' || status === 'out') return row;

    changed = true;
    return [toBoolean_(row[0]) ? 'out' : 'in'];
  });

  if (changed) statusRange.setValues(normalized);
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('No active spreadsheet. Bind this script to a Sheet or set SPREADSHEET_ID.');
  }
  return spreadsheet;
}

function getSheet_(name) {
  const spreadsheet = getSpreadsheet_();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = headers.some((header, index) => existing[index] !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function getDeviceRows_() {
  const sheet = getSheet_(DEVICES_SHEET);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  return values
    .filter(row => row[0] !== '')
    .map((row, index) => ({
      rowNumber: index + 2,
      device: rowToObject_(headers, row),
    }));
}

function getLogs_() {
  const sheet = getSheet_(LOG_SHEET);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();

  return values
    .filter(row => row[0] !== '')
    .map(row => rowToObject_(headers, row))
    .sort((a, b) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime());
}

function findDeviceByCode_(code) {
  const normalized = String(code || '').trim().toLowerCase();
  const deviceNumber = parseChromebookNumber_(normalized);

  return getDeviceRows_().find(item =>
    Number(item.device.ID) === deviceNumber ||
    String(item.device.Barcode || '').toLowerCase() === normalized ||
    String(item.device.Serial || '').toLowerCase() === normalized
  );
}

function parseChromebookNumber_(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const match = normalized.match(/^(?:chromebook|chrome\s*book|cb|#)?\s*#?\s*(\d+)$/);
  return match ? Number(match[1]) : null;
}

function updateDeviceRow_(rowNumber, changes) {
  const sheet = getSheet_(DEVICES_SHEET);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  Object.keys(changes).forEach(key => {
    const columnIndex = getColumnIndex_(headers, key);
    if (columnIndex > 0) {
      sheet.getRange(rowNumber, columnIndex).setValue(changes[key]);
    }
  });
}

function addLog_(type, deviceId, message) {
  getSheet_(LOG_SHEET).appendRow([new Date(), type, deviceId, message]);
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    const cleanHeader = String(header || '').trim();
    obj[cleanHeader] = row[index];
  });
  return obj;
}

function getDeviceValue_(device, fieldName) {
  const target = normalizeHeader_(fieldName);
  if (target === normalizeHeader_('Status')) {
    const statusValue = getDeviceValue_(device, 'StatusRaw');
    if (statusValue !== '') return statusValue;
    return getDeviceValue_(device, 'CheckedOut');
  }
  if (target === normalizeHeader_('StatusRaw')) {
    const statusKey = Object.keys(device).find(header => normalizeHeader_(header) === normalizeHeader_('Status'));
    return statusKey ? device[statusKey] : '';
  }
  const key = Object.keys(device).find(header => normalizeHeader_(header) === target);
  return key ? device[key] : '';
}

function getColumnIndex_(headers, fieldName) {
  const target = normalizeHeader_(fieldName);
  const index = headers.findIndex(header => normalizeHeader_(header) === target);
  return index + 1;
}

function isDeviceOut_(device) {
  const status = String(getDeviceValue_(device, 'Status') || '').trim().toLowerCase();
  return status === 'out' || status === 'true' || status === 'checkedout' || status === 'checked out';
}

function normalizeHeader_(header) {
  return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function logToFrontend_(entry) {
  return {
    type: String(entry.Type || ''),
    message: String(entry.Message || ''),
    time: entry.Timestamp ? new Date(entry.Timestamp).toISOString() : new Date().toISOString(),
  };
}

function toBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
