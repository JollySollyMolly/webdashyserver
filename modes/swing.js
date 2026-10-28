/* Swing mode (GD 2.2 "swing" / E.SWING = 7, portal 1933). Plug-in for engine v3.
 *
 * Decompile references (gd-ida-decomp.cpp):
 *   updateJump  155299  (swing branch: inside isFlying, !ship(1961), !bird(1962), swing(1972))
 *   toggleSwingMode 152569, updateSwingFire 151075, pushButton 160405, releaseButton 159494
 *   flipGravity 151121, flipMod 143484, setYVelocity 141992, addToYVelocity 142043
 *   isFlying 144427 (returns 1961|1962|1964|1972), updateRotation 144846, updateShipRotation 144607
 *   updateMove 148936 (calls updateRotation), update 160837 (calls updateJump with a2*0.9)
 *   updatePlayerSwingFrame 146587, switchToFlyMode 420198
 */
(function (E) {
  'use strict';
  var MODE = E.SWING;                                   // 7

  // Gravity constant shared by the flying modes (updateJump: v15 = 0.9582 when isFlying).
  var SWING_G = 0.9582;
  // Swing acceleration factor (updateJump: v102 = 0.4 when player scale == 1.0, else 0.6).
  var SWING_ACC_NORMAL = 0.4, SWING_ACC_MINI = 0.6;
  // Velocity clamp after the swing branch (v20 = 1.0, v91 = 1.0, so both bounds are +-8).
  var SWING_VMAX = 8;
  // Velocity kept after a gravity flip: updateJump calls setYVelocity(vy * 0.8) right after flipGravity.
  var SWING_FLIP_KEEP = 0.8;
  // Rotation chase rate: updateShipRotation calls Slerp2D(cur, target, 0.15 * a2) with a2 = updateJump's dt.
  var SWING_ROT_RATE = 0.15;
  var V_DT = 0.9;

  E.registerMode(MODE, {
    name: 'swing',
    corridor: 300,              // getGroundHeightForMode(41) = 300 (line 419619, lead review)
    grounded: false,
    hazardHalf: 11,             // GUESS: flying modes share the ship's smaller box

    /* Every click (press edge, buffered in s.buffer) flips gravity and keeps 80% of the velocity.
     * Between clicks the player always accelerates toward the current gravity direction. Holding
     * does nothing else. Gravity uses the same per-substep factor (ctx.dtv) as ship and cube. */
    update: function (s, ctx) {
      if (s.buffer && s.hold) {                 // pushButton sets 1909 (hold) + 1910 (pending press)
        s.buffer = false;
        s.flip = !s.flip;
        s.vy *= SWING_FLIP_KEEP;                // setYVelocity(vy_before * 0.8, 10)
        s.ground = false;
      }
      var fm = s.flip ? -1 : 1;                 // flipMod is read after the flip
      var k = ctx.mini ? SWING_ACC_MINI : SWING_ACC_NORMAL;
      s.vy += -(SWING_G * k * ctx.dtv * fm);    // addToYVelocity(-(k * 0.9582 * a2 * flipMod), 67)
      if (s.vy < -SWING_VMAX) s.vy = -SWING_VMAX;
      if (s.vy > SWING_VMAX) s.vy = SWING_VMAX;
    },

    /* Entering swing: toggleSwingMode halves the velocity (1936 *= 0.5) and resets the rotation. */
    onEnter: function (s) {
      s.vy *= 0.5;
      s.rot = 0;
    },

    /* Ship-style tilt toward the movement direction (updateShipRotation), but chased with a damped
     * slerp (rate 0.15) instead of snapped. Called once per substep, so the per-call step is 0.15 * dtv. */
    rotation: function (s, ctx) {
      var P = ctx.P;
      var dy = s.vy * ctx.dtv;                  // per-substep displacement, y up
      var dx = P.ps * P.tm * ctx.A;             // per-substep displacement, x
      if (dx * dx + dy * dy < ctx.dtv * 1.2) return;   // the game skips a nearly still ship
      var target = -Math.atan2(dy, dx) * 180 / Math.PI; // -atan2 because positive rot = clockwise
      var d = ((target - s.rot) % 360 + 540) % 360 - 180;  // shortest arc, degrees
      s.rot += d * SWING_ROT_RATE * ctx.dtv;
    }
  });

  // Draw: P2 (swing_01_2), P1 (swing_01), then the _extra frame, through the shared icon helper.
  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    api.icon('swing_01', S.x, S.y, { rot: S.rot, fy: S.flip, extra: true });
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
