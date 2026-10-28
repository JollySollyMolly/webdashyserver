# Swing mode (E.SWING = 7, portal 1933)

Code: `/home/claude/webdash/modes/swing.js`. Decompile: `gd-ida-decomp.cpp` (path in AGENT_BRIEF.md).

## 1. What is implemented (all values from the decompile unless marked GUESS)

- **Flip on click.** A press (pushButton 160405 sets 1909 hold and 1910 pending) flips gravity while held.
  updateJump 155604-155616: when 1972 (swing) and 1910 and 1909 are set, `flipGravity(!flip)` (155612), then
  `vy = 0.8 * vy_before` (setYVelocity 155615). The engine uses `s.buffer && s.hold`. Holding does nothing else.
- **Gravity.** Each substep: `vy += -(k * 0.9582 * a2 * flipMod)`, with `a2 = ctx.dtv` (update 161031 passes `a2*0.9`,
  the same convention as the cube and ship). `flipMod` is read after the flip (143484). `k = 0.4` at scale 1.0
  (155622-155624: `v102 = 0.6; if (*v16 == 1.0) v102 = 0.4`), and `k = 0.6` when mini (scale 0.6).
  `v16` is `this+2016` (setPosition 143842 uses it as the player scale). `0.9582` is `SHIP_G`, the flying constant (v15, 144427 isFlying).
- **Velocity clamp.** The shared LABEL_237 clamp (155558-155585) runs for swing. The swing branch sets `v20 = v91 = 1.0`
  (155630), so the clamp is **+-8 in both directions**, at any size.
- **Enter swing.** toggleSwingMode 152586: `vy *= 0.5`; rotation reset to 0 (onEnter).
- **Rotation.** updateShipRotation 144607-144742 (flying path, since isFlying includes 1972). Target is
  `-atan2(dy, dx)` (144654, with positive = clockwise as for the ship). Swing chase rate is `v13 = 0.15` (144698),
  applied as `Slerp2D(cur, target, 0.15*a2)` (144726, 144731). `a2` is the per-substep dt (updateMove 149550 and 161043).
  Skipped when `dx^2 + dy^2 < 1.2*dtv` (144651 area).
- **Draw.** `api.icon('swing_01', x, y, {rot, fy: flip, extra: true})` gives `swing_01_2_001`, `swing_01_001`,
  `swing_01_extra_001`. The frame names match updatePlayerSwingFrame 146587-146661, which also has `_glow`
  (not drawn).
- **Corridor 300** (`corridor: 300`). GUESS: believed value, not read from the decompile. getTargetFlyCameraY did not expose it.
- `hazardHalf: 11`. GUESS: copied from ship (flying hitbox).

## 2. GUESS / not modelled

- Corridor 300 (above). Hitbox 11 (above).
- `fy` flip on gravity change in the draw code: GUESS (the ship does this; the swing sprite was not checked).
- Gravity trigger multiplier (`2356`, set by triggerGravityChange 422804) assumed 1.0.
- Not modelled: flag 1970 (mirrors rotation sign), flag 1858 (boost; skips the clamp), setYVelocity 1/1000 rounding.
- Sensitivity: the normal-size constant 0.4 is the direct reading of line 155622-155624, but the test below shows it
  matters for hard courses. If the real game differs, that line is the first thing to check.

## 3. Tests (run with the current `modes/` directory)

- Plug-in check: `require('engine.js'); require('modes/swing.js')` gives `MODES[7].name = 'swing'`, `corridor = 300`.
- Free fall with no input: from y=150 it clamps at vy=-8 and lands on the floor (y=15) by about frame 35. Rotation settles to 0 on the floor.
- Courses (`mklevel.js`, start mode 7). Run with `node tools/bot.js <file.lvl>`:
  - A_gaps (3 walls, gaps 60/60/30): `LEVEL CLEARED in 228 frames (3.8s)`.
  - B_zigzag75 (12 alternating floor/ceiling spikes, 75 apart): `LEVEL CLEARED in 271 frames (4.5s)`.
  - C_zigzag40 (16 spikes, 40 apart): `LEVEL CLEARED in 228 frames`.
  - D_mini (mini portal at x=100, then B): `LEVEL CLEARED in 271 frames`.
  - E_tight120 (walls 120 apart): `NO SURVIVORS at frame 72 x~389`. Geometry is too tight (infeasible), same result at both constants.
  - F_tight200 (6 walls 200 apart, 60-unit gaps alternating high/low): with 0.4 (as decompiled):
    `NO SURVIVORS at frame 241 x~1267 y 15 mode 7 why(hold) {"k":"wall","b":[1285,0,1315,30]}`. With 0.6 (scratch copy):
    `LEVEL CLEARED in 382 frames (6.4s)`. The course separates the two constants; it does not prove either one.
- **Built-in level 22** (`node tools/bot.js 22`): starts in **cube** mode (mode 0). Run with the current modes:
  `NO SURVIVORS at frame 114 x~607 y 38 mode 0 why {"k":"hazard","b":[612,9,618,21]}`. An earlier run (before the
  orb and ball modes existed) stopped at x~462 with the same mode and cause type. The first swing portal (1933) in
  level 22 is at x=4641, so the bot never reaches swing content from the full level.
- **Level 22 swing section** (objects x 4600-6700, shifted, start mode 7, `swing_slice.lvl`):
  `LEVEL CLEARED in 388 frames (6.5s)`. Caveat: `mklevel` cannot encode `flipX`, so 166 objects lost it and some
  hazards may face the wrong way.
- **Regression, level 2:** `LEVEL CLEARED in 4870 frames (81.2s, search 184.0s)`, exit 0. Level 1 was not run.
- Housekeeping: the bot writes `tools/sol_<name>.json` on each clear. I removed the files my runs created
  (sol_2.json and the sol_*_lvl.json test files). Other agents' sol files were left alone.

## 4. Engine requests

1. **Stale `fm` after a mode flips gravity in update.** In `substep`, `fm` comes from `makeCtx` before `def.update(s, ctx)`.
   A flip inside update leaves the vertical-collision tests (`fm === 1` for `groundHit` and `hitCeiling`) on the old
   gravity for that substep. Request: re-read `fm = s.flip ? -1 : 1` right after `def.update`. Impact is small for swing
   (not grounded) but matters for future modes that flip in update.
2. No other engine change is needed. `onEnter` and the rotation hook are enough.
3. Level 22 needs the red orb (1333 at x=375) and the ball portal (2413, mode 2). Both were unsupported in the first run.
   Orbs are the orb agent's area.
4. The lead could confirm the corridor 300 for swing from the camera code (GUESS in section 2).
