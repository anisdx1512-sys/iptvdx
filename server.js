const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 5000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.m3u':  'application/x-mpegurl',
  '.m3u8': 'application/x-mpegurl',
};

function fetchRemote(targetUrl, res, extraHeaders) {
  const parsed = url.parse(targetUrl);
  const lib = parsed.protocol === 'https:' ? https : http;

  const reqOpts = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 IPTV',
      'Accept': '*/*',
      ...(extraHeaders || {}),
    },
    timeout: 20000,
  };

  const proxyReq = lib.request(reqOpts, (proxyRes) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    const ct = proxyRes.headers['content-type'] || '';
    if (ct) headers['Content-Type'] = ct;

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      res.end(`Proxy error: ${e.message}`);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Access-Control-Allow-Origin': '*' });
      res.end('Gateway timeout');
    }
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'running', name: 'IPTV Proxy Server' }));
    return;
  }

  if (pathname === '/proxy' || pathname === '/stream') {
    const target = parsed.query.url;
    if (!target) { res.writeHead(400); res.end('Missing url param'); return; }
    fetchRemote(target, res);
    return;
  }

  if (pathname === '/m3u') {
    const target = parsed.query.url;
    if (!target) { res.writeHead(400); res.end('Missing url param'); return; }
    fetchRemote(target, res, { 'Accept': 'application/x-mpegurl, */*' });
    return;
  }

  if (pathname === '/xtream') {
    const { server: srv, user, pass, action, ...rest } = parsed.query;
    if (!srv || !user || !pass || !action) { res.writeHead(400); res.end('Missing params'); return; }
    let extra = '';
    Object.keys(rest).forEach(k => { extra += `&${k}=${rest[k]}`; });
    const target = `${srv}/player_api.php?username=${user}&password=${pass}&action=${action}${extra}`;
    fetchRemote(target, res);
    return;
  }

  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`IPTV Proxy Server running on port ${PORT}`);
});
