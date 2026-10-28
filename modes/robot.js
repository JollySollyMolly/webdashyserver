(function (E) {
  'use strict';
  var MODE = E.ROBOT;                      // 5

  // Constants from PlayerObject::updateJump (gd-ida-decomp.cpp, line 155299) and friends.
  var V18 = 0.9;                           // v18 = 0.9 when isRobot (1965); 1.0 default (line 155739, 0.6 at 155735 is for 1963/1966/1972)
  var START_SCALE = 0.5;                   // jump impulse: v26 = field196 (jump); "if (1965) v26 = v26 * 0.5" (line 155787)
  var BOOST_MAX = 1.5;                     // hold-boost accumulator cap: "if (v51 < 1.5)" (line 155924), field 210 = byte offset 1680
  var BOOST_RATE = 0.1;                    // accumulator += a2 * 0.1 per call (line 155926)
  var FALL_MAX = 15;                       // terminal velocity clamp, non-jump path (lines 155999-156010)

  function setK(s) {
    // Bot-visible copy of the robot state. Only meaningful while jumping; everything else collapses to 'g'.
    s.k = s.robotJump
      ? 'j' + Math.round(s.robotBoost * 100) + (s.robotCut ? 'c' : 'h')
      : 'g';
  }

  E.registerMode(MODE, {
    name: 'robot', corridor: 0, grounded: true, hazardHalf: 13.5,

    onEnter: function (s, ctx, prev) {
      // toggleRobotMode (line 153191) sets field 210 (boost accumulator, byte offset 1680) to 1.5 on enter.
      // The value only matters after a jump start, which resets it to 0, so this is kept for fidelity.
      s.robotJump = false; s.robotCut = false; s.robotBoost = 1.5;
      setK(s);
    },

    update: function (s, ctx) {
      var P = ctx.P, fm = ctx.fm, a2 = ctx.dtv;   // a2 = updateJump argument (game passes dt * 0.9)
      var step = P.grav * a2;                       // v50 = gravity * a2 (gravity mod v17 is 1.0 in normal play)

      // releaseButton (line 159494) sets 1932 ("released") on button up. Cleared again at jump start.
      if (ctx.released) s.robotCut = true;

      // Ground jump. v11 = holding && press pending (1909 && 1910, robot-only gate "if (1965 && !1910) v11 = 0"),
      // and onGround (1969). Pressing on the ground starts the jump; no gravity is applied on this substep.
      if (s.ground && s.hold && s.buffer) {
        s.vy = START_SCALE * P.jump * fm;          // v20 = 1.0 (field 504 == 1.0 in normal play)
        s.ground = false; s.buffer = false;
        s.robotJump = true; s.robotBoost = 0; s.robotCut = false;   // clears 2060/1910/1932, field 210 = 0
        return;
      }

      if (s.robotJump) {
        // In-jump block (flag 2060). Boost while held, not released, accumulator below the cap.
        if (s.hold && !s.robotCut && s.robotBoost < BOOST_MAX) {
          s.robotBoost += a2 * BOOST_RATE;
          s.vy += step * V18 * fm;                 // addToYVelocity(..., 61): boost
        }
        s.vy -= step * V18 * fm;                   // addToYVelocity(..., 62): gravity, always applied here
        // playerIsFallingBugged(): non-flipped vy < 2*grav, flipped vy > 2*grav (default branch). Ends the jump state.
        if (s.flip ? s.vy > 2 * P.grav : s.vy < 2 * P.grav) s.robotJump = false;
        return;                                     // in-jump path has no terminal-velocity clamp
      }

      // Airborne or standing without a jump: gravity with the same 0.9 scale, then terminal velocity (line ~155983).
      s.vy -= step * V18 * fm;                      // addToYVelocity(..., 63)
      if (s.flip) { if (s.vy > FALL_MAX) s.vy = FALL_MAX; }
      else if (s.vy < -FALL_MAX) s.vy = -FALL_MAX;
    },

    afterMove: function (s) { setK(s); },

    rotation: function (s) {
      // toggleRobotMode calls stopRotation, and updateJump never runs runRotateAction for isRobot.
      // The robot stays upright; gravity flip is shown by the draw code (mirror y), not by rotating.
      s.rot = 0;
    }
  });

  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    // Static assembled pose (no AnimDesc playback). Offsets are in world units, y up, relative to the centre.
    // Parts: robot_01_02 thigh (rot frame), robot_01_03 shin, robot_01_04 foot, robot_01_01 body (drawn last, on top).
    var fy = !!S.flip, x = S.x, y = S.y, k = api.scale;
    function part(base, dx, dy) {
      var oy = fy ? -dy : dy;
      api.icon(base, x + dx * k, y + oy * k, { fy: fy });   // sprite() rotates frames flagged rot itself
    }
    [-1, 1].forEach(function (side) {
      part('robot_01_04', side * 4, -11.25);   // foot
      part('robot_01_03', side * 5, -8);       // shin
      part('robot_01_02', side * 5, -1.5);     // thigh
    });
    part('robot_01_01', 0, 4);                 // body / head
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
