# BALL mode (E.BALL = 2, portal 47) - report

Files: `modes/ball.js` (plug-in) and this report. No engine, game or index changes.

## 1. Implemented (gd-ida-decomp.cpp line numbers)

Flip (click on a surface):
- Press sets hold 1909 (`pushButton` 160450); release clears it (`releaseButton` 159519).
- Landing arms buffer 1969 (`hitGround` 150166-150168). The engine's `s.onSurface` plays this role.
- Flip fires in `updateJump` when `1909 && 1969` (155762). A click in the air waits until landing, if still held. A release first cancels it. Each press flips once.
- Impulse `vy = P.jump * flipMod * v20` (155814). `v20` = 1.0 normal, 0.8 mini (155473, 155477).
- `flipGravity` (151121) toggles flip and halves vy (151158, unless 1601; 1601 is only set during copy, reset and checkpoint load).
- Ball branch then `vy *= 0.6` (155859). Net: `vy = 0.3 * P.jump * flipMod_old * v20` (normal 3.354).
- No gravity in the flip substep (`goto LABEL_92`, 155902).

Gravity (tail at 155990, clamp 155999 / 156008):
- `v15 = 0.9582` for ball (155464), `v18 = 0.6` for ball (155735), `v50 = v15 * dt` (155914).
- `vy -= 0.6 * 0.9582 * dt * flipMod`, `dt` = `updateJump(this, a2*0.9)` (161031). Per substep: `0.6 * 0.9582 * 0.225`.
- Terminal speed +-15, same clamp as cube. Gravity does not depend on speed (cube uses `P.grav`). Ball gravity is 60% of cube's at normal speed.
- Mini changes only the flip impulse (x0.8). Gravity is unchanged.

Corridor: `getGroundHeightForMode(16) = 240.0` (419627, bits 0x43700000). CONFIRMED. Ship is 300 in the same function.

Rotation (cosmetic, deg/s, applied as rate/240 per substep):
- Ground roll `runBallRotation` (143720): `120 * flipMod / (sizeMod * 0.2 * speedK)`. Normal 600, mini 750.
- Air spin after a flip `runBallRotation2` (143785): `-340 * flipMod / (sizeMod * 0.8 * speedK)`. Normal -425. Stops on landing (`stopRotation`, 142347).
- `speedK` by timeMod: slow 1.2406, normal 1.0, fast 0.80424, faster 0.66577, fastest 0.54094.

Draw: `api.icon('player_ball_01', S.x, S.y, {rot: S.rot})`. `s.k` = held (`h`/`-`) + on surface (`s`/`-`) for the bot.

## 2. GUESS / not confirmed
- Hazard box 13.5 half-size (same as cube). Ball hitbox not decoded.
- Reverse flag (1970) and flag 2137 assumed off. Field 589 (gravity multiplier) assumed 1.0.
- Not modelled: slopes (1952/1953), `didHitHead` (no callers found), robot/spider/dash.
- `hitGround`'s `v9 <= 5` landing check treated as always true (landing speed is always toward the surface).
- `playerIsFallingBugged` clearing of 1969 replaced by "onSurface on the previous substep" (same effect here).
- Mode's `afterMove` clears `onSurface` after a mode-owned flip, so a stale ground hit cannot re-arm it.

## 3. Tests

Unit checks (direct stepping):
- Held through landing: flips once, on the first substep after landing. No re-flip.
- Released before landing: no flip. Click while standing: flips at once (vy 0 to 3.742 after one frame).
- Airborne click after a flip: no effect.
- Mini impulse: vy after one frame 3.071 vs 3.742 normal (0.8 on the impulse, gravity added on the other substeps).
- One click from floor reaches the ceiling (y 225) in 25 frames, about 135 units at normal speed.

Bot:
- `mklevel` alternating spikes, floor/ceiling every 150 units: `LEVEL CLEARED in 343 frames (5.7s)`.
- Spikes 60 apart (small hazard boxes, passable): `LEVEL CLEARED in 158 frames`.
- Full-height block wall (negative): `NO SURVIVORS at frame 49 x~ 269 y 15 mode 2 why(release) {"k":"wall","b":[285,0,315,30]}`. Expected.
- Built-in level 1 (regression): `LEVEL CLEARED in 5135 frames (85.6s)`.
- Built-in level 2 (regression): `LEVEL CLEARED in 4870 frames (81.2s)`.
- Built-in level 9 (full): `NO SURVIVORS at frame 195 x~ 1028 y 31 mode 0`. Level starts in cube mode. Death is a hazard at x 1030, past yellow orb 36 at x 1005. Orbs have no handler, so this is not a ball problem.
- Level 9 ball section (x 9100-10800 cut and shifted, so the level starts in ball): `NO SURVIVORS at frame 171 x~ 903 y 225 mode 2`, death on block [920,210,950,240] (original x about 9703). Same with a 1/1000 state key and beam cap 20000, so it is not a beam artefact.
- Calibration (scratch copy only): flip impulse x2 or x3.3, cube-strength gravity, and both. All stop at the same block. The section needs a drop of about 90 units in about 6 frames, which the modelled ball cannot do. Unresolved.

## 4. Engine requests
1. `index.html` loads only engine.js and render-registry.js, not `modes/*.js`. Add `<script src="modes/ball.js"></script>` before game.js.
2. Cube mini jump: line 155814 scales the impulse by `v20` (0.8 mini) for every non-flying mode, cube included. The engine's cube ignores mini. Suggest `vy = P.jump * fm * (s.mini ? 0.8 : 1)`.
3. Mode-owned flips inside `update` use the old `fm` for that substep's collisions. Either add a post-move flip hook or keep the `afterMove` workaround.
4. Orbs (ID 36 etc.) and mirror portals (3 in level 9) are unsupported. Level 9's cube section needs the orb handler.
5. `bot.js` writes `tools/sol_<name>.json` on every clear. My runs left `tools/sol_1.json` and `tools/sol_2.json`. My scratch test solutions were removed.

## 5. Open question
Level 9's ball section may show a real mismatch. If real play allows a ~90-unit drop in ~6 frames, the engine's ball is too slow vertically or its collision box is smaller than the 30x30 used for solids. Needs checking against real play or a decoded ball hitbox.
