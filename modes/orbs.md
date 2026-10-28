# Orbs (jump rings) and pad bump modifiers

Implemented in `modes/orbs.js` (registers the orb handler and `E.setPadMod`). `gdobjects.js` was not changed: the ORB table already has yellow 36, pink 141, red 1333, blue 84, green 1022, black 1330, and the PAD table already has 35/140/1332/67.
Decompile: `gd-ida-decomp.cpp` (GD 2.206).

## 1. Orb velocities (`PlayerObject::ringJump` 159830, velocity block 160100-160390)

Notation: J = `ctx.P.jump` (1568, speed table). M = 0.8 if mini else 1 (v22, mini scale at +2016 = 0.6). fm = flipMod (-1 when flipped, 1967).

Non-black orbs: `vy = J * k * M * fm * post`, then mode-specific extras.

| Orb (type) | k by mode |
|---|---|
| yellow (11) | 1.0; robot 0.9 |
| pink (12) | ship 0.37, UFO 0.42, ball 0.77, others 0.72 |
| red (35) | ship 1.0 (mini 1.4), UFO 1.02 (mini 1.36), ball and spider 1.34, robot 1.28, cube/wave/swing 1.38 |
| blue (13) | 0.8; fm read before the flip, then gravity flips and `vy *= 0.5` (160310-160340, PlayerObject::flipGravity 151121 halves vy) |
| green (29) | ship 0.7, others 1.0; gravity flips first, so fm is the post-flip sign (160150-160240) |

Post multipliers (after setYVelocity, 160276-160351): ball x0.7, swing x0.6, spider x0.7 (these modes also clear the hold flag 1909).

Black (32, DropRing, separate branch 160353-160383, no mini factor, no flip):
- cube, ball, robot: `vy = -15 * fm`
- spider: `-15 * fm * 1.1`
- ship, wave, swing: `-14 * fm`
- UFO: `-14 * fm * 0.8`

Gate (`PlayerObject::pushButton` 160405 / `updateJumpVariables` 150814 / `playerTouchedRing` 463276):
- Non-flying modes (cube, ball, robot, spider): an orb fires on the frame it is touched while held. A press made before reaching it counts, as long as no earlier orb or cube jump consumed that press (1910 cleared in ringJump 160075-160353 and updateJump).
- Flying modes (ship 1961, UFO 1962, wave 1964, swing 1972; `isFlying` 144427): `playerTouchedRing` skips ringJump. An orb fires only on a fresh press made while overlapping (pushButton path). Held clicks do not fire it. Implemented in orbs.js by checking `ctx.pressed`.
- One orb per press in the core (buffer consumed). The game keeps separate slots for generic orbs, custom ring 36 and teleport 46. Not modelled (no such orbs yet).

## 2. Pad bump modifiers (`E.setPadMod`)

Velocity = `mod * 16 * fm`. Source: `GJBaseGameLayer::getBumpMod` 421316 (float bit patterns decoded), `PlayerObject::propellPlayer` 147666 (x0.8 when mini, x0.6 for ball/spider/swing).
- yellow: 1.0
- pink: ship 0.35, UFO 0.40, ball and spider 0.70, cube/robot/wave/swing 0.65
- red: ship 0.63 (mini 0.95), UFO 0.60 (mini 0.98), others 1.25
- mini (any pad): x0.8. Ball, spider, swing: x0.6. The red-ship mini value therefore comes out at 0.76 (0.95 x 0.8), as the code does.
- blue (67): core. See engine requests.

## 3. Tests

Unit check (`/tmp/.../scratchpad/orbtest/unit.js`): all 6 orb colours x 8 modes x mini x flip (192 cases) plus 19 pad cases, fired directly through `E.stepSub`. 0 failures. Held-click rule checked: flying modes do not fire, non-flying modes fire.

Bot courses (mklevel):
- Yellow wall (3 blocks, orb at 560,90): `LEVEL CLEARED in 170 frames`. Control without the orb: `NO SURVIVORS at frame 106 x~565` (wall).
- Blue ceiling (blue orb at 200,60, ceiling blocks at y=150 from x=340 over floor spikes): `LEVEL CLEARED in 224 frames`. Control without orb: `NO SURVIVORS at frame 80 x~430` (spikes).
- Mini cube, ship and the other modes with real orbs were not bot-tested. Covered by the unit check only.

Built-in levels:
- Level 3 (Polargeist): `LEVEL CLEARED in 5378 frames (89.6s)`. Baseline without orbs.js: `NO SURVIVORS at frame 286 x~1500` (hazard).
- Level 4: `LEVEL CLEARED in 4851 frames (80.8s)`. No baseline run.
- Level 5: `LEVEL CLEARED in 4997 frames (83.3s)`. No baseline run.
- Regression level 1: `LEVEL CLEARED in 5135 frames (85.6s)`.
- Level 2 not run.
- The machine has 2 CPUs and other agents were running bots, so each run took 10-12 minutes wall time.

## 4. Answer: can a click held from before reach an orb?

Yes in non-flying modes (cube, ball, robot, spider): `updateJumpVariables` copies the press and hold flags every frame, and the press flag stays set until an orb or the cube jump consumes it or the button is released. A held click therefore activates the first orb touched, and the press is then used up. The engine's buffer rule matches this for those modes.

No in flying modes (ship, UFO, wave, swing): `playerTouchedRing` does not call ringJump while flying, so only a press made while overlapping fires. The engine's buffer rule does not match here. orbs.js handles it in the handler, so no core change is needed for this case.

## 5. Engine requests

1. Orb beats ground jump on the same press. In the game, pushButton fires overlapping rings before `updateJump` runs, so a press on the ground while overlapping an orb fires the orb instead of jumping. In the core, cube `update` runs first and consumes the buffer. Suggest checking unused overlapping orbs before the mode `update` when `ctx.pressed`, or skipping the ground jump in that case. Not tested in the bot.
2. Pads must not consume the press. `propellPlayer`, `bumpPlayer` and `gravBumpPlayer` never write 1910 (checked). The core currently sets `s.buffer = false` on every pad touch.
3. Blue pad velocity. Game: `propellPlayer(0.8)` then flip. Final `vy = 16 * 0.8 * fm_pre * M * (0.6 if ball/spider/swing) * 0.5`. Core currently only does `vy *= 0.5`. `gravBumpPlayer` also flips only when the player's gravity differs from the pad's facing; the core flips unconditionally.
4. Ball, swing and spider rings clear the hold flag (1909). Not modelled, since `s.hold` comes from input each substep.
5. (Minor) setYVelocity quantises velocity to 1/1000. Ignored.

## 6. GUESS / unconfirmed

- Spider ring x0.7: derived from control flow of the shared post-velocity block (160348-160351), not from a direct read. Medium confidence.
- Flags 1601 (halving on flip) and 1635 (activated ring bypass) assumed 0.
- Yellow orb as the fall-through case (type 11 is not an explicit branch).
- Red ship mini double-compensation (0.95 bump x 0.8 propell): taken as written in the code.
- Dash orbs 1704/1751, spider orb 3004, custom ring 1594, teleport orb 3027 are not implemented.
