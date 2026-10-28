# SPIDER mode (E.SPIDER = 6, portal 1331)

## 1. Implemented (line numbers in gd-ida-decomp.cpp). Plug-in: modes/spider.js. Constants: terminal 15 (GUESS), hazard half 13.5, corridor 0.

- Mode flag: byte `+1966`, set in `toggleSpiderMode` (152689, flag write at 152715). `isInBasicMode` is true for spider (145589), so it is not a flying mode.
- Click trigger: `updateJump` (155299). When grounded (`+1909`, read at 155455) and a press is buffered (`+1969`, 155762), a spider calls `spiderTestJump(this,0)` (155766) instead of a jump. Ported as `s.ground && s.buffer`.
- Target search: `spiderTestJumpInternal` (154650). Direction is opposite to the current gravity: normal (flip 0) searches above, flipped searches below. The nearest surface wins. The engine's `ctx.findSurface(dir)` covers solids and the floor/corridor. Spikes are also candidates, as in the decompile's `damagingObjectsInRect` path. Ported in the mode, not the engine.
- Fallback when nothing is found (154761-154772, 155150-155165): target = `y + 3000 - hs` going up, `max(floor, y - 3000) + hs` going down. The floor clamp is 90 in the decompile; the engine uses its own floor (0).
- Teleport result (155210-155212): `flipGravity(!flip)`, then `setYVelocity(-flipMod(), 36)`. So vy = +1 when the new gravity is flipped, -1 when normal. The teleport substep skips gravity. Only y changes; x does not.
- Gravity: `v15 = 0.9582` (SHIP_G) for `isSpider`, not the per-speed `P.grav` (155463-155464). Applied only while airborne.
- Mini: the core supplies the half-size (`ctx.half` = 9 when mini). The decompile's teleport margin is `scale*8` (scale at +504, line 154751), which I did not port separately.
- Rotation: 0 upright, 180 when flipped.
- Draw: the idle pose from `Spider_AnimDesc.plist` (`Spider_idle_001.png`, sprite_0..5, world-unit positions and rotations). Body is `spider_01_01` (icon with P1/P2 and `_extra`), legs are `spider_01_02/03/04`. Flipped gravity negates the offsets.


## 2. GUESS / not confirmed

- Terminal velocity 15 is the cube's value. I did not find the spider's value in the decompile.
- Corridor 0 (no physical ceiling). The brief said 240. The decompile says:
  - `getGroundHeightForMode(33)` = 270 for spider (419619, table at 419620-419650). It is used for camera framing (`getGroundHeight`, 420555).
  - Ball (16) = 240, so the brief's "240" is likely ball's value, not spider's.
  - The teleport search for basic modes uses y±3000, not a corridor (154753-154772). So the spider has no physical ceiling. Setting 270 would wrongly block it.
- Mid-air presses stay buffered until the next grounded frame or release. The decompile's buffer handling is only partly followed.
- Early returns in `spiderTestJumpInternal` (flags +1968, +2074, +1601) and the `+2004` gate are not ported (unknown meaning).
- `+1971` ("sideways") is not ported. Its branch is for rotated gravity, not normal play.
- Dash effect `playSpiderDashEffect` (145700) is cosmetic and not ported.
- Hazard-as-target: included from the decompile's structure, not tested against a spike that is nearer than a solid.

## 3. Tests

Test courses were built with `tools/mklevel.js` and checked with a replay script. The replay logged each flip and y jump.

| Course | Result |
|---|---|
| t2: continuous ceiling (y=105), floor spikes at 300/460/620/780, ceiling spikes at 380/540/700 | `LEVEL CLEARED in 229 frames (3.8s)`. Replay: 7 teleports at x=285, 368, 446, 524, 607, 685, 768. Each lands at y=75 (ceiling) or y=15 (floor), as expected. |
| t3m: as t2, with a mini portal (101) at start | `LEVEL CLEARED in 229 frames`. Teleports land at y=81 and y=9 (9 = mini half). |
| t4: cube start, spider portal (1331) at x=60, then t2 | `LEVEL CLEARED in 229 frames`. Mode change via portal confirmed. |
| t5: floor spike at 300, no ceiling | `LEVEL CLEARED in 170 frames`, but invalid: teleport to y=3001 (fallback), then unbounded flight. |
| t1: ceiling only from x=215 to 395, then spikes | Cleared with one teleport, then the same unbounded flight. Not a valid clear. |

Built-in level 21:
```
NO SURVIVORS at frame 205 x~ 1080 y 39 mode 0 why(release) {"k":"hazard","b":[1092,9,1098,21]} why(hold) {"k":"hazard","b":[1092,9,1098,21]}
```
The stop is in the cube section, before the first spider portal (1331 at x=10695). A wider beam (cap 30000) gives the same result. The spike row at x=1065-1155 needs a cube jump and the bot cannot find one. Level 21 has 24 orbs, which are unsupported in this build.

Level 21 cut from x=10650 to 13540, started in spider mode:
```
LEVEL CLEARED in 613 frames (10.2s)
```
This is not a valid spider test. It has 0 solids and 0 presses, so the spider walked the floor without meeting an obstacle.

Regression, built-in level 1:
```
LEVEL CLEARED in 5135 frames (85.6s), search 442.2s
```

## 4. Engine requests

1. **Vertical bound.** A flipped spider with no surface above drifts up without limit, and the bot "clears" levels that way (t1, t5). The decompile does not show a kill or clamp in the search. Please decide what the engine should do: a top/bottom kill, or a clamp at the level limit. This also affects cube/ball when flipped in open space.
2. **Corridor for spider.** Keep spider at corridor 0. Do not use the brief's 240, and not the decompile's 270 camera value, as a physical ceiling.
3. Orbs are unsupported (level 21 has 24). This blocks the bot on several sections, including level 21 later on.
4. Possible classifier issue (not verified): the level 21 cut shows many decorative object IDs (1011, 1623, 1655, 1656) counted as hazards. Worth checking `objtypes.js`.
