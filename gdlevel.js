/* gdlevel.js - Geometry Dash level-data parser (browser + Node).
 *
 * Handles:
 *   - level strings as stored in Resources/levels/*.txt and in level saves
 *     (URL-safe base64 -> gzip/zlib -> "header;obj;obj;...", also already-decoded text)
 *   - the header (kA and kS keys, legacy kS29-kS37 colours, kS38 colour channels)
 *   - objects (numeric property keys -> named, typed properties; unknown keys kept as k<N>)
 *   - save files (CCLocalLevels.dat: xor 11 -> base64 -> gzip -> plist-ish XML)
 *   - analysis(): which gamemodes / speeds / mechanics a level uses
 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports && typeof process !== 'undefined' && process.versions && process.versions.node;
  var nodeZlib = null;
  if (isNode) { try { nodeZlib = require('zlib'); } catch (e) {} }

  /* ------------------------------------------------------------------ keys */
  // object property key -> [name, type]; types: int float bool str ints (dot list) hsv
  var OBJ_KEYS = {
    1: ['id', 'int'], 2: ['x', 'float'], 3: ['y', 'float'], 4: ['flipX', 'bool'], 5: ['flipY', 'bool'], 6: ['rotation', 'float'],
    7: ['r', 'int'], 8: ['g', 'int'], 9: ['b', 'int'], 10: ['duration', 'float'], 11: ['touchTriggered', 'bool'],
    12: ['pickupId', 'int'], 13: ['checked', 'bool'], 14: ['tintGround', 'bool'], 15: ['p1Color', 'bool'], 16: ['p2Color', 'bool'],
    17: ['blending', 'bool'], 20: ['editorLayer', 'int'], 21: ['mainColor', 'int'], 22: ['secondaryColor', 'int'],
    23: ['targetColor', 'int'], 24: ['zLayer', 'int'], 25: ['zOrder', 'int'], 28: ['moveX', 'float'], 29: ['moveY', 'float'],
    30: ['easing', 'int'], 31: ['text', 'str'], 32: ['scale', 'float'], 35: ['opacity', 'float'],
    41: ['mainHsvOn', 'bool'], 42: ['secondaryHsvOn', 'bool'], 43: ['mainHsv', 'hsv'], 44: ['secondaryHsv', 'hsv'],
    45: ['fadeIn', 'float'], 46: ['hold', 'float'], 47: ['fadeOut', 'float'], 48: ['pulseMode', 'int'], 49: ['copiedHsv', 'hsv'],
    50: ['copiedColor', 'int'], 51: ['targetGroup', 'int'], 52: ['pulseTarget', 'int'], 54: ['portalOffset', 'float'],
    56: ['activateGroup', 'bool'], 57: ['groups', 'ints'], 58: ['lockX', 'bool'], 59: ['lockY', 'bool'], 60: ['copyOpacity', 'bool'],
    62: ['spawnTriggered', 'bool'], 63: ['spawnDelay', 'float'], 64: ['dontFade', 'bool'], 65: ['mainOnly', 'bool'],
    66: ['detailOnly', 'bool'], 67: ['dontEnter', 'bool'], 68: ['degrees', 'float'], 69: ['times360', 'int'],
    70: ['lockRotation', 'bool'], 71: ['followGroup', 'int'], 72: ['xMod', 'float'], 73: ['yMod', 'float'], 75: ['strength', 'float'],
    76: ['animationId', 'int'], 77: ['count', 'int'], 78: ['subtractCount', 'bool'], 79: ['pickupMode', 'int'],
    80: ['itemId', 'int'], 81: ['holdMode', 'bool'], 82: ['toggleMode', 'int'], 85: ['interval', 'float'], 87: ['multiTrigger', 'bool'],
    103: ['highDetail', 'bool'], 108: ['linkedGroup', 'int'], 128: ['scaleX', 'float'], 129: ['scaleY', 'float']
  };
  var HEADER_KEYS = {
    kA1: ['audioTrack', 'int'], kA2: ['startMode', 'int'], kA3: ['startMini', 'bool'], kA4: ['startSpeed', 'int'], kA6: ['background', 'int'],
    kA7: ['ground', 'int'], kA8: ['startDual', 'bool'], kA10: ['twoPlayer', 'bool'], kA11: ['startFlipped', 'bool'],
    kA13: ['songOffset', 'float'], kA15: ['fadeIn', 'bool'], kA16: ['fadeOut', 'bool'], kA17: ['groundLine', 'int'], kA18: ['font', 'int'],
    kA20: ['reverse', 'bool'], kA22: ['platformer', 'bool'], kA25: ['middleground', 'int'], kA28: ['mirror', 'bool'],
    kA29: ['rotateGameplay', 'bool'], kA36: ['spawnGroup', 'int'], kA40: ['enable22Changes', 'bool']
  };
  var MODE_NAMES = ['cube', 'ship', 'ball', 'ufo', 'wave', 'robot', 'spider', 'swing'];
  var SPEED_NAMES = ['normal', 'slow', 'fast', 'faster', 'fastest'];
  // units / second
  var SPEED_UPS = { normal: 311.58, slow: 251.16, fast: 387.42, faster: 468.0, fastest: 576.0 };

  /* ----------------------------------------------------------------- bytes */
  function b64ToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
    while (s.length % 4) s += '=';
    if (isNode) return new Uint8Array(Buffer.from(s, 'base64'));
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToStr(u8) {
    if (isNode) return Buffer.from(u8).toString('latin1');
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return s;
  }
  function strToBytes(s) { var o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }

  function looksDecoded(s) { return /^k[AS]\d+,/.test(s) || s.charAt(0) === ';' || /^\d+,\d+/.test(s); }
  function kindOf(u8) {
    if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) return 'gzip';
    if (u8.length > 2 && (u8[0] & 0x0f) === 8 && ((u8[0] << 8) | u8[1]) % 31 === 0) return 'zlib';
    return 'raw';
  }
  function inflateSync(u8) {
    if (!nodeZlib) throw new Error('synchronous inflate needs Node; use the async API in the browser');
    var k = kindOf(u8), b = Buffer.from(u8);
    return new Uint8Array(k === 'gzip' ? nodeZlib.gunzipSync(b) : k === 'zlib' ? nodeZlib.inflateSync(b) : b);
  }
  function inflateAsync(u8) {
    if (nodeZlib) return Promise.resolve(inflateSync(u8));
    var k = kindOf(u8);
    if (k === 'raw') return Promise.resolve(u8);
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser has no DecompressionStream; use a current Chrome/Edge/Firefox/Safari'));
    var ds = new DecompressionStream(k === 'gzip' ? 'gzip' : 'deflate');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  /** level string (compressed or already decoded) -> decoded text. */
  function decodeLevelStringSync(str) {
    str = String(str).trim();
    if (looksDecoded(str)) return str;
    return bytesToStr(inflateSync(b64ToBytes(str)));
  }
  function decodeLevelString(str) {
    str = String(str).trim();
    if (looksDecoded(str)) return Promise.resolve(str);
    return inflateAsync(b64ToBytes(str)).then(bytesToStr);
  }

  /* --------------------------------------------------------------- parsing */
  function pairs(str, sep) {          // "a,1,b,2" -> {a:'1', b:'2'}
    var p = str.split(sep || ','), o = {};
    for (var i = 0; i + 1 < p.length; i += 2) o[p[i]] = p[i + 1];
    return o;
  }
  function toBool(v) { return v === '1' || v === 'true'; }
  function coerce(type, v) {
    switch (type) {
      case 'int': { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
      case 'float': { var f = parseFloat(v); return isNaN(f) ? 0 : f; }
      case 'bool': return toBool(v);
      case 'ints': return v === '' ? [] : v.split('.').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
      case 'hsv': { var a = v.split('a'); return { h: +a[0] || 0, s: +a[1] || 1, v: +a[2] || 1, sAdd: a[3] === '1', vAdd: a[4] === '1' }; }
      default: return v;
    }
  }
  function parseObject(str) {
    var p = str.split(','), o = {}, unknown = null;
    for (var i = 0; i + 1 < p.length; i += 2) {
      var k = p[i], d = OBJ_KEYS[k];
      if (d) o[d[0]] = coerce(d[1], p[i + 1]);
      else { (unknown || (unknown = {}))[k] = p[i + 1]; }
    }
    if (o.id === undefined) return null;
    if (o.x === undefined) o.x = 0;
    if (o.y === undefined) o.y = 0;
    if (unknown) o.extra = unknown;
    return o;
  }
  function parseLegacyColor(s) {      // "1_40_2_62_3_255_4_0_5_0"
    var o = pairs(s, '_');
    return { r: +o[1] || 0, g: +o[2] || 0, b: +o[3] || 0, playerColor: +o[4] || 0, blending: o[5] === '1' };
  }
  function parseColorChannels(s) {    // kS38: "1_r_2_g_3_b_..._6_id_..|..."
    var out = [];
    s.split('|').forEach(function (c) {
      if (!c) return;
      var o = pairs(c, '_');
      if (o[6] === undefined) return;
      out.push({
        id: +o[6], r: +o[1] || 0, g: +o[2] || 0, b: +o[3] || 0,
        opacity: o[7] !== undefined ? +o[7] : 1, blending: o[5] === '1',
        playerColor: o[4] !== undefined ? +o[4] : -1,
        copyId: o[9] !== undefined ? +o[9] : 0, copyHsv: o[10] || null, raw: o
      });
    });
    return out;
  }
  function parseHeader(str) {
    var p = str.split(','), h = { raw: {}, colors: {}, channels: [] };
    for (var i = 0; i + 1 < p.length; i += 2) {
      var k = p[i], v = p[i + 1];
      h.raw[k] = v;
      if (HEADER_KEYS[k]) h[HEADER_KEYS[k][0]] = coerce(HEADER_KEYS[k][1], v);
      else if (/^kS(29|3[0-7])$/.test(k)) h.colors[k] = parseLegacyColor(v);
      else if (k === 'kS38') h.channels = parseColorChannels(v);
    }
    var c = h.colors;
    h.bgColor = c.kS29 ? [c.kS29.r, c.kS29.g, c.kS29.b] : null;
    h.groundColor = c.kS30 ? [c.kS30.r, c.kS30.g, c.kS30.b] : null;
    if (h.startMode === undefined) h.startMode = 0;
    if (h.startSpeed === undefined) h.startSpeed = 0;
    h.modeName = MODE_NAMES[h.startMode] || 'cube';
    h.speedName = SPEED_NAMES[h.startSpeed] || 'normal';
    return h;
  }

  /** decoded text -> {header, objects} */
  function parseLevel(text) {
    var parts = text.split(';');
    var level = { header: parseHeader(parts[0]), objects: [], badRecords: 0 };
    for (var i = 1; i < parts.length; i++) {
      if (!parts[i]) continue;
      var o = parseObject(parts[i]);
      if (o) level.objects.push(o); else level.badRecords++;
    }
    level.objects.sort(function (a, b) { return a.x - b.x; });
    return level;
  }
  /** level string (any form) -> Promise<parsed level> */
  function loadLevelString(str) { return decodeLevelString(str).then(parseLevel); }
  function loadLevelStringSync(str) { return parseLevel(decodeLevelStringSync(str)); }

  /* ------------------------------------------------------------ save files */
  // GD plist-ish XML: <d> dict, <a> array, <k> key, <s> string, <i> int, <r> real, <t/> true, <f/> false
  function parsePlist(xml) {
    var re = /<(\/?)(d|a|k|s|i|r|t|f)(\s*\/)?>|([^<]+)/g, m, stack = [], cur = null, key = null, root = null, pend = null;
    function put(v) {
      if (!cur) { root = v; return; }
      if (Array.isArray(cur)) cur.push(v); else { cur[key] = v; key = null; }
    }
    while ((m = re.exec(xml))) {
      if (m[4] !== undefined) { if (pend) pend.text += m[4]; continue; }
      var close = m[1] === '/', tag = m[2], self = !!m[3];
      if (pend && close && tag === pend.tag) {
        var t = pend.text; pend = null;
        if (tag === 'k') key = t; else if (tag === 's') put(t); else if (tag === 'i') put(parseInt(t, 10)); else if (tag === 'r') put(parseFloat(t));
        continue;
      }
      if (close) { if (tag === 'd' || tag === 'a') cur = stack.pop(); continue; }
      if (tag === 't') { put(true); continue; }
      if (tag === 'f') { put(false); continue; }
      if (tag === 'd' || tag === 'a') {
        var n = tag === 'a' ? [] : {};
        put(n); stack.push(cur); cur = n;
        if (self) cur = stack.pop();
        continue;
      }
      if (!self) pend = { tag: tag, text: '' };
      else if (tag === 's') put('');
    }
    return root;
  }
  function xorBytes(u8, k) { var o = new Uint8Array(u8.length); for (var i = 0; i < u8.length; i++) o[i] = u8[i] ^ k; return o; }
  /** raw bytes of CCLocalLevels.dat (or CCGameManager.dat-style) -> XML text */
  function decodeSaveFileBytes(u8) {
    var head = bytesToStr(u8.subarray(0, 20));
    if (/^\s*<\?xml|^\s*<plist/.test(head)) return Promise.resolve(bytesToStr(u8));
    var txt = bytesToStr(xorBytes(u8, 11));
    return inflateAsync(b64ToBytes(txt)).then(bytesToStr);
  }
  /** XML -> [{name, description, levelString, audioTrack, songId, raw}] */
  function levelsFromSaveXml(xml) {
    var root = parsePlist(xml), out = [];
    var list = root && (root.LLM_01 || root);
    if (!list || typeof list !== 'object') return out;
    Object.keys(list).forEach(function (k) {
      var v = list[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.k4 === 'string') {
        var desc = v.k3 || '';
        try { desc = bytesToStr(b64ToBytes(desc)); } catch (e) {}
        out.push({ name: v.k2 || 'Unnamed', description: desc, levelString: v.k4, audioTrack: v.k8 | 0, songId: v.k45 | 0, raw: v });
      }
    });
    return out;
  }

  /* -------------------------------------------------------------- analysis */
  var PORTAL_MODE = { 12: 0, 13: 1, 47: 2, 111: 3, 660: 4, 745: 5, 1331: 6, 1933: 7 };
  var SPEED_PORT = { 200: 'slow', 201: 'normal', 202: 'fast', 203: 'faster', 1334: 'fastest' };
  var GRAV_PORT = { 10: 'down', 11: 'up' };
  var SIZE_PORT = { 99: 'normal', 101: 'mini' };
  var PADS = { 35: 'yellow', 140: 'pink', 1332: 'red', 67: 'blue', 3005: 'spider' };
  var ORBS = { 36: 'yellow', 141: 'pink', 1333: 'red', 84: 'blue', 1022: 'green', 1330: 'black', 1704: 'dash', 1751: 'dash' };
  var TRIGGERS = { 29: 'bgColor', 30: 'groundColor', 105: 'obj color(legacy)', 744: '3dl color', 899: 'color', 901: 'move', 1007: 'alpha', 1006: 'pulse',
    1268: 'spawn', 1346: 'rotate', 1347: 'follow', 1520: 'shake', 1595: 'touch', 1611: 'count', 1612: 'instant count', 1616: 'stop', 1817: 'pickup', 1049: 'toggle', 1914: 'camera', 2999: 'move' };

  function analyze(level) {
    var f = { modes: {}, speeds: {}, gravity: 0, size: 0, pads: {}, orbs: {}, triggers: {}, mirror: 0, dual: 0, coins: 0, idCounts: {}, endX: 0 };
    f.modes[MODE_NAMES[level.header.startMode] || 'cube'] = 1;
    f.speeds[level.header.speedName] = 1;
    level.objects.forEach(function (o) {
      var id = o.id; f.idCounts[id] = (f.idCounts[id] || 0) + 1;
      if (o.x > f.endX) f.endX = o.x;
      if (id in PORTAL_MODE) f.modes[MODE_NAMES[PORTAL_MODE[id]]] = (f.modes[MODE_NAMES[PORTAL_MODE[id]]] || 0) + 1;
      else if (id in SPEED_PORT) f.speeds[SPEED_PORT[id]] = (f.speeds[SPEED_PORT[id]] || 0) + 1;
      else if (id in GRAV_PORT) f.gravity++;
      else if (id in SIZE_PORT) { if (id === 101) f.size++; }
      else if (id in PADS) f.pads[PADS[id]] = (f.pads[PADS[id]] || 0) + 1;
      else if (id in ORBS) f.orbs[ORBS[id]] = (f.orbs[ORBS[id]] || 0) + 1;
      else if (id === 45 || id === 46) f.mirror++;
      else if (id === 286 || id === 287) f.dual++;
      else if (id === 142 || id === 1329) f.coins++;
      else if (id in TRIGGERS) f.triggers[TRIGGERS[id]] = (f.triggers[TRIGGERS[id]] || 0) + 1;
    });
    return f;
  }

  var api = {
    OBJ_KEYS: OBJ_KEYS, HEADER_KEYS: HEADER_KEYS, MODE_NAMES: MODE_NAMES, SPEED_NAMES: SPEED_NAMES, SPEED_UPS: SPEED_UPS,
    PORTAL_MODE: PORTAL_MODE, SPEED_PORT: SPEED_PORT, GRAV_PORT: GRAV_PORT, SIZE_PORT: SIZE_PORT, PADS: PADS, ORBS: ORBS,
    decodeLevelString: decodeLevelString, decodeLevelStringSync: decodeLevelStringSync,
    parseLevel: parseLevel, loadLevelString: loadLevelString, loadLevelStringSync: loadLevelStringSync,
    parseHeader: parseHeader, parseObject: parseObject, parseColorChannels: parseColorChannels, parsePlist: parsePlist,
    decodeSaveFileBytes: decodeSaveFileBytes, levelsFromSaveXml: levelsFromSaveXml, analyze: analyze
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GDLevel = api;
})(typeof window !== 'undefined' ? window : globalThis);
