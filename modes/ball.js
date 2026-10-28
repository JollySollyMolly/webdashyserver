/* BALL (roll) mode, ported from Geometry Dash 2.2 (PlayerObject::updateJump ball branch, flag 1963).
 * Also covers pushButton / releaseButton (hold flag 1909), hitGround (buffer flag 1969), flipGravity,
 * toggleRollMode and runBallRotation / runBallRotation2. Line numbers are in modes/ball.md. */
(function (E) {
  'use strict';
  var MODE = E.BALL;                       // 2

  var ROLL_G = 0.9582;                     // updateJump: v15 = 0.9582 when ball / flying / spider
  var BALL_GRAV_MUL = 0.6;                 // updateJump: v18 = 0.6 when ball (1963), 0.9 robot, 1.0 cube
  var FLIP_HALVE = 0.5;                    // flipGravity: vy *= 0.5
  var FLIP_BALL = 0.6;                     // updateJump ball branch: vy *= 0.6 after flipGravity
  var FALL_MAX = 15;                       // updateJump tail: terminal velocity (same clamp as cube)

  // rotation: speed factor by timeMod (runBallRotation / runBallRotation2)
  function speedFactor(tm) {
    if (tm === 0.7) return 1.2406;
    if (tm === 1.1) return 0.80424;
    if (tm === 1.3) return 0.66577;
    if (tm === 1.6) return 0.54094;
    return 1.0;
  }

  // deg/s. Ground roll: 120 * flipMod / (sizeMod * 0.2 * speed). Air spin after a flip: -340 * flipMod / (sizeMod * 0.8 * speed).
  function rollRate(s, ctx) {
    var m = s.mini ? 0.8 : 1.0, v = speedFactor(ctx.P.tm), fm = s.flip ? -1 : 1;
    if (s.bSpin) return -340 * fm / (m * 0.8 * v);
    return 120 * fm / (m * 0.2 * v);
  }

  E.registerMode(MODE, {
    name: 'ball',
    corridor: 240,                         // GJBaseGameLayer::getGroundHeightForMode(16) = 240.0 (line 419619)
    grounded: true,
    hazardHalf: 13.5,                      // GUESS: same hazard box as the cube (ball hitbox not decoded)

    update: function (s, ctx) {
      var fm = ctx.fm;
      if (ctx.pressed) s.bHeld = true;     // pushButton sets 1909 (hold)
      if (!ctx.hold) s.bHeld = false;      // releaseButton clears 1909

      // Flip: needs a held click and a surface contact (1969 is armed by hitGround and cleared by flipGravity).
      // Click in the air is kept (bHeld) until the ball lands, as long as the button is still down.
      if (s.bHeld && s.onSurface) {
        s.vy = ctx.P.jump * fm * (s.mini ? 0.8 : 1.0);   // v26 * flipMod * v20 (v20 = 0.8 mini, 1.0 normal)
        s.flip = !s.flip;                                // flipGravity(!flip)
        s.vy *= FLIP_HALVE;                              // inside flipGravity
        s.vy *= FLIP_BALL;                               // ball branch of updateJump
        s.bHeld = false;                                 // 1909 = 0
        s.bSpin = true;                                  // runBallRotation2
        s.bFlipNow = true;                               // afterMove drops onSurface (no re-arm this substep)
        s.ground = false;
        return;                                          // no gravity this substep (goto LABEL_92)
      }

      // Gravity: vy -= 0.6 * 0.9582 * dt * flipMod, then the +-15 clamp.
      s.vy -= BALL_GRAV_MUL * ROLL_G * ctx.dtv * fm;
      if (s.flip) { if (s.vy > FALL_MAX) s.vy = FALL_MAX; }
      else if (s.vy < -FALL_MAX) s.vy = -FALL_MAX;
    },

    afterMove: function (s) {
      if (s.bFlipNow) { s.bFlipNow = false; s.onSurface = false; s.ground = false; }
    },

    onEnter: function (s) {
      s.bSpin = false;                     // toggleRollMode -> stopRotation
      s.bFlipNow = false;
    },

    rotation: function (s, ctx) {
      if (s.onSurface) s.bSpin = false;    // hitGround: stopRotation, then ground roll
      s.rot += rollRate(s, ctx) / 240;     // deg per substep (1/240 s)
      s.k = (s.bHeld ? 'h' : '-') + (s.onSurface ? 's' : '-');
    }
  });

  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    api.icon('player_ball_01', S.x, S.y, { rot: S.rot });
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
