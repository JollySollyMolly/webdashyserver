/* orbs.js - jump rings (orbs) and per-mode pad bump modifiers, ported from the GD 2.206 decompile.
 *
 *   ringJump            gd-ida-decomp.cpp 159830 (velocity block 160100-160390)
 *   GJBaseGameLayer::playerTouchedRing 463276 ; PlayerObject::pushButton 160405 ; updateJumpVariables 150814
 *   PlayerObject::propellPlayer 147666 ; PlayerObject::bumpPlayer 157048 ; GJBaseGameLayer::bumpPlayer 463168
 *   GJBaseGameLayer::getBumpMod 421316 ; GJBaseGameLayer::gravBumpPlayer (blue pad) ; PlayerObject::flipGravity 151121
 *
 * Mode-flag bytes used by the game: 1961 ship, 1962 UFO, 1963 ball, 1964 wave, 1965 robot, 1966 spider, 1972 swing.
 * Mini scale is the float at +2016 (1.0 normal, 0.6 mini); "mini" below means that scale is not 1.0.
 */
(function (E) {
  'use strict';
  var CUBE = 0, SHIP = 1, BALL = 2, UFO = 3, WAVE = 4, ROBOT = 5, SPIDER = 6, SWING = 7;
  var MINI_F = 0.8;                                    // ringJump v22 / propellPlayer v9 when mini
  // isFlying(): ship || UFO || wave || swing. For these, playerTouchedRing never calls ringJump,
  // so an orb only fires on a fresh press made while already overlapping it.
  var FLYING = {}; FLYING[SHIP] = 1; FLYING[UFO] = 1; FLYING[WAVE] = 1; FLYING[SWING] = 1;

  /* ---- ring (orb) jump multiplier on P.jump, before the mini factor and the mode factors ---- */
  function ringK(kind, mode, mini) {
    switch (kind) {
      case 'yellow':                                   // fall-through case in ringJump: only robot is scaled
        return mode === ROBOT ? 0.9 : 1.0;
      case 'pink':                                     // v24: 0.37 ship, 0.42 UFO, 0.77 ball, 0.72 otherwise
        if (mode === SHIP) return 0.37;
        if (mode === UFO) return 0.42;
        if (mode === BALL) return 0.77;
        return 0.72;
      case 'red':                                      // 1.4/1.0 ship, 1.36/1.02 UFO, 1.34 ball+spider,
        if (mode === SHIP) return mini ? 1.4 : 1.0;    //   1.28 robot, 1.38 cube/wave/swing
        if (mode === UFO) return mini ? 1.36 : 1.02;
        if (mode === BALL || mode === SPIDER) return 1.34;
        if (mode === ROBOT) return 1.28;
        return 1.38;
      case 'blue':                                     // v23 * 0.8 (then the gravity flip halves vy, see below)
        return 0.8;
      case 'green':                                    // 0.7 in ship only (gravity flips first, see below)
        return mode === SHIP ? 0.7 : 1.0;
    }
    return 1.0;
  }
  /* post-velocity multipliers applied to every non-black ring (ball, swing and spider branches) */
  function ringPost(mode) {
    if (mode === BALL) return 0.7;                   // *0.699999988 (ball), 1909 hold cleared
    if (mode === SWING) return 0.6;                  // *0.600000024 (swing), 1909 hold cleared
    if (mode === SPIDER) return 0.7;                 // *0.699999988 (spider), 1909 hold cleared
    return 1.0;
  }

  /* ---- ORB handler: called by the core only when the orb overlaps, the press is buffered and the orb is unused ---- */
  E.registerOrbHandler(function (s, ctx, orb) {
    var mode = s.mode, kind = orb.kind;
    // Flying modes (ship/UFO/wave/swing): only a click made while overlapping the orb fires it (pushButton path).
    if (FLYING[mode] && !ctx.pressed) return false;
    var mini = !!s.mini, J = ctx.P.jump;             // 1568 = speed-table jump (11.18 normal)
    var mf = mini ? MINI_F : 1.0;

    if (kind === 'black') {                          // DropRing: strong push toward gravity, no mini factor
      var fmB = s.flip ? -1 : 1, vb;
      if (FLYING[mode]) { vb = -14 * fmB; if (mode === UFO) vb *= 0.8; }
      else { vb = -15 * fmB; if (mode === SPIDER) vb *= 1.1; }
      s.vy = vb;
      s.buffer = false;
      return true;
    }

    if (kind === 'green') {                          // flip gravity first, then launch with the new sign
      s.flip = !s.flip;
    }
    var fm = s.flip ? -1 : 1;                        // flipMod() at the time of setYVelocity
    var v = J * ringK(kind, mode, mini) * mf * fm * ringPost(mode);
    s.vy = v;
    if (kind === 'blue') {                           // flipGravity after the launch: halves vy
      s.flip = !s.flip;
      s.vy *= 0.5;
    }
    s.buffer = false;                                // press consumed (1910 = 0 in ringJump)
    return true;
  });

  /* ---- pad bump modifiers: velocity = modifier * 16 * flipMod (core). Blue pad is a flip handled by the core. ---- */
  E.setPadMod(function (kind, mode, mini) {
    var m = 1.0;                                     // yellow: getBumpMod default
    if (kind === 'pink') {                           // getBumpMod case 9
      if (mode === SHIP) m = 0.35;
      else if (mode === UFO) m = 0.40;
      else if (mode === BALL || mode === SPIDER) m = 0.70;
      else m = 0.65;
    } else if (kind === 'red') {                     // getBumpMod case 34
      if (mode === SHIP) m = mini ? 0.95 : 0.63;
      else if (mode === UFO) m = mini ? 0.98 : 0.60;
      else m = 1.25;
    }
    if (mini) m *= MINI_F;                           // propellPlayer v9 = 0.8 when mini
    if (mode === BALL || mode === SPIDER || mode === SWING) m *= 0.6;   // propellPlayer *0.6 (1963/1966/1972)
    return m;
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
