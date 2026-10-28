/* UFO (bird) mode, ported from Geometry Dash 2.2 (PlayerObject flag byte 1962, toggleBirdMode).
 * Line numbers refer to asm/gd-ida-decomp.cpp. Items marked GUESS are not fully confirmed by the decompile.
 * Details and open questions are in modes/ufo.md. */
(function (E) {
  'use strict';
  var MODE = E.UFO;                              // 3

  var UFO_G = 0.9582;                            // updateJump 155463-155464: v15 = 0.9582 for flying modes (shared with ship)
  var MINI_V20 = 0.85;                           // updateJump 155476-155480: v20 = 0.85 when flying and mini (v2016 != 1)
  var TILT = -0.4;                               // updateShipRotation 144657: v10 *= -0.4 when 1962 (bird)
  var TILT_MAX = 0.1;                            // updateShipRotation 144668-144670: clamp to +-0.1 rad (not flipped)
  var TILT_RATE = 0.07;                          // updateShipRotation 144722-144731: v13 = 0.07 per frame

  E.registerMode(MODE, {
    name: 'ufo',
    corridor: 300,                               // GJBaseGameLayer::getGroundHeightForMode(19) = 300 (line 419619)
    grounded: false,
    hazardHalf: 11,                              // GUESS: flying-family hazard box (ship uses 11); bird hitbox not decoded

    onEnter: function (s) {
      // toggleBirdMode 152928: vy is halved when the UFO mode is switched on
      s.vy *= 0.5;
    },

    update: function (s, ctx) {
      // Bird branch of PlayerObject::updateJump (flag 1962), reviewed against the decompile (lead review):
      //   click (pending 1910 + held 1909): vy = max(vy, 7.0 * flipMod * v20)  - 8.0 instead of 7.0 when mini
      //   otherwise gravity: vy -= 0.9582 * dt * flipMod * (falling ? 0.8 : 1.2) * 0.5 / v20
      //   clamp (LABEL_237, v91 = 0.8): up to 8 / v20, down to 0.8 * 8 / v20 (mirrored when flipped)
      var fm = ctx.fm, v20 = s.mini ? MINI_V20 : 1.0;
      if (ctx.pressed) {
        var imp = (s.mini ? 8.0 : 7.0) * fm * v20;
        if (fm > 0 ? imp > s.vy : imp < s.vy) s.vy = imp;
      } else {
        var falling = fm > 0 ? s.vy < 0 : s.vy > 0;
        s.vy -= UFO_G * ctx.dtv * fm * (falling ? 0.8 : 1.2) * 0.5 / v20;
      }
      var up = 8 / v20, down = 0.8 * 8 / v20;
      if (!s.flip) { if (s.vy > up) s.vy = up; if (s.vy < -down) s.vy = -down; }
      else { if (s.vy < -up) s.vy = -up; if (s.vy > down) s.vy = down; }
    },

    rotation: function (s, ctx) {
      // Tilt toward atan2 of the per-frame displacement, times -0.4 (updateShipRotation 144654-144657).
      // Here dy = vy * 0.9 (per frame) and dx = ps * tm (per frame). The decompile's own sign convention is kept.
      var dx = ctx.P.ps * ctx.P.tm, dy = s.vy * ctx.V_DT;
      var target = TILT * Math.atan2(-dy, dx);     // v10 = atan2(-dy, dx); v10 *= -0.4
      if (!s.flip) target = Math.max(-TILT_MAX, Math.min(TILT_MAX, target));
      var cur = s.rot * Math.PI / 180;
      // Slerp toward target at 0.07 per frame (per substep here, so divide by STEPS)
      cur += (target - cur) * TILT_RATE / E.STEPS;
      s.rot = cur * 180 / Math.PI;
    }
  });

  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    // bird_01 layers (_2_ secondary, main), then the dome (_3_), then a small player_01 cube inside the dome
    api.icon('bird_01', S.x, S.y, { rot: S.rot, fy: S.flip });
    api.sprite('bird_01_3_001.png', S.x, S.y, { rot: S.rot, scale: api.scale, tint: api.P2, fy: S.flip });
    api.icon('player_01', S.x, S.y + (S.flip ? -4 : 4), { rot: S.rot, scale: 0.5, fy: S.flip });
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
