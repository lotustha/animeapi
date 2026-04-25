// Simple test server for cPanel - no dependencies, pure Node.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE = path.resolve(__dirname, 'test-startup.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// Clear log
try { fs.writeFileSync(LOG_FILE, ''); } catch {}

log(`Starting simple test server...`);
log(`Node.js ${process.version}`);
log(`PID: ${process.pid}`);
log(`CWD: ${process.cwd()}`);
log(`__dirname: ${__dirname}`);
log(`PORT env: ${process.env.PORT || '(not set)'}`);
log(`NODE_ENV: ${process.env.NODE_ENV || '(not set)'}`);

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  log(`Request: ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    message: 'cPanel Node.js is working!',
    node: process.version,
    port: port,
    pid: process.pid,
    url: req.url,
    method: req.method,
    headers: req.headers,
    env: {
      PORT: process.env.PORT || '(not set)',
      NODE_ENV: process.env.NODE_ENV || '(not set)',
      BASE_PATH: process.env.BASE_PATH || '(not set)',
    },
    time: new Date().toISOString()
  }, null, 2));
});

server.listen(port, '0.0.0.0', () => {
  log(`✅ Test server listening on 0.0.0.0:${port}`);
});

server.on('error', (err) => {
  log(`❌ Server error: ${err.message}`);
  log(`   Code: ${err.code}`);
  if (err.code === 'EADDRINUSE') {
    log(`   Port ${port} is already in use. Try a different port.`);
  }
});
