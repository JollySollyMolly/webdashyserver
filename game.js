/* WebDash renderer / game loop. Needs data.js (GD_DATA) and engine.js (GDEngine). */
(function () {
  'use strict';
  var E = window.GDEngine, F = window.GD_DATA.frames, GL = window.GDLevel, GO = window.GDObjects;
  if (GO.setDB) GO.setDB(window.GD_OBJDB);
  var LV = null, world = null, lv = [], curInfo = null, trigs = [];
  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  var DEBUG = /[?&]debug/.test(location.search);
  var VIEW_H = 320, PLAYER_SCREEN = 0.33;
  var P1 = [125, 255, 0], P2 = [0, 255, 255];
  var A = 'assets/';

  /* ---------- assets ---------- */
  var sheets = {}, loadCount = 0, loadTotal = 0;
  function loadImg(name, src) {
    loadTotal++;
    var im = new Image();
    im.onload = im.onerror = function () { loadCount++; if (loadCount === loadTotal) prepare(); };
    im.src = src; sheets[name] = im; return im;
  }
  // Decode every texture up front and push it to the GPU once, so the first time a sprite sheet is
  // used mid-level the game doesn't freeze for a moment (which felt like input lag).
  function prepare() {
    var names = Object.keys(sheets);
    var jobs = names.map(function (n) {
      var im = sheets[n];
      if (!im.naturalWidth || !window.createImageBitmap) return Promise.resolve();
      return createImageBitmap(im).then(function (bm) { sheets[n] = bm; }, function () {});
    });
    Promise.all(jobs).then(function () {
      bgImg = sheets.bg; groundImg = sheets.ground;
      names.forEach(function (n) { try { ctx.drawImage(sheets[n], 0, 0, 1, 1); } catch (e) {} });
      ctx.clearRect(0, 0, 2, 2);
      ready();
    });
  }
  ['GJ_GameSheet', 'GJ_GameSheet02', 'GJ_GameSheet03', 'GJ_GameSheet04', 'GJ_GameSheetGlow'].forEach(function (n) { loadImg(n, A + n + '-hd.png'); });
  (window.GD_ICON_SHEETS || ['player_01', 'ship_01']).forEach(function (n) { loadImg(n, A + 'icons/' + n + '-hd.png'); });
  var bgImg = loadImg('bg', A + 'game_bg_01_001-hd.png'), groundImg = loadImg('ground', A + 'groundSquare_01_001-hd.png');

  var music = new Audio(A + 'StereoMadness.mp3'); music.preload = 'auto';
  function sfx(n, vol) { try { var a = new Audio(A + n); a.volume = vol || 0.8; a.play().catch(function () {}); } catch (e) {} }

  /* ---------- sprite drawing ---------- */
  var tintCache = {};
  function tinted(img, sx, sy, sw, sh, col, key) {
    var k = key + '|' + col.join(',');
    if (tintCache[k]) return tintCache[k];
    var c = document.createElement('canvas'); c.width = sw; c.height = sh;
    var g = c.getContext('2d');
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')'; g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    tintCache[k] = c; return c;
  }
  var sprite;
  // draw frame centred at (wx, wy) in world units. rot = degrees clockwise.
  sprite = function (name, wx, wy, o) {
    var f = F[name]; if (!f) return;
    o = o || {};
    var img = sheets[f.sheet];
    var rw = f.rot ? f.h : f.w, rh = f.rot ? f.w : f.h;
    var src = img, sx = f.x, sy = f.y;
    if (o.tint) { src = tinted(img, f.x, f.y, rw, rh, o.tint, name); sx = 0; sy = 0; }
    var sc = (o.scale || 1) * 0.5;
    var p = toScreen(wx, wy);
    ctx.save();
    ctx.translate(p[0], p[1]);
    if (o.rot) ctx.rotate(o.rot * Math.PI / 180);
    ctx.scale((o.fx ? -1 : 1) * view.s, (o.fy ? -1 : 1) * view.s);
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    if (o.add) ctx.globalCompositeOperation = 'lighter';
    ctx.translate((f.ox || 0) * sc, -(f.oy || 0) * sc);
    if (f.rot) { ctx.rotate(-Math.PI / 2); ctx.drawImage(src, sx, sy, rw, rh, -rw * sc / 2, -rh * sc / 2, rw * sc, rh * sc); }
    else ctx.drawImage(src, sx, sy, rw, rh, -rw * sc / 2, -rh * sc / 2, rw * sc, rh * sc);
    ctx.restore();
  };

  /* ---------- view ---------- */
  var view = { w: 569, s: 1, camX: 0, camB: -90, gyDraw: 0, ceil: 0 };
  function toScreen(wx, wy) { return [(wx - view.camX) * view.s, canvas.height - (wy - view.camB) * view.s]; }
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr); canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
    view.s = canvas.height / VIEW_H; view.w = canvas.width / view.s;
  }
  window.addEventListener('resize', resize); resize();

  /* ---------- level loading ---------- */
  var BLACK = [0, 0, 0];
  function artFor(o) {
    var cl = GO.classify(o.id), f = cl.frame;
    if (!f || cl.cat === 'trigger' || cl.cat === 'none') return null;
    var out = [];
    if (cl.cat === 'portal') {
      out.push({ f: f.replace('_front_', '_back_'), z: 0 }); out.push({ f: f.replace('_back_', '_front_'), z: 2 }); return out;
    }
    var a = { f: f, z: cl.cat === 'deco' ? 0 : 1 };
    if (/^pit_/.test(f)) a.tint = BLACK;
    if (cl.cat === 'deco' && /^(d_|chain)/.test(f)) a.alpha = 0.55;
    return [a];
  }
  function loadLevel(level, info) {
    LV = level; curInfo = info || {};
    world = E.buildWorld(LV, GO.classify);
    lv = LV.objects.map(function (o) { return { o: o, art: artFor(o) }; }).filter(function (e) { return e.art; });
    trigs = LV.objects.filter(function (o) { return o.id === 29 || o.id === 30; })
      .map(function (o) { return { x: o.x, bg: o.id === 29, c: [o.r, o.g, o.b], d: o.duration || 0 }; });
    var hc = (LV.header && LV.header.colors) || {};
    baseBG = hc.kS29 ? [hc.kS29.r, hc.kS29.g, hc.kS29.b] : [40, 125, 255];
    baseGR = hc.kS30 ? [hc.kS30.r, hc.kS30.g, hc.kS30.b] : [0, 102, 255];
    try { music.pause(); } catch (e) {}
    music = makeMusic(musicSources(curInfo, LV));
    attempt = 1; best = 0; won = false; started = false;
    resetRun();
    var un = world.unsupported, bad = Object.keys(un).map(function (k) { return k + ' x' + un[k]; });
    showOverlay((curInfo.name || 'Level'), (bad.length ? 'Not yet supported: ' + bad.join(', ') + ' (may be impossible)  •  ' : '') + 'Click, tap, or press Space to start  •  Esc = menu');
    document.getElementById('menu').style.display = 'none';
  }
  /* ---------- music ----------
     Official songs: file names from LevelTools::getAudioFileName (0-based audio track). They live in the
     game's own Resources folder, so we look there first (webdash sits inside the Geometry Dash folder).
     Custom (Newgrounds) songs: served/downloaded by tools/gdserver.js into songs/<id>.mp3. */
  var OFFICIAL = ['StereoMadness', 'BackOnTrack', 'Polargeist', 'DryOut', 'BaseAfterBase', 'CantLetGo', 'Jumper', 'TimeMachine', 'Cycles', 'xStep',
    'Clutterfunk', 'TheoryOfEverything', 'Electroman', 'Clubstep', 'Electrodynamix', 'HexagonForce', 'BlastProcessing', 'TheoryOfEverything2',
    'GeometricalDominator', 'Deadlocked', 'Fingerdash', 'Dash', 'Explorers', 'The7Seas', 'VikingArena', 'AirborneRobots', 'DJRubRub', 'Payload',
    'BeastMode', 'Machina', 'Years', 'ElectroFrontlines', 'SpacePirates', 'Striker', 'Embers', 'Round1', 'MonsterDanceOff', 'PressStart', 'knockemout', 'PowerTrip'];
  var SERVED = location.protocol === 'http:' || location.protocol === 'https:';
  function musicSources(info, level) {
    var out = [];
    if (info.music) out.push(info.music);
    if (info.customSong) { if (SERVED) out.push('api/song/' + info.customSong + '/file'); out.push('songs/' + info.customSong + '.mp3', 'songs/' + info.customSong + '.ogg'); }
    var track = info.officialSong;
    if (track === undefined && typeof info.id === 'number' && info.id <= 22) track = info.id - 1;
    if (track === undefined && level && level.header && level.header.audioTrack !== undefined) track = level.header.audioTrack;
    if (track !== undefined && OFFICIAL[track]) {
      var f = OFFICIAL[track] + '.mp3';
      if (SERVED) out.push('gdres/' + f);
      out.push('../Resources/' + f, A + f);
    }
    return out;
  }
  function makeMusic(srcs) {
    var a = new Audio(), i = 0;
    a.preload = 'auto';
    a.addEventListener('error', function () { if (++i < srcs.length) { a.src = srcs[i]; a.load(); if (started) a.play().catch(function () {}); } });
    if (srcs.length) a.src = srcs[0];
    return a;
  }
  function firstIndex(x) { var lo = 0, hi = lv.length; while (lo < hi) { var m = (lo + hi) >> 1; if (lv[m].o.x < x) lo = m + 1; else hi = m; } return lo; }

  /* ---------- game state ---------- */
  var S, attempt = 1, started = false, deathAt = 0, particles = [], best = 0, colorBG = [40, 125, 255], colorGround = [0, 102, 255], shake = 0;
  var baseBG = [40, 125, 255], baseGR = [0, 102, 255], trigState = [];
  var replay = null, manual = false, acc = 0, last = 0, holdInput = false, won = false;
  function resetRun() {
    S = E.newState(world); won = false; particles = []; deathAt = 0; waveTrail = [];
    simTime = performance.now(); inputQ.length = 0; tapLatch = false; holdState = holdInput;
    colorBG = baseBG.slice(); colorGround = baseGR.slice();
    trigState = trigs.map(function () { return null; });
    var fly0 = S.ceil < E.NO_CEIL;
    view.camX = S.x - view.w * PLAYER_SCREEN; view.camB = fly0 ? (S.gy + S.ceil) / 2 - VIEW_H / 2 : -90;
    view.gyDraw = S.gy; view.ceilY = fly0 ? S.ceil : S.gy + 600; view.ceil = fly0 ? 1 : 0;
    if (started) { try { music.currentTime = (LV && LV.header && LV.header.songOffset) || 0; music.play().catch(function () {}); } catch (e) {} }
  }
  function lerpCol(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function updateColors() {
    var bg = baseBG.slice(), gr = baseGR.slice();
    for (var i = 0; i < trigs.length; i++) {
      var t = trigs[i]; if (S.x < t.x) break;
      if (trigState[i] === null) trigState[i] = { f: S.frame, from: t.bg ? colorBG.slice() : colorGround.slice() };
      var k = t.d <= 0 ? 1 : Math.min(1, (S.frame - trigState[i].f) / 60 / t.d);
      var c = lerpCol(trigState[i].from, t.c, k);
      if (t.bg) bg = c; else gr = c;
    }
    colorBG = bg.map(Math.round); colorGround = gr.map(Math.round);
  }

  /* Camera, per 60 Hz frame (GJBaseGameLayer::updateCamera): cube mode uses a dead zone of
     70 units above / 40 below screen centre (swapped when upside down) and eases 1/10 of the way
     each frame; flying modes centre the corridor. The camera never drops below the default
     ground view. */
  function updateCamera() {
    var fly = S.ceilTarget < E.NO_CEIL, tgt = view.camB;
    if (fly) tgt = (S.gyTarget + S.ceilTarget) / 2 - VIEW_H / 2;
    else {
      var c = view.camB + VIEW_H / 2, up = S.flip ? 40 : 70, dn = S.flip ? 70 : 40;
      if (S.y > c + up) tgt = S.y - up - VIEW_H / 2;
      else if (S.y < c - dn) tgt = S.y + dn - VIEW_H / 2;
      if (tgt < -90) tgt = -90;
    }
    view.camB += (tgt - view.camB) / 10;
    view.gyDraw += ((fly ? S.gy : 0) - view.gyDraw) / 8;
    if (fly) view.ceilY = view.ceil < 0.02 ? S.ceil : view.ceilY + (S.ceil - view.ceilY) / 8;
    view.ceil += ((fly ? 1 : 0) - view.ceil) / 8;
  }
  function die() {
    sfx('explode_11.ogg', 0.7); music.pause(); shake = 6;
    var cx = S.x, cy = S.y;
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 220;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, t: 0, sz: 3 + Math.random() * 5, c: i % 2 ? P1 : P2 });
    }
    deathAt = performance.now();
    best = Math.max(best, Math.min(100, S.x / world.endX * 100));
  }

  /* ---------- wave trail (HardStreak) ----------
     The game draws the wave's path as quads through recorded points (HardStreak::updateStroke):
     an outer stroke in the player colour, width 6 x pulse, and an inner white stroke, width 2 x pulse at
     65% opacity, both with additive blending (blend 770,1). The pulse follows the music in the game;
     here it is a gentle beat (stand-in). Points are kept only while visible (clearBehindXPos). */
  var waveTrail = [];
  function recordTrail() {
    if (S.dead) return;
    var on = S.mode === E.WAVE, last = waveTrail[waveTrail.length - 1];
    if (!on) { if (last) waveTrail.push(null); return; }      // break the line when leaving the wave
    var p = { x: S.x, y: S.y };
    if (last && Math.abs(last.y - p.y) > 60) waveTrail.push(null);   // teleport / big jump: start a new segment
    var n = waveTrail.length, a = waveTrail[n - 2], b = waveTrail[n - 1];
    if (a && b) {                                             // merge collinear points (same direction)
      var d1 = (b.y - a.y) / Math.max(1e-6, b.x - a.x), d2 = (p.y - b.y) / Math.max(1e-6, p.x - b.x);
      if (Math.abs(d1 - d2) < 1e-3) { waveTrail[n - 1] = p; return; }
    }
    waveTrail.push(p);
    var cut = view.camX - 60, i = 0;
    while (i < waveTrail.length - 2 && (waveTrail[i] === null || (waveTrail[i + 1] && waveTrail[i + 1].x < cut))) i++;
    if (i) waveTrail.splice(0, i);
  }
  function drawTrail() {
    if (!waveTrail.length) return;
    var k = S.mini ? E.MINI_SCALE : 1, pulse = 1.35 + 0.25 * Math.sin(S.frame / 60 * Math.PI * 2 * 2);
    function pathAll() {
      ctx.beginPath();
      var pen = false;
      for (var i = 0; i < waveTrail.length; i++) {
        var p = waveTrail[i];
        if (!p) { pen = false; continue; }
        var q = toScreen(p.x, p.y);
        if (!pen) { ctx.moveTo(q[0], q[1]); pen = true; } else ctx.lineTo(q[0], q[1]);
      }
      if (S.mode === E.WAVE && !S.dead && pen) { var c = toScreen(S.x, S.y); ctx.lineTo(c[0], c[1]); }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'miter'; ctx.miterLimit = 4; ctx.lineCap = 'butt';
    pathAll(); ctx.strokeStyle = 'rgb(' + P1.join(',') + ')'; ctx.lineWidth = 6 * pulse * k * view.s; ctx.stroke();
    pathAll(); ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 2 * pulse * k * view.s; ctx.stroke();
    ctx.restore();
  }

  function tick() {   // one 60 Hz logic frame
    if (S.dead) return;
    var h = replay ? !!replay[S.frame] : holdInput;
    E.stepFrame(world, S, h);
    recordTrail();
    updateCamera();
    updateColors();
    if (S.dead) die();
    if (S.won && !won) { won = true; sfx('endStart_02.ogg', 0.9); }
  }

  /* Live play runs the physics in 1/240 s substeps against the real clock. Every press/release is
     timestamped by the browser and applied at the substep where it actually happened, instead of
     waiting for the next 60 Hz frame - so jumps land exactly when you click. */
  var SUB_MS = 1000 / 60 / E.STEPS, simTime = 0, inputQ = [], holdState = false, tapLatch = false;
  function subTick(h) {
    E.stepSub(world, S, h);
    recordTrail();
    if (S.sub % E.STEPS === 0) { updateCamera(); updateColors(); }
    if (S.dead) die();
    if (S.won && !won) { won = true; sfx('endStart_02.ogg', 0.9); }
  }
  function runLive(now) {
    if (now - simTime > 250) simTime = now - 250;          // tab was hidden / long stall: don't fast-forward forever
    while (simTime + SUB_MS <= now && !S.dead && !won) {
      simTime += SUB_MS;
      while (inputQ.length && inputQ[0].t <= simTime) { var ev = inputQ.shift(); holdState = ev.down; if (ev.down) tapLatch = true; }
      var h = holdState || tapLatch; tapLatch = false;
      subTick(h);
    }
    if (S.dead || won) { while (inputQ.length) holdState = inputQ.shift().down; simTime = now; }
  }

  /* ---------- drawing ---------- */
  // Background / ground are grayscale textures tinted by colour triggers. Tinting is done with a
  // 'multiply' fill on the main canvas each frame (cheap) instead of building a new tinted copy of the
  // texture for every intermediate colour of a fade, which stalled the game for whole frames.
  function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }
  function multiplyRect(col, x, y, w, h) {
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = rgb(col); ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  function drawBG() {
    var col = colorBG, ts = 512;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    var par = 0.1, offX = -(view.camX * par) % ts;
    var size = ts * view.s, startX = ((offX % ts) - ts) * view.s;
    var top = canvas.height - size + (view.camB + 90) * view.s * 0.2;
    for (var x = startX; x < canvas.width; x += size) ctx.drawImage(bgImg, x, top, size, size);
    multiplyRect(col, 0, 0, canvas.width, canvas.height);
  }
  function groundTiles(y0, y1, dir) {
    var ts = 128 * view.s, off = (-(view.camX * view.s) % ts + ts) % ts - ts;
    if (dir > 0) { for (var y = y0; y < y1; y += ts) for (var x = off; x < canvas.width; x += ts) ctx.drawImage(groundImg, x, y, ts + 1, ts + 1); }
    else { for (var y2 = y0 - ts; y2 > -ts; y2 -= ts) for (var x2 = off; x2 < canvas.width; x2 += ts) ctx.drawImage(groundImg, x2, y2, ts + 1, ts + 1); }
  }
  function drawGround(gy) {
    var p = toScreen(0, gy)[1]; if (p >= canvas.height) return;
    groundTiles(p, canvas.height, 1);
    multiplyRect(colorGround, 0, p, canvas.width, canvas.height - p);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, p, canvas.width, canvas.height - p);
    var g = ctx.createLinearGradient(0, p, 0, p + 40 * view.s); g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, p, canvas.width, 40 * view.s);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, p - 1.5 * view.s, canvas.width, 3 * view.s);
  }
  function drawCeiling(cy) {
    var p = toScreen(0, cy)[1]; if (p <= 0) return;
    groundTiles(p, 0, -1);
    multiplyRect(colorGround, 0, 0, canvas.width, p);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, canvas.width, p);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, p - 1.5 * view.s, canvas.width, 3 * view.s);
  }
  function drawObjects(z) {
    var i0 = firstIndex(view.camX - 120), i1 = firstIndex(view.camX + view.w + 120);
    for (var i = Math.max(0, i0 - 40); i < i1; i++) {
      var e = lv[i], o = e.o, art = e.art;
      for (var j = 0; j < art.length; j++) {
        var a = art[j]; if (a.z !== z) continue;
        sprite(a.f, o.x, o.y, { rot: o.rotation, fx: o.flipX, fy: o.flipY, tint: a.tint, alpha: a.alpha });
      }
      if (DEBUG && z === 1) { var p = toScreen(o.x, o.y); ctx.fillStyle = '#ff0'; ctx.font = (8 * view.s) + 'px monospace'; ctx.fillText(o.id, p[0] - 8, p[1]); }
    }
  }
  function drawPlayer() {
    if (S.dead) return;
    var x = S.x, y = S.y;
    var k = S.mini ? E.MINI_SCALE : 1;
    // icon helper: draws main (P1) + secondary (P2) layers of an icon frame, scaled for mini
    function icon(base, px, py, o) {
      o = o || {}; var sc = (o.scale || 1) * k;
      sprite(base + '_2_001.png', px, py, { rot: o.rot, tint: P2, scale: sc, fx: o.fx, fy: o.fy });
      sprite(base + '_001.png', px, py, { rot: o.rot, tint: P1, scale: sc, fx: o.fx, fy: o.fy });
      if (o.extra) sprite(base + '_extra_001.png', px, py, { rot: o.rot, scale: sc, fx: o.fx, fy: o.fy });
    }
    var plug = window.GDRender && window.GDRender.draw[S.mode];
    if (plug) { plug({ sprite: sprite, icon: icon, P1: P1, P2: P2, scale: k, E: E }, S); return; }
    if (S.mode === E.SHIP) {
      var r = S.rot, fy = S.flip;
      var cr = r * Math.PI / 180, cxo = -Math.sin(cr) * 7 * k * (fy ? -1 : 1), cyo = Math.cos(cr) * 7 * k * (fy ? -1 : 1);
      icon('player_01', x + cxo, y + cyo, { rot: r, scale: 0.62, fy: fy });
      icon('ship_01', x, y, { rot: r, fy: fy });
    } else {
      icon('player_01', x, y, { rot: S.rot });
    }
  }
  function drawDebugBoxes() {
    ctx.lineWidth = 1;
    function box(b, c) { var p = toScreen(b.x0, b.y1); ctx.strokeStyle = c; ctx.strokeRect(p[0], p[1], (b.x1 - b.x0) * view.s, (b.y1 - b.y0) * view.s); }
    var c0 = Math.floor(view.camX / 30), c1 = Math.floor((view.camX + view.w) / 30), seen = [];
    for (var c = c0; c <= c1; c++) { var cell = world.cols[c]; if (!cell) continue;
      cell.s.forEach(function (b) { if (seen.indexOf(b) < 0) { seen.push(b); box(b, '#0f0'); } });
      cell.h.forEach(function (b) { if (seen.indexOf(b) < 0) { seen.push(b); box(b, '#f00'); } });
      cell.t.forEach(function (b) { if (seen.indexOf(b) < 0) { seen.push(b); box(b, '#ff0'); } }); }
    var hh = S.mini ? 15 * E.MINI_SCALE : 15; box({ x0: S.x - hh, x1: S.x + hh, y0: S.y - hh, y1: S.y + hh }, '#0ff');
  }

  function render(dt) {
    // camera
    view.camX = S.x - view.w * PLAYER_SCREEN;
    if (shake > 0) { shake *= 0.9; if (shake < 0.2) shake = 0; }
    ctx.save();
    if (shake) ctx.translate((Math.random() - .5) * shake * view.s, (Math.random() - .5) * shake * view.s);
    if (S.mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }   // mirror portal (45): whole world flipped left-right
    drawBG();
    drawObjects(0);
    drawGround(view.gyDraw);
    if (view.ceil > 0.01) drawCeiling(view.ceilY + (1 - view.ceil) * 260);
    drawObjects(1);
    drawTrail();
    drawPlayer();
    drawObjects(2);
    // death particles
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i]; p.t += dt; if (p.t > p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 500 * dt;
      var sp = toScreen(p.x, p.y); ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = 'rgb(' + p.c.join(',') + ')';
      ctx.fillRect(sp[0], sp[1], p.sz * view.s, p.sz * view.s); ctx.globalAlpha = 1;
    }
    if (DEBUG) drawDebugBoxes();
    ctx.restore();
    drawHUD();
  }
  function drawHUD() {
    var pct = Math.min(100, Math.max(0, S.x / world.endX * 100));
    var bw = Math.min(canvas.width * 0.5, 360 * view.s / 1), bx = (canvas.width - bw) / 2, by = 12 * view.s / 1;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, 8 * view.s);
    ctx.fillStyle = '#7dff00'; ctx.fillRect(bx, by, bw * pct / 100, 8 * view.s);
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (13 * view.s) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.floor(pct) + '%', bx + bw + 8 * view.s, by + 4 * view.s);
    ctx.textAlign = 'left'; ctx.fillText('Attempt ' + attempt, 14 * view.s, by + 4 * view.s);
    ctx.textBaseline = 'alphabetic';
  }

  /* ---------- UI overlays ---------- */
  var overlay = document.getElementById('overlay'), title = document.getElementById('otitle'), sub = document.getElementById('osub');
  function showOverlay(t, s) { title.textContent = t; sub.textContent = s; overlay.style.display = 'flex'; }
  function hideOverlay() { overlay.style.display = 'none'; }

  var menu = document.getElementById('menu');
  function levelFromString(str, info) {
    return GL.loadLevelString(str.trim()).then(function (lvl) { loadLevel(lvl, info); }).catch(function (e) { showOverlay('Could not read level', String(e && e.message || e)); overlay.style.display = 'flex'; });
  }
  function buildMenu() {
    var h = '<h1>WebDash</h1><div class="grid">';
    (window.GD_LEVELS || []).forEach(function (l) { h += '<button data-id="' + l.id + '">' + l.id + '. ' + l.name + '</button>'; });
    h += '</div><div id="online"></div><p>Drop a level file (.txt level string or CCLocalLevels.dat) onto the page to play your own levels.</p>';
    menu.innerHTML = h; menu.style.display = 'flex'; overlay.style.display = 'none';
    if (SERVED) setupOnline();
    menu.querySelectorAll('.grid button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var l = window.GD_LEVELS.filter(function (x) { return x.id == btn.dataset.id; })[0];
        levelFromString(l.str, { id: l.id, name: l.name });
      });
    });
  }
  /* Online levels - only when the page is served by tools/gdserver.js (it proxies the GD servers). */
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function setupOnline() {
    var box = document.getElementById('online');
    fetch('api/ping').then(function (r) { if (!r.ok) throw 0;
      box.innerHTML = '<h2>Online levels</h2><div class="row"><input id="q" placeholder="Search name or level ID"><select id="qt">' +
        '<option value="0">Search</option><option value="2">Most liked</option><option value="1">Most downloaded</option><option value="6">Featured</option>' +
        '<option value="3">Trending</option><option value="4">Recent</option><option value="11">Awarded</option><option value="16">Hall of Fame</option></select>' +
        '<button id="qgo">Go</button><button id="qdaily">Daily</button><button id="qweekly">Weekly</button></div><div id="qres" class="grid"></div><div class="row"><button id="qprev">&lt;</button><span id="qpage"></span><button id="qnext">&gt;</button></div>';
      var page = 0;
      function run() {
        var res = document.getElementById('qres'); res.innerHTML = '<p>Searching…</p>';
        var q = document.getElementById('q').value.trim(), t = document.getElementById('qt').value;
        fetch('api/search?type=' + (q && t === '0' ? 0 : t) + '&str=' + encodeURIComponent(q) + '&page=' + page).then(function (r) { return r.json(); }).then(function (d) {
          if (d.error) throw new Error(d.error);
          document.getElementById('qpage').textContent = ' page ' + (page + 1) + ' of ' + Math.max(1, Math.ceil(d.total / 10)) + ' ';
          res.innerHTML = d.levels.map(function (l, i) { return '<button data-lid="' + l.id + '" data-author="' + esc(l.author) + '">' + esc(l.name) + '<br><small>' + esc(l.author) + ' · ' + esc(l.difficulty) + (l.stars ? ' ' + l.stars + '★' : '') + ' · ' + esc(l.length) + '</small></button>'; }).join('') || '<p>No results.</p>';
          res.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { playOnline(+b.dataset.lid, b.dataset.author); }); });
        }).catch(function (e) { res.innerHTML = '<p>Search failed: ' + esc(e.message || e) + '</p>'; });
      }
      document.getElementById('qgo').onclick = function () { page = 0; run(); };
      document.getElementById('q').onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') { page = 0; run(); } };
      document.getElementById('qprev').onclick = function () { if (page > 0) { page--; run(); } };
      document.getElementById('qnext').onclick = function () { page++; run(); };
      document.getElementById('qdaily').onclick = function () { playOnline(-1); };
      document.getElementById('qweekly').onclick = function () { playOnline(-2); };
    }).catch(function () {});
  }
  function playOnline(id, author) {
    showOverlay('Downloading…', 'level ' + (id === -1 ? '(daily)' : id === -2 ? '(weekly)' : id)); menu.style.display = 'none';
    fetch('api/level/' + id).then(function (r) { return r.json(); }).then(function (l) {
      if (l.error) throw new Error(l.error);
      return levelFromString(l.levelString, { id: l.id, name: l.name + ' by ' + (author || l.author || '?'), customSong: l.customSongID || 0, officialSong: l.customSongID ? undefined : l.officialSong });
    }).catch(function (e) { showOverlay('Download failed', String(e.message || e) + '  •  Esc = menu'); });
  }
  function showCustomPicker(levels, fname) {
    var h = '<h1>' + fname + '</h1><div class="grid">';
    levels.forEach(function (l, i) { h += '<button data-i="' + i + '">' + l.name + '</button>'; });
    h += '</div><p><button id="back">Back</button></p>';
    menu.innerHTML = h; menu.style.display = 'flex';
    menu.querySelectorAll('button[data-i]').forEach(function (btn) { btn.addEventListener('click', function () { var l = levels[+btn.dataset.i]; levelFromString(l.levelString, { id: 'custom', name: l.name, customSong: l.songId || 0, officialSong: l.songId ? undefined : l.audioTrack }); }); });
    document.getElementById('back').addEventListener('click', buildMenu);
  }
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); var f = e.dataTransfer.files[0]; if (!f) return;
    f.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), head = new TextDecoder().decode(u8.subarray(0, 8));
      if (/^H4sI|^eJ/.test(head)) return levelFromString(new TextDecoder().decode(u8), { id: 'custom', name: f.name.replace(/\.\w+$/, '') });
      return GL.decodeSaveFileBytes(u8).then(function (xml) {
        var list = GL.levelsFromSaveXml(xml);
        if (!list.length) throw new Error('No levels found in that file');
        showCustomPicker(list, f.name);
      });
    }).catch(function (err) { showOverlay('Could not read file', String(err && err.message || err)); });
  });

  function ready() { buildMenu(); requestAnimationFrame(frame); }
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    if (!world) { requestAnimationFrame(frame); return; }
    if (!manual && started) {
      runLive(performance.now());
      if (S.dead && deathAt && performance.now() - deathAt > 900) { attempt++; resetRun(); }
      if (won) { if (!overlay.style.display || overlay.style.display === 'none') { music.pause(); showOverlay('Level Complete!', 'Attempts: ' + attempt + '  •  click or press Space to play again'); } }
    }
    render(dt);
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function evTime(e) { var t = e && e.timeStamp; return t && t > 0 && t <= performance.now() + 1 ? t : performance.now(); }
  function press(e) {
    if (menu.style.display === 'flex' || !world) return;
    if (!started) { started = true; hideOverlay(); resetRun(); }
    else if (won) { won = false; attempt = 1; hideOverlay(); resetRun(); }
    if (!holdInput) inputQ.push({ t: evTime(e), down: true });
    holdInput = true;
  }
  function release(e) { if (holdInput) inputQ.push({ t: evTime(e), down: false }); holdInput = false; }
  window.addEventListener('keydown', function (e) { if (e.code === 'Escape') { started = false; try { music.pause(); } catch (x) {} buildMenu(); return; }
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) press(e); } });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') release(e); });
  canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); press(e); });
  overlay.addEventListener('pointerdown', function (e) { e.preventDefault(); press(e); });
  window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
  window.addEventListener('blur', function () { release(); });

  /* test hooks (used by the automated screenshot checks) */
  window.GD = {
    get S() { return S; }, get world() { return world; }, loadLevel: loadLevel, loadString: levelFromString,
    start: function () { started = true; manual = true; hideOverlay(); resetRun(); },
    advance: function (n, replayArr) { replay = replayArr || null; for (var i = 0; i < n && !S.dead; i++) tick(); replay = null; },
    seek: function (frames, acts) { replay = acts; while (S.frame < frames && !S.dead) tick(); replay = null; },
    draw: function () { render(0.016); },
    view: view, setManual: function (b) { manual = b; }, setReplay: function (a) { replay = a; }
  };
})();
