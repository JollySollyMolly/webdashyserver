(function (E) {
  'use strict';
  var MODE = E.SPIDER;                       // 6
  // decompile: PlayerObject::spiderTestJumpInternal (154650), its search window (v7/v8 = max(floor, y-3000), y+3000)
  var SEARCH = 3000;
  var FALL_MAX = 15;                         // GUESS: cube terminal velocity; not read from the decompile

  function ov(a0, a1, b0, b1) { return a0 < b1 - 1e-6 && b0 < a1 - 1e-6; }

  // Nearest surface in direction dir (+1 = above, -1 = below) for the spider's centre.
  // Solids come from ctx.findSurface; spikes (damaging objects) are also candidates, as in the decompile
  // (spiderTestJumpInternal treats GJBaseGameLayer::damagingObjectsInRect the same way). Returns the centre y or null.
  function target(s, ctx, dir) {
    var best = ctx.findSurface(dir), h = ctx.half, U = ctx.U, world = ctx.world;
    var col = Math.floor(s.x / U);
    for (var c = col - 1; c <= col + 1; c++) {
      var cell = world.cols[c]; if (!cell) continue;
      for (var j = 0; j < cell.h.length; j++) {
        var b = cell.h[j];
        if (!ov(s.x - h, s.x + h, b.x0, b.x1)) continue;
        if (dir > 0 && b.y0 >= s.y + h - 0.5) { var tu = b.y0 - h; if (best === null || tu < best) best = tu; }
        if (dir < 0 && b.y1 <= s.y - h + 0.5) { var td = b.y1 + h; if (best === null || td > best) best = td; }
      }
    }
    return best;
  }

  E.registerMode(MODE, {
    name: 'spider',
    corridor: 270,          // lead review: GJBaseGameLayer::getGroundHeightForMode(33) = 270 (line 419619), the portal creates floor+ceiling like the ball
                            // (basic modes search y-3000..y+3000). getGroundHeightForMode(33) gives 270 for the camera only.
    grounded: true,
    hazardHalf: 13.5,
    update: function (s, ctx) {
      // a fresh press while on a surface: teleport to the nearest surface in the opposite direction
      // (decompile: updateJump calls spiderTestJump(this,0) when grounded (1909) and buffered (1969))
      if (s.ground && s.buffer) {
        var dir = ctx.fm;                                    // normal gravity: search above (+1), flipped: below (-1)
        var t = target(s, ctx, dir), newFlip = !s.flip;
        if (t === null) {                                    // nothing found: the decompile's fallback
          t = dir > 0 ? s.y + SEARCH - ctx.half              // v8 - hs, v8 = y + 3000
                      : Math.max(s.gy, s.y - SEARCH) + ctx.half; // v7 + hs, v7 = max(floor, y - 3000)
        }
        s.y = t;
        s.flip = newFlip;
        s.vy = newFlip ? 1 : -1;                             // decompile: setYVelocity(-flipMod(), ...) after flipGravity
        s.buffer = false; s.ground = false;
        return;                                              // no gravity on the teleport substep
      }
      if (!s.ground) {
        s.vy -= ctx.C.SHIP_G * ctx.dtv * ctx.fm;             // decompile: v15 = 0.9582 for isSpider (1966)
        if (s.flip) { if (s.vy > FALL_MAX) s.vy = FALL_MAX; } else if (s.vy < -FALL_MAX) s.vy = -FALL_MAX;
      }
    },
    rotation: function (s) { s.rot = s.flip ? 180 : 0; }
  });

  // Static pose: the idle frame of Spider_AnimDesc.plist (Spider_idle_001.png, sprite_0..5), positions in world units.
  var POSE = [
    { f: 'spider_01_02_001.png', x: 5.025,  y: -6.725, r: 0,        s: 0.88376, fx: false, z: 0 },
    { f: 'spider_01_02_001.png', x: 14.35,  y: -6.725, r: 0,        s: 0.88376, fx: true,  z: 1 },
    { f: 'spider_01_04_001.png', x: -4.45,  y: 0.075,  r: -7.68,    s: 1.0,     fx: false, z: 2 },
    { f: 'spider_01_01_001.png', x: 0.575,  y: 4.05,   r: 0,        s: 1.0,     fx: false, z: 3, body: true },
    { f: 'spider_01_03_001.png', x: -13.3,  y: -6.9,   r: 38.96,    s: 1.0,     fx: false, z: 4 },
    { f: 'spider_01_02_001.png', x: -2.475, y: -5.975, r: 0,        s: 1.0,     fx: false, z: 5 }
  ];

  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    var k = api.scale, flip = S.flip, rot = S.rot || 0;
    // offsets in the pose are upright; for flipped gravity rotate by 180 degrees (negate the offsets)
    var sg = flip ? -1 : 1;
    POSE.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (p) {
      var px = S.x + sg * p.x * k, py = S.y + sg * p.y * k;
      if (p.body) {
        api.icon('spider_01_01', px, py, { rot: rot, scale: 1, extra: true });
      } else {
        api.sprite(p.f, px, py, { rot: (flip ? 180 : 0) + p.r, scale: p.s * k, fx: p.fx, tint: api.P1 });
      }
    });
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
