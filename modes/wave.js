/* Wave ("dart") mode - Geometry Dash 2.2, PlayerObject internal mode 26, portal 660.
 * Port of PlayerObject::updateJump (decompile line 155299, flying branch, "!1962 && !1972" arm)
 * and PlayerObject::update (line 160837, vertical displacement for 1964 && !2004).
 * See modes/wave.md for the line-by-line evidence and the GUESS list. */
(function (E) {
  'use strict';
  var MODE = E.WAVE;                                  // 4

  var CORRIDOR = 300;                                 // GJBaseGameLayer::getGroundHeightForMode(26) = 300.0 (line 419619)
  var SOLID_HALF = 5;                                 // player content size 10 (toggleDartMode, line 153042) -> half 5 (cube: 30 -> 15)
  var HAZARD_HALF = 4.5;                              // cube hazard half is 13.5 = 15 * 0.9; same 0.9 factor applied (GUESS)
  var ROT_LERP = 0.25;                                // updateShipRotation (line 144607): per-frame lerp factor, normal (mini 0.4)
  var DEG = 180 / Math.PI;

  E.registerMode(MODE, {
    name: 'wave',
    corridor: CORRIDOR,
    grounded: false,
    hazardHalf: HAZARD_HALF,
    solidHalf: SOLID_HALF,                            // NOT supported by engine.js yet, see Engine requests in wave.md

    /* vy is per-frame velocity (the core integrates y += vy * V_DT per frame).
     * Decompile: the wave has no gravity and no clamp (updateJump lines 155600-155650 set vy, but
     * PlayerObject::update lines 161044-161075 uses it only for non-wave modes). The actual displacement is
     *   dy = |x-speed| * flipMod * (holding ? +1 : -1) * (mini ? 2 : 1)
     * where x-speed = tm * ps (PlayerObject::getCurrentXVelocity). The x step is ps*tm, so the slope is
     * 1 (45 degrees) normal and 2 (about 63.4 degrees) mini. Converting to the core's vy: dy = vy * V_DT. */
    update: function (s, ctx) {
      var P = ctx.P;
      var dx = P.tm * P.ps;                           // per frame, same as the core's horizontal step
      var dy = dx * (s.mini ? 2 : 1);                 // mini doubles the vertical step (line 161075: v35 = v35 + v35 when 2016 != 1.0)
      var dir = (s.hold ? 1 : -1) * ctx.fm;           // hold = up, release = down, both flipped by gravity
      s.vy = dir * dy / ctx.V_DT;
    },

    /* Any horizontal overlap with a block kills the wave. There is no ledge forgiveness, because
     * canStickToGround() is false for the wave (line 144407 with 1964 set). Floor and ceiling
     * contact is still resolved by the core as sliding. */
    wall: function () { return 'die'; },

    /* Points along the direction of travel. Target = -atan(slope) in the engine's rot convention
     * (negative = nose up, matching the ship). Smoothed per substep as GD does per frame. */
    rotation: function (s, ctx) {
      var slope = s.mini ? 2 : 1;
      var dir = (s.hold ? 1 : -1) * ctx.fm;
      var target = -dir * Math.atan(slope) * DEG;
      var k = 1 - Math.pow(1 - (s.mini ? 0.4 : ROT_LERP), 1 / ctx.STEPS);
      s.rot += (target - s.rot) * k;
    }
  });

  /* Drawing: dart_01 layers (player_ball_01 style; api.icon draws P1 + P2 and handles mini scale). */
  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    api.icon('dart_01', S.x, S.y, { rot: S.rot });
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
