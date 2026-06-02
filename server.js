const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const TOTAL = 32;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const clients = new Set();
let state = loadState();

function createDefaultState() {
  return {
    chromebooks: Array.from({ length: TOTAL }, (_, i) => ({
      id: i + 1,
      barcode: `BC-${String(i + 1).padStart(6, '0')}`,
      serial: `CB-${String(i + 1).padStart(6, '0')}`,
      checkedOut: false,
      studentId: null,
      checkoutTime: null,
      log: [],
    })),
    activityLog: [],
  };
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(DB_PATH)) {
    const defaults = createDefaultState();
    saveState(defaults);
    return defaults;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const defaults = createDefaultState();
    return {
      chromebooks: defaults.chromebooks.map(defaultCb => ({
        ...defaultCb,
        ...(parsed.chromebooks || []).find(cb => cb.id === defaultCb.id),
        log: Array.isArray((parsed.chromebooks || []).find(cb => cb.id === defaultCb.id)?.log)
          ? (parsed.chromebooks || []).find(cb => cb.id === defaultCb.id).log
          : [],
      })),
      activityLog: Array.isArray(parsed.activityLog) ? parsed.activityLog : [],
    };
  } catch (err) {
    const defaults = createDefaultState();
    saveState(defaults);
    return defaults;
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveState(nextState = state) {
  ensureDataDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(nextState, null, 2));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
  });
  res.end(JSON.stringify(data));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  };
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large.'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function findChromebookByDeviceCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return state.chromebooks.find(cb =>
    cb.barcode.toLowerCase() === normalized || cb.serial.toLowerCase() === normalized
  );
}

function addLog(type, message, cbId) {
  const entry = { type, message, time: new Date().toISOString() };
  state.activityLog.unshift(entry);

  if (cbId != null) {
    const cb = state.chromebooks.find(device => device.id === cbId);
    if (cb) cb.log.unshift(entry);
  }
}

function commitState() {
  saveState();
  broadcastState();
}

function broadcastState() {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  clients.forEach(client => client.write(payload));
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(),
    });
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    const { deviceCode, studentId } = await readBody(req);
    const cleanDeviceCode = String(deviceCode || '').trim();
    const cleanStudentId = String(studentId || '').trim();

    if (!cleanDeviceCode || !cleanStudentId) {
      sendError(res, 400, 'Please fill in both Chromebook barcode/serial and Student ID.');
      return;
    }

    const cb = findChromebookByDeviceCode(cleanDeviceCode);
    if (!cb) {
      sendError(res, 404, `No Chromebook found with barcode or serial "${cleanDeviceCode}".`);
      return;
    }
    if (cb.checkedOut) {
      sendError(res, 409, `Chromebook #${cb.id} is already checked out.`);
      return;
    }

    cb.checkedOut = true;
    cb.studentId = cleanStudentId;
    cb.checkoutTime = new Date().toISOString();
    addLog('checkout', `#${cb.id} (${cb.barcode} / ${cb.serial}) checked out to Student ${cleanStudentId}`, cb.id);
    commitState();
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/checkin') {
    const { studentId } = await readBody(req);
    const cleanStudentId = String(studentId || '').trim();

    if (!cleanStudentId) {
      sendError(res, 400, 'Please enter a Student ID.');
      return;
    }

    const cb = state.chromebooks.find(device =>
      device.checkedOut && device.studentId && device.studentId.toLowerCase() === cleanStudentId.toLowerCase()
    );

    if (!cb) {
      sendError(res, 404, `No Chromebook found checked out to Student ID "${cleanStudentId}".`);
      return;
    }

    const prevStudent = cb.studentId;
    cb.checkedOut = false;
    cb.studentId = null;
    cb.checkoutTime = null;
    addLog('checkin', `#${cb.id} (${cb.serial}) returned by Student ${prevStudent}`, cb.id);
    commitState();
    sendJson(res, 200, state);
    return;
  }

  const deviceMatch = url.pathname.match(/^\/api\/devices\/(\d+)$/);
  if (req.method === 'PATCH' && deviceMatch) {
    const id = Number(deviceMatch[1]);
    const cb = state.chromebooks.find(device => device.id === id);
    if (!cb) {
      sendError(res, 404, 'Chromebook not found.');
      return;
    }

    const { field, value } = await readBody(req);
    const cleanField = String(field || '').trim();
    const cleanValue = String(value || '').trim();
    if (!['barcode', 'serial'].includes(cleanField)) {
      sendError(res, 400, 'Only barcode and serial can be edited.');
      return;
    }
    if (!cleanValue) {
      sendError(res, 400, 'Please enter a value.');
      return;
    }

    const duplicate = state.chromebooks.find(device =>
      device.id !== id && device[cleanField].toLowerCase() === cleanValue.toLowerCase()
    );
    if (duplicate) {
      sendError(res, 409, `Chromebook #${duplicate.id} already uses that ${cleanField}.`);
      return;
    }

    const oldVal = cb[cleanField];
    cb[cleanField] = cleanValue;
    addLog('edit', `#${cb.id} ${cleanField} changed: "${oldVal}" -> "${cleanValue}"`, cb.id);
    commitState();
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/log/clear') {
    state.activityLog = [];
    state.chromebooks.forEach(cb => {
      cb.log = [];
    });
    commitState();
    sendJson(res, 200, state);
    return;
  }

  sendError(res, 404, 'API endpoint not found.');
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR) || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, contents) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-store',
    });
    res.end(contents);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

const requestHandler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (err) {
    sendError(res, 500, err.message || 'Server error.');
  }
};

const hasHttpsConfig = process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH;
const server = hasHttpsConfig
  ? https.createServer({
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    }, requestHandler)
  : http.createServer(requestHandler);
const protocol = hasHttpsConfig ? 'https' : 'http';

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chromebook Checkout server running at ${protocol}://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
