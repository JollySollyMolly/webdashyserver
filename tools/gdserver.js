#!/usr/bin/env node
/*
 * WebDash helper: local web server + Geometry Dash server proxy + Newgrounds song downloader.
 * No npm packages needed (Node 18+). Personal use.
 *
 *   node tools/gdserver.js                 start http://localhost:8080 (serves the game + /api)
 *   node tools/gdserver.js search <text> [--type 0] [--page 0] [--star] [--diff 1,2] [--len 2]
 *   node tools/gdserver.js level <id>      download a level, save to levels/<id>.txt (+ .json info)
 *   node tools/gdserver.js song <id>       download a Newgrounds / library song to songs/<id>.mp3
 *   node tools/gdserver.js daily | weekly  download the current daily / weekly level
 *
 * Why a helper is needed: the GD servers (boomlings.com) only answer POST requests that carry the
 * "secret" parameter and NO User-Agent header (Cloudflare blocks browsers), and they send no CORS
 * headers - so a web page cannot talk to them directly. This script talks to them for the page.
 *
 * Be polite: the servers rate-limit (about 20 level downloads / minute, ~2 other requests / second).
 * Everything is cached on disk in cache/, levels/ and songs/ next to index.html.
 */
'use strict';
const https = require('https'), http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), url = require('url');

const ROOT = path.resolve(__dirname, '..');
const DIRS = { cache: path.join(ROOT, 'cache'), levels: path.join(ROOT, 'levels'), songs: path.join(ROOT, 'songs') };
Object.values(DIRS).forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });

const GD_HOST = 'www.boomlings.com';
const SECRET = 'Wmfd2893gb7';                          // common secret every client request carries
const BASE = { gameVersion: 22, binaryVersion: 42, secret: SECRET };

/* ------------------------------------------------------------------ low level HTTP ---------- */
function request(method, target, body, extraHeaders, redirects) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const headers = Object.assign({}, extraHeaders || {});
    if (body) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(body); }
    // NOTE: no User-Agent header at all (node's https does not add one) - required by the GD servers.
    const req = (u.protocol === 'http:' ? http : https).request({ method, hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume(); return resolve(request(method, new URL(res.headers.location, target).toString(), body, extraHeaders, (redirects || 0) + 1));
      }
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
let lastCall = 0;
async function gd(endpoint, params) {
  const wait = lastCall + 600 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); // stay under ~2 req/s
  lastCall = Date.now();
  const body = new URLSearchParams(Object.assign({}, BASE, params)).toString();
  const res = await request('POST', `https://${GD_HOST}/database/${endpoint}`, body);
  const text = res.body.toString('utf8');
  if (res.status !== 200) throw new Error(`${endpoint}: HTTP ${res.status}${/error code: (\d+)/i.test(text) ? ' (Cloudflare ' + RegExp.$1 + ')' : ''}`);
  if (/^-\d+$/.test(text.trim())) throw new Error(`${endpoint}: server returned ${text.trim()}`);
  return text;
}

/* ------------------------------------------------------------------ response parsers -------- */
// "1:128:2:1st level:..." -> {1:'128', 2:'1st level', ...}
function kv(str, sep) { const p = str.split(sep), o = {}; for (let i = 0; i + 1 < p.length; i += 2) o[p[i]] = p[i + 1]; return o; }
const b64 = s => { try { return Buffer.from((s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { return ''; } };
const DIFF = { 0: 'N/A', 10: 'Easy', 20: 'Normal', 30: 'Hard', 40: 'Harder', 50: 'Insane' };
const DEMON = { 3: 'Easy Demon', 4: 'Medium Demon', 0: 'Hard Demon', 5: 'Insane Demon', 6: 'Extreme Demon' };
const LENGTH = ['Tiny', 'Short', 'Medium', 'Long', 'XL', 'Platformer'];
function levelInfo(o) {
  const demon = o[17] === '1', auto = o[25] === '1';
  return {
    id: +o[1], name: o[2], description: b64(o[3]), version: +o[5], playerID: +o[6],
    difficulty: auto ? 'Auto' : demon ? (DEMON[+o[43]] || 'Demon') : (DIFF[+o[9]] || 'N/A'),
    downloads: +o[10], officialSong: +o[12] || 0, likes: +o[14], length: LENGTH[+o[15]] || '?',
    stars: +o[18] || 0, featured: +o[19] > 0, epic: +o[42] || 0, customSongID: +o[35] || 0,
    coins: +o[37] || 0, verifiedCoins: o[38] === '1', objects: +o[45] || 0, gameVersion: +o[13],
    twoPlayer: o[31] === '1'
  };
}
function songInfo(str) {
  const o = kv(str, '~|~');
  return { id: +o[1], name: o[2], artistID: +o[3], artist: o[4], sizeMB: +o[5], youtube: o[6] || '', url: o[10] ? decodeURIComponent(o[10]) : '' };
}

/* ------------------------------------------------------------------ API --------------------- */
async function searchLevels(q) {
  const params = { type: q.type != null ? q.type : (q.str ? 0 : 2), str: q.str || '', page: q.page || 0, total: 0 };
  ['diff', 'len', 'featured', 'original', 'twoPlayer', 'coins', 'epic', 'star', 'noStar', 'song', 'customSong', 'demonFilter'].forEach(k => { if (q[k] != null && q[k] !== '') params[k] = q[k]; });
  const text = await gd('getGJLevels21.php', params);
  const [levels, creators, songs, page] = text.split('#');
  const users = {}; (creators || '').split('|').filter(Boolean).forEach(c => { const [uid, name, acc] = c.split(':'); users[uid] = { name, accountID: +acc }; });
  const songMap = {}; (songs || '').split('~:~').filter(Boolean).forEach(s => { const si = songInfo(s); songMap[si.id] = si; });
  const list = (levels || '').split('|').filter(Boolean).map(l => {
    const info = levelInfo(kv(l, ':'));
    info.author = (users[info.playerID] || {}).name || '-';
    if (info.customSongID && songMap[info.customSongID]) info.song = songMap[info.customSongID];
    return info;
  });
  const [total, offset, amount] = (page || '0:0:10').split(':').map(Number);
  return { total, offset, amount, levels: list };
}

async function downloadLevel(id) {
  const cached = path.join(DIRS.levels, `${id}.json`);
  if (id > 0 && fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  const text = await gd('downloadGJLevel22.php', { levelID: id });
  const parts = text.split('#');
  const o = kv(parts[0], ':');
  const info = levelInfo(o);
  info.levelString = o[4] || '';
  if (parts[4]) info.songs = parts[4].split('~:~').filter(Boolean).map(songInfo);
  if (parts[3] && parts[3].includes(':')) { const [uid, name] = parts[3].split(':'); info.author = name; }
  // password (key 27) is XOR 26364 + base64; only needed for copying in-game, not stored
  if (info.id > 0) {
    fs.writeFileSync(path.join(DIRS.levels, `${info.id}.txt`), info.levelString);
    fs.writeFileSync(path.join(DIRS.levels, `${info.id}.json`), JSON.stringify(info, null, 1));
  }
  return info;
}

let contentURL = null;
async function customContentURL() {
  if (contentURL) return contentURL;
  contentURL = (await gd('getCustomContentURL.php', {})).trim();
  return contentURL;
}
async function getSongInfo(id) {
  const cached = path.join(DIRS.cache, `song_${id}.json`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  const info = songInfo(await gd('getGJSongInfo.php', { songID: id }));
  fs.writeFileSync(cached, JSON.stringify(info, null, 1));
  return info;
}
/** Downloads a song to songs/<id>.<ext> and returns the file path.
 *  - already downloaded by the real game: %LOCALAPPDATA%\\GeometryDash\\<id>.mp3 is copied
 *  - Newgrounds songs: URL from getGJSongInfo (key 10, audio.ngfiles.com); fallback newgrounds.com/audio/download/<id>
 *    (the game itself uses exactly this fallback URL in MusicDownloadManager::downloadSong)
 *  - Music-library songs (2.2, IDs >= 10000000): <customContentURL>/music/<id>.ogg  (same as MusicDownloadManager) */
async function downloadSong(id) {
  for (const ext of ['mp3', 'ogg']) { const f = path.join(DIRS.songs, `${id}.${ext}`); if (fs.existsSync(f)) return f; }
  // songs the real game already downloaded live in its save folder as <id>.mp3 / <id>.ogg (MusicDownloadManager::pathForSong)
  const gdSave = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'GeometryDash') : null;
  if (gdSave) for (const ext of ['mp3', 'ogg']) {
    const f = path.join(gdSave, `${id}.${ext}`);
    if (fs.existsSync(f)) { const dst = path.join(DIRS.songs, `${id}.${ext}`); fs.copyFileSync(f, dst); return dst; }
  }
  const tries = [];
  if (id >= 10000000) tries.push({ url: `${await customContentURL()}/music/${id}.ogg`, ext: 'ogg' });
  else {
    try { const s = await getSongInfo(id); if (s.url) tries.push({ url: s.url, ext: 'mp3' }); } catch (e) { console.warn('song info failed:', e.message); }
    tries.push({ url: `https://www.newgrounds.com/audio/download/${id}`, ext: 'mp3' });
  }
  for (const t of tries) {
    try {
      const res = await request('GET', t.url, null, { 'User-Agent': 'Mozilla/5.0 (WebDash personal song fetcher)' });
      if (res.status === 200 && res.body.length > 10000) {
        const f = path.join(DIRS.songs, `${id}.${t.ext}`); fs.writeFileSync(f, res.body); return f;
      }
      console.warn(`song ${id}: ${t.url} -> HTTP ${res.status}, ${res.body.length} bytes`);
    } catch (e) { console.warn(`song ${id}: ${t.url} -> ${e.message}`); }
  }
  throw new Error(`could not download song ${id} (it may be blocked by the artist or removed from Newgrounds)`);
}

/* ------------------------------------------------------------------ web server -------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css' };
function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}
function startServer(port) {
  http.createServer(async (req, res) => {
    const u = url.parse(req.url, true), p = decodeURIComponent(u.pathname);
    try {
      if (p === '/api/ping') return sendJSON(res, 200, { ok: true });
      if (p === '/api/search') return sendJSON(res, 200, await searchLevels(u.query));
      let m;
      if ((m = /^\/api\/level\/(-?\d+)$/.exec(p))) return sendJSON(res, 200, await downloadLevel(+m[1]));
      if ((m = /^\/api\/song\/(\d+)$/.exec(p))) return sendJSON(res, 200, await getSongInfo(+m[1]));
      if ((m = /^\/api\/song\/(\d+)\/file$/.exec(p))) return serveFile(res, await downloadSong(+m[1]));
      // the official game's Resources folder (when webdash sits inside the Geometry Dash folder)
      if (p.startsWith('/gdres/')) return serveFile(res, path.join(ROOT, '..', 'Resources', path.basename(p)));
      const file = path.join(ROOT, path.normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[\/\\])+/, ''));
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      serveFile(res, file);
    } catch (e) { console.warn(p, e.message); sendJSON(res, 502, { error: e.message }); }
  }).listen(port, '127.0.0.1', () => console.log(`WebDash running at http://localhost:${port}/  (Ctrl+C to stop)`));
}

/* ------------------------------------------------------------------ CLI --------------------- */
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = {}; const args = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) { const k = rest[i].slice(2); flags[k] = (rest[i + 1] && !rest[i + 1].startsWith('--')) ? rest[++i] : 1; } else args.push(rest[i]); }
  if (!cmd || cmd === 'serve') return startServer(+(flags.port || 8080));
  if (cmd === 'search') {
    const r = await searchLevels(Object.assign({ str: args.join(' ') }, flags));
    console.log(`${r.total} results (showing ${r.offset}-${r.offset + r.levels.length})`);
    r.levels.forEach(l => console.log(`${String(l.id).padStart(10)}  ${l.name}  by ${l.author}  [${l.difficulty}${l.stars ? ' ' + l.stars + '*' : ''}, ${l.length}, ${l.objects || '?'} objs, song ${l.customSongID || 'official #' + l.officialSong}]`));
    return;
  }
  if (cmd === 'level' || cmd === 'daily' || cmd === 'weekly') {
    const id = cmd === 'daily' ? -1 : cmd === 'weekly' ? -2 : +args[0];
    const l = await downloadLevel(id);
    console.log(`${l.name} (id ${l.id}) by ${l.author || l.playerID} - ${l.levelString.length} chars - saved to levels/${l.id}.txt`);
    if (l.customSongID) console.log(`custom song ${l.customSongID}: node tools/gdserver.js song ${l.customSongID}`);
    return;
  }
  if (cmd === 'song') { const f = await downloadSong(+args[0]); console.log('saved', f); return; }
  console.log('usage: node tools/gdserver.js [serve|search <text>|level <id>|daily|weekly|song <id>]');
}
if (require.main === module) main().catch(e => { console.error('error:', e.message); process.exit(1); });
module.exports = { searchLevels, downloadLevel, downloadSong, getSongInfo, kv, levelInfo, songInfo };
