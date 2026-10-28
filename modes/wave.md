# Wave (dart) mode - report

Files: `modes/wave.js` (plug-in), this file. Engine, game, index and other modes are untouched.

## 1. What is implemented (decompile lines in `gd-ida-decomp.cpp`)

| Item | Value | Evidence |
|---|---|---|
| Speed | x step per frame = `tm * ps` (engine `P.tm * P.ps`) | `getCurrentXVelocity` line 142063-142070: `*(float)(this+2020) * *(double)(this+1560)`. Index 2020 is tm, index 1560 is ps (table at 150567-150900). |
| Vertical motion | `dy = fabs(x-step) * flipMod * (hold ? +1 : -1)`, per frame. No gravity. | `PlayerObject::update` 161044-161070. `v34 = fabs(v32) * flipMod`, then `v35 = ±v34` on `1909` (hold). |
| Mini | `dy` doubled. Mini scale is `this+2016 = 0.6`. | 161075: `if (2016 != 1.0) v35 = v35 + v35`. 0.6 written at 153659. |
| Slope | normal 1.0 (45 deg), mini 2.0 (63.43 deg) | Follows from the two rows above. |
| Engine conversion | `vy = dir * tm * ps * (mini ? 2 : 1) / V_DT`, so that `vy * V_DT` gives `dy` per frame | Engine integrates `y += vy * 0.9` per frame. |
| updateJump velocity | The wave arm sets `vy = ±tm*ps` (155642-155649), but this is overwritten. The wave is not clamped (the `!1858 && !1964` clamp at 155560 is skipped for dart). | The displacement path ignores it for `1964 && !2004` (161045). |
| Corridor | 300 | `GJBaseGameLayer::getGroundHeightForMode(26)` returns `1133903872` = 300.0 (line 419619 onward). |
| Solid box half | 5 (content size 10, cube is 30 -> 15) | `toggleDartMode` 153042-153043 sets content size 648/652 = 10.0 (`1092616192`). Normal modes set 30.0 (148112-148113). `GameObject::getObjectRect` 170812 uses those fields. |
| Hazard half | 4.5 | Same 0.9 factor as the cube (13.5 = 15 * 0.9). GUESS, see below. |
| Wall rule | Any horizontal overlap with a block kills (`wall` returns `'die'`). | `canStickToGround` (144407) returns false for dart, so no ledge stick. |
| Rotation | Points along motion: target = -dir * atan(slope). Lerp 0.25 per frame (0.4 mini), applied per substep. | `updateShipRotation` 144607; lerp factor `v13 = 0.25` at 144691, 0.4 for 504 != 1.0. |
| Draw | `api.icon('dart_01', ...)` draws `dart_01_2_001` and `dart_01_001`, both present in `icons.js`. | `game.js` 297-302. |

Mode definition: `corridor: 300, grounded: false, hazardHalf: 4.5, solidHalf: 5` (solidHalf needs the engine change in section 4).

## 2. GUESS list (not confirmed from the code)

- Hazard half 4.5. The cube's 13.5 is 0.9 times 15, so the same factor is assumed for the wave. The hazard box size was not read from a function.
- The wall rule is inferred (no ledge forgiveness, because `canStickToGround` is false). I did not read the block collision function that decides the death. The test results depend on this.
- The rotation lerp is run per substep. GD runs it per frame.
- Solid half 5 assumes the same content-size scale (sx = 1) that the cube's solid half 15 implies.

## 3. Tests

Deterministic sim (scratchpad `wave/sim.js`), start in wave mode at (15, 150):
- Released: dx 25.97, dy -25.97 over 5 frames (slope 1.00), rot +45.
- Held: slope +1.00, rot -45, reaches the ceiling at y 285 (core H = 15).
- Mini: slope 2.00, rot -63.4.

Built-in level 17 (full): `NO SURVIVORS at frame 246 x~ 1292 y 31 mode 0`. The wave is never reached. The cause is unrelated to the wave: the spike gap at x 1215-1305 needs a yellow orb (ID 36, x 1215, y 165). Orbs are not implemented yet (`unsupported.orb = 31`), so the bot cannot use them.

Level 17 wave section (x 4437 to 8865, 387 objects including flipX, started in wave mode, built with a local builder because `mklevel.js` has no flipX): `LEVEL CLEARED in 913 frames (15.2s), search 19.1s`. The section has no orbs or pads.

Tunnel tests (120 units, 30-unit gap, spikes in closed columns from floor to floor-line and from ceiling-line to ceiling; the wave must hold or release continuously):
- Rising, correct physics: `LEVEL CLEARED in 79 frames (1.3s)`.
- Falling, correct physics: `LEVEL CLEARED in 79 frames (1.3s)`.
- Negative control with the vertical step scaled by 0.85 (copy in scratchpad, not the real file): `NO SURVIVORS at frame 10` (rising) and `frame 5` (falling). The slope is therefore pinned to within a few percent.

Note: an earlier tunnel built from floating spike lines was invalid (the wave could pass under it). That test was discarded.

Regression, built-in level 2: see section 5.

## 4. Engine requests

1. **Solid box per mode.** Add `def.solidHalf`. In `substep`, use `H = def.solidHalf ? def.solidHalf * (s.mini ? MINI_SCALE : 1) : ctx.half` for block, floor and ceiling resolution (the vertical and horizontal solid loops and the `s.y +- H` floor/ceiling checks). Without it the wave uses the cube's 15, which is three times too big. The tests above ran with 15, so they are a conservative check on the solid part only.
2. **tools/mklevel.js** should write key 4 for `flipX` (`,4,1`). `gdlevel` objects carry flipX, and 112 of the 387 wave-section objects use it. I used a local copy in scratchpad.
3. No change needed for the hazard box, the corridor, the wall hook or rotation.

## 5. Regression

Built-in level 2 (cube/ship, no wave objects): NOT FINISHED at handback. Run is still going in the background (log: `/tmp/claude-0/-home-claude/b7822a02-4c6f-56a7-b43a-479d8c236dec/scratchpad/wave/reg2.log`). Last line: `frame 2000 x 10406 states 112`, endX 25305. The machine is shared with other agents' bots, so it runs slowly. The result is unknown, and the level 2 regression is not confirmed.
