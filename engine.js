/* WebDash engine v3 - gameplay rules ported from Geometry Dash (2.2xx).
 *
 * Constants and update order come from the game's own code (PlayerObject::updateJump / updateTimeMod /
 * flipGravity / bumpPlayer and the speed table in the Windows build). Pure logic, no DOM, so it runs in
 * the browser and in Node (used by the automated level-clearing bot in tools/).
 *
 * v3: game modes and orbs are plug-ins. The core (this file) does movement, collision, portals, pads,
 * speed, mini; each mode registers its own velocity rules with GDEngine.registerMode (see modes/*.js and
 * AGENT_BRIEF.md). Cube and ship are registered at the bottom of this file.
 *
 * Units: GD units (1 block = 30), y up, ground top at y = 0.
 * Time: one 60 Hz "frame" is split into STEPS substeps (240 Hz).
 */
(function (root) {
  'use strict';
  var U = 30, STEPS = 4, A = 1 / STEPS;           // A = frame fraction per substep
  var V_DT = 0.9;                                  // vertical integration factor used by the game
  var CUBE = 0, SHIP = 1, BALL = 2, UFO = 3, WAVE = 4, ROBOT = 5, SPIDER = 6, SWING = 7;
  var HALF = 15, MINI_SCALE = 0.6;
  var SHIP_G = 0.9582;                             // gravity constant used by flying modes
  var CUBE_FALL_MAX = 15;                          // terminal velocity (cube)
  var SHIP_UP = 8, SHIP_DOWN = 6.4;                // ship velocity clamps (normal gravity)
  var SHIP_H = 300;                                // ship corridor height
  var NO_CEIL = 1e9;

  // per-speed physics (timeMod, jump velocity, gravity, player speed) - decoded from the game
  var SPEEDS = {
    slow:    { tm: 0.7, jump: 10.620032, grav: 0.940199, ps: 5.980002 },
    normal:  { tm: 0.9, jump: 11.180032, grav: 0.958199, ps: 5.770002 },
    fast:    { tm: 1.1, jump: 11.420032, grav: 0.957199, ps: 5.870002 },
    faster:  { tm: 1.3, jump: 11.230032, grav: 0.961199, ps: 6.000002 },
    fastest: { tm: 1.6, jump: 11.230032, grav: 0.961199, ps: 6.000002 }
  };
  var SPEED_NAMES = ['normal', 'slow', 'fast', 'faster', 'fastest'];

  /* ------------------------------------------------------------------ plug-in registries ------ */
  var MODES = {};          // id -> mode definition (see registerMode)
  var ORB = null;          // orb handler: function (s, ctx, orb) -> true if it fired
  // pad velocity = bumpMod * 16 ; bumpMod depends on pad colour and mode (PlayerObject::getBumpMod)
  var padModFn = function (kind, mode, mini) {
    if (kind === 'pink') return mode === SHIP ? 0.35 : 0.65;
    if (kind === 'red') return mode === SHIP ? 0.95 : 1.25;
    return 1.0;                                    // yellow
  };
  /**
   * registerMode(id, def) - def fields (all optional except update):
   *   name        string
   *   corridor    0 = no corridor (free height, ground at the level floor);
   *               N > 0 = portal creates a floor/ceiling pair N units apart, centred on the portal (ship 300)
   *   grounded    true if the mode can stand on surfaces (s.ground is maintained)
   *   hazardHalf  half-size of the player box used against hazards (default 13.5, scaled for mini)
   *   update(s, ctx)        set s.vy for this substep (called before the vertical move)
   *   afterMove(s, ctx)     called after collisions are resolved (e.g. spider teleport, wave sliding)
   *   onEnter(s, ctx, prev) called when a portal switches into this mode
   *   wall(s, ctx, b, info) optional override for a horizontal block hit: return 'die', 'snap' or 'ignore'
   *   rotation(s, ctx)      cosmetic: set s.rot (degrees)
   */
  function registerMode(id, def) { MODES[id] = def; }
  function registerOrbHandler(fn) { ORB = fn; }
  function setPadMod(fn) { padModFn = fn; }

  /** GameObject::determineSlopeDirection (line 168708): direction 0-7, m_upSlope (936), slopeFloorTop.
   *  up  = surface rises to the right (slopeYPos: y = maxY + (x - maxX)·h/w), else falls to the right.
   *  top = solid is ABOVE the surface (a ceiling slope); otherwise solid is below it (a floor slope). */
  function slopeDir(fx, fy, rot) {
    var r = Math.round(rot) % 360, a180 = Math.abs(r) === 180, a90 = r === 90 || r === -270, a270 = r === 270 || r === -90, a0 = r === 0;
    var dir = -1, up = false;
    if (fx) {
      if (fy) { if (a180) { up = true; dir = 0; } else if (a0) { up = true; dir = 3; } else if (a270) dir = 4; else if (a90) dir = 5; }
      else { if (a180) dir = 1; else if (a0) dir = 2; else if (a90) { up = true; dir = 6; } else if (a270) { up = true; dir = 7; } }
    } else {
      if (!fy) { if (a0) { up = true; dir = 0; } else if (a180) { up = true; dir = 3; } else if (a90) dir = 4; else if (a270) dir = 5; }
      else { if (a0) dir = 1; else if (a180) dir = 2; else if (a270) { up = true; dir = 6; } else if (a90) { up = true; dir = 7; } }
    }
    if (dir < 0) return null;                                   // non-90-degree rotations are ignored by the game too
    return { dir: dir, up: up, top: dir === 1 || dir === 3 || dir === 5 || dir === 6 };
  }
  function slopeY(p, x) {                                       // GameObject::slopeYPos(float), clamped to the rect
    if (x < p.x0) x = p.x0; if (x > p.x1) x = p.x1;
    return p.up ? p.y1 + (x - p.x1) * p.k2 : p.y0 + (p.x1 - x) * p.k2;
  }
  function lineY(p, x) { return p.up ? p.y1 + (x - p.x1) * p.k2 : p.y0 + (p.x1 - x) * p.k2; }   // unclamped surface line
  /* Where the player's centre must be to rest on slope p (n = +1 floor slope, -1 ceiling slope):
     the rotated-cube rule (centre (h/2)/cos(angle) from the surface line at the centre x), limited by
     the box resting on the highest/lowest surface point under it, so entering and leaving a slope is smooth. */
  function slopeTarget(p, x, h, n) {
    var line = lineY(p, x) + n * h / p.cos, edge;
    if (n > 0) { edge = slopeY(p, p.up ? x + h : x - h) + h; return Math.min(line, edge); }
    edge = slopeY(p, p.up ? x - h : x + h) - h; return Math.max(line, edge);
  }
  /* Player vs slopes, after the horizontal move. Placement follows RobTop's collidedWithSlope snippet
     (rt-freebies/PlayerObject.cpp): the player's CENTRE sits (h/2)/cos(angle) from the surface, measured at
     the centre x. Walking into the tall side of a slope is a wall hit; the flat side is like a block face. */
  function resolveSlopes(world, s, def, H, hb) {
    s.wasOnSurface = s.prevSurf; 
    var col = Math.floor(s.x / U), fm = s.flip ? -1 : 1, P = SPEEDS[s.speed], best = null;
    for (var c = col - 1; c <= col + 1; c++) {
      var cell = world.cols[c]; if (!cell) continue;
      for (var j = 0; j < cell.p.length; j++) {
        var p = cell.p[j];
        if (!ov(s.x - H, s.x + H, p.x0, p.x1) || !ov(s.y - H, s.y + H, p.y0, p.y1)) continue;
        var n = p.top ? -1 : 1;                                 // surface normal: +1 faces up (floor slope)
        var target = slopeTarget(p, s.x, H, n);
        var pen = n * (target - s.y);                           // > 0: player is inside the slope
        if (p.hazard) {                                         // spike slopes (byte 944): surface offset 4 (slopeYPos)
          var ht = slopeTarget(p, s.x, hb, n) + n * 4;
          if (n * (ht - s.y) > 0) { s.dead = true; s.why = { k: 'hazard slope', b: [p.x0, p.y0, p.x1, p.y1] }; return; }
          continue;
        }
        var climb0 = Math.abs(SPEEDS[s.speed].ps * SPEEDS[s.speed].tm * A * p.k2);
        // stick to the surface (kStickDistance in collidedWithSlope): a player who was standing last substep
        // follows the slope down / keeps contact instead of flickering into the air
        var sticky = s.wasOnSurface && n === (s.flip ? -1 : 1) && (s.flip ? -1 : 1) * s.vy <= climb0 / (A * V_DT) + 1e-6;
        if (pen <= 0 && !(sticky && pen > -(2 * climb0 + 1))) continue;
        // flat face of the slope (the side opposite the surface) works like a block face
        var flat = n > 0 ? (s.y + H) - p.y0 : p.y1 - (s.y - H);
        if (flat <= 6 && flat < pen) { s.y = n > 0 ? p.y0 - H : p.y1 + H; if ((n > 0 && s.vy > 0) || (n < 0 && s.vy < 0)) s.vy = 0; continue; }
        var climb = Math.abs(P.ps * P.tm * A * p.k2);           // how far the surface moves per substep
        if (pen > 6 + 2 * climb + Math.abs(s.vy * A * V_DT) && s.slopeUid !== p.uid) {
          s.dead = true; s.why = { k: 'slope wall', b: [p.x0, p.y0, p.x1, p.y1] }; return;
        }
        if (!best || pen > best.pen) best = { p: p, n: n, target: target, pen: pen };
      }
    }
    s.slopeUid = 0; s.slopeAngle = 0;
    if (!best) return;
    var p2 = best.p, n2 = best.n;
    var rising = (p2.up ? 1 : -1);                              // surface y change per unit x
    var slopeVy = rising * P.ps * P.tm * p2.k2 / V_DT;          // velocity that follows the surface
    s.y = best.target;
    if (n2 === fm) {                                            // standing side for the current gravity
      if (fm * s.vy <= fm * slopeVy) s.vy = slopeVy;            // follow the surface unless already moving away (jump, pad)
      if (def.grounded) s.ground = true;
      s.onSurface = true;
      s.slopeUid = p2.uid; s.slopeAngle = Math.atan(p2.k2) * 180 / Math.PI * rising;
    } else {                                                    // head side: push away like a ceiling
      if (fm * s.vy > 0) s.vy = 0;
      s.hitCeiling = true;
    }
  }

  function rotPoint(lx, ly, fx, fy, rotDeg) {
    if (fx) lx = -lx;
    if (fy) ly = -ly;
    var a = rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [lx * c + ly * s, -lx * s + ly * c];
  }
  function quarter(rotDeg) { return Math.abs(Math.round(rotDeg / 90)) % 2 === 1; }

  /** parsed level + classify(id) -> world */
  function buildWorld(level, classify) {
    var cols = {}, counts = { solid: 0, slope: 0, hazard: 0, portal: 0, speed: 0, pad: 0, orb: 0 }, unsupported = {};
    var maxX = 0;
    function put(r) {
      var c0 = Math.floor((r.x0 - 1) / U), c1 = Math.floor((r.x1 + 1) / U);
      for (var c = c0; c <= c1; c++) (cols[c] || (cols[c] = { s: [], h: [], t: [], p: [] }))[r.k].push(r);
    }
    var cache = {}, uid = 0;
    level.objects.forEach(function (o) {
      if (o.x > maxX) maxX = o.x;
      var cl = cache[o.id] || (cache[o.id] = classify(o.id));
      var cat = cl.cat; if (!counts.hasOwnProperty(cat)) return;
      counts[cat]++;
      var q = quarter(o.rotation || 0);
      if (cat === 'slope') {
        // GameObject::determineSlopeDirection -> rect, rising/falling surface, solid below or above it
        var sb = cl.box, sw = sb[2] * (o.scale || 1), sh = sb[3] * (o.scale || 1);
        if (q) { var t3 = sw; sw = sh; sh = t3; }
        var sd = slopeDir(!!o.flipX, !!o.flipY, o.rotation || 0);
        if (sd) put({ k: 'p', cat: 'slope', x0: o.x - sw / 2, x1: o.x + sw / 2, y0: o.y - sh / 2, y1: o.y + sh / 2, up: sd.up, top: sd.top,
                      k2: sh / sw, cos: Math.cos(Math.atan(sh / sw)), hazard: !!cl.hazard, cl: cl, uid: ++uid, obj: o });
        return;
      }
      if (cat === 'solid' || cat === 'hazard' || cat === 'pad' || cat === 'orb') {
        var b = cl.box, p = rotPoint(b[0], b[1], o.flipX, o.flipY, o.rotation || 0), w = b[2], h = b[3];
        if (q) { var t = w; w = h; h = t; }
        var sc = o.scale || 1;
        if (cl.radius) { w = h = cl.radius * 2; }                    // round hazard: bucket by its circle
        w *= sc; h *= sc;
        var r = { k: cat === 'solid' ? 's' : cat === 'hazard' ? 'h' : 't', cat: cat, x0: o.x + p[0] - w / 2, x1: o.x + p[0] + w / 2, y0: o.y + p[1] - h / 2, y1: o.y + p[1] + h / 2,
                  cl: cl, x: o.x, y: o.y, flipY: o.flipY, rot: o.rotation || 0, uid: ++uid, obj: o, r: cl.radius ? cl.radius * sc : 0 };
        put(r);
        if (cat === 'orb' && !ORB) unsupported.orb = (unsupported.orb || 0) + 1;
      } else {                                      // portal / speed: tall trigger
        var w2 = 34, h2 = 86; if (q) { var t2 = w2; w2 = h2; h2 = t2; }
        var rr = { k: 't', cat: cat, x0: o.x - w2 / 2, x1: o.x + w2 / 2, y0: o.y - h2 / 2, y1: o.y + h2 / 2, cl: cl, x: o.x, y: o.y, rot: o.rotation || 0, uid: ++uid, obj: o };
        put(rr);
        if (cat === 'portal') {
          var pp = cl.p;
          if (pp.mode !== undefined && !MODES[pp.mode]) unsupported['mode:' + pp.mode] = (unsupported['mode:' + pp.mode] || 0) + 1;
          if (pp.dual !== undefined) unsupported.dual = (unsupported.dual || 0) + 1;
        }
      }
    });
    var sm = level.header.startMode | 0;
    if (!MODES[sm]) { unsupported['start mode:' + sm] = 1; sm = CUBE; }
    return { cols: cols, counts: counts, unsupported: unsupported, endX: maxX + 300,
             startMode: sm, startSpeed: SPEED_NAMES[level.header.startSpeed] || 'normal', startFlip: !!level.header.startFlipped,
             startMini: !!level.header.startMini };
  }

  function newState(world) {
    var s = { x: 15, y: HALF, vy: 0, mode: world.startMode, flip: world.startFlip, speed: world.startSpeed, ground: true,
              mini: !!world.startMini, rot: 0, dead: false, won: false, gyTarget: 0, gy: 0, ceil: NO_CEIL, ceilTarget: NO_CEIL,
              hold: false, prevHold: false, prevHoldSub: false, buffer: false, frame: 0, sub: 0, lastTrig: -1, usedOrbs: '', slopeUid: 0, slopeAngle: 0 };
    var def = MODES[s.mode];
    if (s.mini) s.y = HALF * MINI_SCALE;
    if (def && def.corridor) { s.ceil = s.ceilTarget = def.corridor; s.y = def.corridor / 2; s.ground = false; }
    if (def && def.onEnter) def.onEnter(s, makeCtx(world, s), -1);
    return s;
  }
  function cloneState(s) { var n = {}; for (var k in s) n[k] = s[k]; return n; }
  function ov(a0, a1, b0, b1) { return a0 < b1 - 1e-6 && b0 < a1 - 1e-6; }
  function half(s) { return s.mini ? HALF * MINI_SCALE : HALF; }
  function solidHalf(s, def) { return def && def.solidHalf ? def.solidHalf * (s.mini ? MINI_SCALE : 1) : half(s); }
  var Y_LIMIT = 3000;                              // flipped cube/ball/spider in open air: die far above the level (GUESS)

  /** nearest surface strictly above (dir = +1) or below (dir = -1) the player, used by spider-like modes.
   *  returns the y the player CENTRE should be placed at to stand on it, or null */
  function findSurface(world, s, dir) {
    var h = half(s), best = dir > 0 ? s.ceil : s.gy, col = Math.floor(s.x / U);
    if (dir > 0 && best >= NO_CEIL) best = null;
    for (var c = col - 1; c <= col + 1; c++) {
      var cell = world.cols[c]; if (!cell) continue;
      for (var j = 0; j < cell.s.length; j++) {
        var b = cell.s[j];
        if (!ov(s.x - h, s.x + h, b.x0, b.x1)) continue;
        if (dir > 0 && b.y0 >= s.y + h - 0.5 && (best === null || b.y0 < best)) best = b.y0;
        if (dir < 0 && b.y1 <= s.y - h + 0.5 && b.y1 > best) best = b.y1;
      }
    }
    if (best === null) return null;
    return dir > 0 ? best - h : best + h;
  }

  function makeCtx(world, s) {
    var P = SPEEDS[s.speed];
    return { P: P, fm: s.flip ? -1 : 1, dtv: A * V_DT, A: A, V_DT: V_DT, STEPS: STEPS, U: U,
             hold: s.hold, pressed: s.hold && !s.prevHoldSub, released: !s.hold && s.prevHoldSub,
             world: world, half: half(s), mini: s.mini,
             C: { SHIP_G: SHIP_G, CUBE_FALL_MAX: CUBE_FALL_MAX, SHIP_UP: SHIP_UP, SHIP_DOWN: SHIP_DOWN, MINI_SCALE: MINI_SCALE },
             findSurface: function (dir) { return findSurface(world, s, dir); },
             padMod: function (kind) { return padModFn(kind, s.mode, s.mini); } };
  }

  /* one physics substep (1/240 s) - lets the browser apply input at the exact substep it happened */
  function stepSub(world, s, hold) {
    if (s.dead || s.won) return s;
    s.hold = hold;
    substep(world, s);
    s.prevHoldSub = hold;
    s.sub = (s.sub || 0) + 1;
    if (s.sub % STEPS === 0) { s.prevHold = hold; s.frame++; }
    if (s.x >= world.endX) s.won = true;
    return s;
  }

  function stepFrame(world, s, hold) {
    if (s.dead || s.won) return s;
    s.hold = hold;
    for (var i = 0; i < STEPS; i++) { substep(world, s); s.prevHoldSub = hold; s.sub = (s.sub || 0) + 1; if (s.dead) break; }
    s.prevHold = hold;
    s.frame++;
    if (s.x >= world.endX) s.won = true;
    return s;
  }

  function fireOrb(world, s, b) {
    if (s.usedOrbs.indexOf('|' + b.uid + '|') >= 0) return false;
    if (ORB(s, makeCtx(world, s), { kind: b.cl.orb, b: b, id: b.obj.id })) { s.usedOrbs += '|' + b.uid + '|'; s.buffer = false; s.ground = false; return true; }
    return false;
  }
  function checkOrbs(world, s, ctx) {
    var H = ctx.half, col = Math.floor(s.x / U);
    for (var c = col - 1; c <= col + 1; c++) {
      var cell = world.cols[c]; if (!cell) continue;
      for (var j = 0; j < cell.t.length; j++) {
        var b = cell.t[j];
        if (b.cat !== 'orb' || !ov(s.x - H, s.x + H, b.x0, b.x1) || !ov(s.y - H, s.y + H, b.y0, b.y1)) continue;
        if (fireOrb(world, s, b)) return true;
      }
    }
    return false;
  }

  function enterMode(world, s, mode, portal) {
    var prev = s.mode, def = MODES[mode];
    if (!def) return;                                         // unsupported mode: keep playing the current one
    s.mode = mode;
    if (def.corridor) {
      var hc = def.corridor / 2;
      s.gyTarget = Math.max(0, Math.floor((portal.y - hc) / U) * U);
      s.ceilTarget = s.gyTarget + def.corridor;
      if (prev === mode) return;
    } else { s.gyTarget = 0; s.ceilTarget = NO_CEIL; s.ceil = NO_CEIL; }
    s.ground = false;
    if (def.onEnter) def.onEnter(s, makeCtx(world, s), prev);
  }

  function substep(world, s) {
    var def = MODES[s.mode] || MODES[CUBE];
    // a fresh press is remembered ("buffered") until something consumes it or the button is released
    if (s.hold && !s.prevHoldSub) s.buffer = true;
    if (!s.hold) s.buffer = false;
    var ctx = makeCtx(world, s), P = ctx.P, fm = ctx.fm, dtv = ctx.dtv, H = solidHalf(s, def);
    // corridor: floor/ceiling ease to the target set by the last portal
    if (s.gy !== s.gyTarget) { var d = s.gyTarget - s.gy, m = 4 * A; s.gy += Math.abs(d) <= m ? d : (d > 0 ? m : -m); }
    if (s.ceilTarget >= NO_CEIL) s.ceil = NO_CEIL;
    else if (s.ceil !== s.ceilTarget) { if (s.ceil >= NO_CEIL) s.ceil = s.ceilTarget; var d2 = s.ceilTarget - s.ceil, m2 = 4 * A; s.ceil += Math.abs(d2) <= m2 ? d2 : (d2 > 0 ? m2 : -m2); }
    var gy = s.gy, top = s.ceil;

    /* ---- orbs first: pushButton fires overlapping rings before updateJump (orb beats a ground jump) ---- */
    if (ORB && s.buffer) checkOrbs(world, s, ctx);

    /* ---- velocity (mode plug-in: PlayerObject::updateJump) ---- */
    def.update(s, ctx);
    fm = s.flip ? -1 : 1; ctx.fm = fm;               // a mode may flip gravity inside update (ball, swing, spider)

    /* ---- vertical move & resolution ---- */
    var prevBottom = s.y - H, prevTop = s.y + H;
    s.y += s.vy * dtv;
    var groundHit = false, col = Math.floor(s.x / U), c, j, cell, b;
    s.hitCeiling = false;
    for (c = col - 1; c <= col + 1; c++) {
      cell = world.cols[c]; if (!cell) continue;
      for (j = 0; j < cell.s.length; j++) {
        b = cell.s[j];
        if (!ov(s.x - H, s.x + H, b.x0, b.x1) || !ov(s.y - H, s.y + H, b.y0, b.y1)) continue;
        if (s.vy <= 0 && prevBottom >= b.y1 - 0.5) { s.y = b.y1 + H; s.vy = 0; if (fm === 1) groundHit = true; else s.hitCeiling = true; }
        else if (s.vy > 0 && prevTop <= b.y0 + 0.5) { s.y = b.y0 - H; s.vy = 0; if (fm === -1) groundHit = true; else s.hitCeiling = true; }
      }
    }
    // floor and ceiling
    if (s.y - H <= gy) { s.y = gy + H; if (s.vy < 0) s.vy = 0; if (fm === 1) groundHit = true; else s.hitCeiling = true; }
    if (s.y + H >= top) { s.y = top - H; if (s.vy > 0) s.vy = 0; if (fm === -1) groundHit = true; else s.hitCeiling = true; }
    s.ground = def.grounded ? groundHit : false;
    s.onSurface = groundHit;

    /* ---- horizontal move: overlap now = wall hit ---- */
    s.x += P.ps * P.tm * A;
    col = Math.floor(s.x / U);
    for (c = col - 1; c <= col + 1; c++) {
      cell = world.cols[c]; if (!cell) continue;
      for (j = 0; j < cell.s.length; j++) {
        b = cell.s[j];
        if (!ov(s.x - H, s.x + H, b.x0, b.x1) || !ov(s.y - H, s.y + H, b.y0, b.y1)) continue;
        var lift = s.flip ? (s.y + H) - b.y0 : b.y1 - (s.y - H);
        var under = s.flip ? b.y1 - (s.y - H) : (s.y + H) - b.y0;
        var verdict = def.wall ? def.wall(s, ctx, b, { lift: lift, under: under }) : undefined;
        if (verdict === 'ignore') continue;
        if (verdict === 'die') { s.dead = true; s.why = { k: 'wall', b: [b.x0, b.y0, b.x1, b.y1] }; return; }
        if (under <= 6 && under < lift && (s.flip ? s.vy <= 0 : s.vy >= 0)) { s.y = s.flip ? b.y1 + H : b.y0 - H; s.vy = 0; continue; }
        // ledge: snap onto the block. Coming off a slope the (unrotated) box corner dips up to H below the
        // rotated cube's real corner, so the step onto a block at the top of a slope gets a bigger allowance.
        if ((lift <= 6 && (s.flip ? s.vy >= 0 : s.vy <= 0)) || (s.slopeUid && lift <= 6 + H)) { s.y = s.flip ? b.y0 - H : b.y1 + H; s.vy = 0; if (def.grounded) s.ground = true; s.onSurface = true; }
        else { s.dead = true; s.why = { k: 'wall', b: [b.x0, b.y0, b.x1, b.y1] }; return; }
      }
    }

    /* ---- hazards, pads, orbs, portals ---- */
    var hb = (def.hazardHalf || 13.5) * (s.mini ? MINI_SCALE : 1), touching = false;
    resolveSlopes(world, s, def, H, hb);
    if (s.dead) return;
    for (c = col - 1; c <= col + 1; c++) {
      cell = world.cols[c]; if (!cell) continue;
      for (j = 0; j < cell.h.length; j++) {
        b = cell.h[j];
        if (!ov(s.x - hb, s.x + hb, b.x0, b.x1) || !ov(s.y - hb, s.y + hb, b.y0, b.y1)) continue;
        if (b.r) {                                               // circle (saws): distance from centre to the player box
          var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
          var qx = Math.max(s.x - hb, Math.min(cx, s.x + hb)) - cx, qy = Math.max(s.y - hb, Math.min(cy, s.y + hb)) - cy;
          if (qx * qx + qy * qy >= b.r * b.r) continue;
        }
        { s.dead = true; s.why = { k: 'hazard', b: [b.x0, b.y0, b.x1, b.y1] }; return; }
      }
      for (j = 0; j < cell.t.length; j++) {
        b = cell.t[j];
        if (!ov(s.x - H, s.x + H, b.x0, b.x1) || !ov(s.y - H, s.y + H, b.y0, b.y1)) continue;
        var cl = b.cl;
        if (b.cat === 'pad') {
          touching = true;
          if (s.lastTrig !== b.uid) {
            s.lastTrig = b.uid;
            if (cl.pad === 'blue') {
              // gravBumpPlayer: acts only if the pad points against the player's gravity (floor pad flips normal gravity)
              var padDown = !!b.flipY !== (Math.abs(((b.rot % 360) + 360) % 360 - 180) < 1);
              if (s.flip === padDown) {
                var bm = (s.mini ? 0.8 : 1) * ((s.mode === BALL || s.mode === SPIDER || s.mode === SWING) ? 0.6 : 1);
                s.vy = 16 * 0.8 * bm * (s.flip ? -1 : 1);
                s.flip = !s.flip; s.vy *= 0.5; s.ground = false;
              }
            }
            else { s.vy = padModFn(cl.pad, s.mode, s.mini) * 16 * (s.flip ? -1 : 1); s.ground = false; }
          }
        } else if (b.cat === 'orb') {
          if (ORB && s.buffer) fireOrb(world, s, b);
        } else if (b.cat === 'speed') { s.speed = cl.speed; }
        else if (b.cat === 'portal') {
          var p = cl.p;
          if (p.mode !== undefined) enterMode(world, s, p.mode, b);
          else if (p.grav !== undefined) {
            var want = p.grav === 1;
            if (s.flip !== want) { s.flip = want; s.vy *= 0.5; s.ground = false; }
          } else if (p.size !== undefined) {
            var mini = p.size === 1;
            if (s.mini !== mini) { s.mini = mini; }
          } else if (p.mirror !== undefined) {
            s.mirror = p.mirror === 1;                 // purely visual: the renderer mirrors the screen
          } else if (p.teleport && s.lastTele !== b.uid) {
            // blue teleport portal: move to its linked orange portal (object key 54 = y offset; same x)
            s.lastTele = b.uid; s.y += (b.obj.portalOffset || 0); s.ground = false;
          }
        }
      }
    }
    if (!touching) s.lastTrig = -1;
    if (s.dead) return;
    if (s.y > Y_LIMIT || s.y < -600) { s.dead = true; s.why = { k: 'out of level' }; return; }

    s.prevSurf = !!s.onSurface;
    if (def.afterMove) def.afterMove(s, ctx);

    /* ---- cosmetic rotation ---- */
    if (def.rotation) def.rotation(s, ctx);
  }

  /* ------------------------------------------------------------------ built-in modes --------- */
  registerMode(CUBE, {
    name: 'cube', corridor: 0, grounded: true, hazardHalf: 13.5,
    update: function (s, ctx) {
      var P = ctx.P, fm = ctx.fm;
      if (s.ground && s.hold) { s.vy = P.jump * fm * (s.mini ? 0.8 : 1); s.ground = false; s.buffer = false; }   // v20 = 0.8 mini (updateJump 155814)
      if (!s.ground) {
        s.vy -= P.grav * ctx.dtv * fm;
        if (s.flip) { if (s.vy > CUBE_FALL_MAX) s.vy = CUBE_FALL_MAX; } else if (s.vy < -CUBE_FALL_MAX) s.vy = -CUBE_FALL_MAX;
      }
    },
    rotation: function (s) { if (!s.ground) s.rot += 415 * (1 / 240) * (s.flip ? -1 : 1); else if (s.slopeUid) s.rot = -s.slopeAngle; else s.rot = Math.round(s.rot / 90) * 90; }
  });
  registerMode(SHIP, {
    name: 'ship', corridor: SHIP_H, grounded: false, hazardHalf: 11,
    update: function (s, ctx) {
      var fm = ctx.fm, falling = s.flip ? s.vy > 0 : s.vy < 0;
      var k = s.hold ? -1.0 : (falling ? 0.8 : 1.2);
      var lift = s.hold && falling ? 0.5 : 0.4, v20 = s.mini ? 0.85 : 1;   // v20 = 0.85 mini flying (updateJump)
      s.vy += -(SHIP_G * ctx.dtv * fm * k * lift) / v20;
      var lo = (s.flip ? -SHIP_UP : -SHIP_DOWN) / v20, hi = (s.flip ? SHIP_DOWN : SHIP_UP) / v20;
      if (s.vy < lo) s.vy = lo; if (s.vy > hi) s.vy = hi;
    },
    rotation: function (s, ctx) { s.rot = -Math.atan2(s.vy * V_DT, ctx.P.ps * ctx.P.tm) * 180 / Math.PI; }
  });

  var api = { U: U, CUBE: CUBE, SHIP: SHIP, BALL: BALL, UFO: UFO, WAVE: WAVE, ROBOT: ROBOT, SPIDER: SPIDER, SWING: SWING,
              HALF: HALF, MINI_SCALE: MINI_SCALE, SPEEDS: SPEEDS, SHIP_BOUND_H: SHIP_H, NO_CEIL: NO_CEIL, MODES: MODES,
              buildWorld: buildWorld, newState: newState, cloneState: cloneState, stepFrame: stepFrame, stepSub: stepSub, STEPS: STEPS,
              registerMode: registerMode, registerOrbHandler: registerOrbHandler, setPadMod: setPadMod, findSurface: findSurface,
              speedPerSecond: function (n) { return SPEEDS[n].ps * SPEEDS[n].tm * 60; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GDEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
