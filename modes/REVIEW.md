# Game modes: lead review and integration notes

Seven agents wrote one plug-in each: `ball`, `ufo`, `wave`, `robot`, `spider`, `swing` and `orbs` (orbs and pads for every mode). Each agent's own report is in `modes/<name>.md`. This file records what the lead changed or verified while integrating them.

## Checked against the decompile

| Item | Finding |
|---|---|
| Corridor heights | `GJBaseGameLayer::getGroundHeightForMode` (line 419619) returns ship 300, UFO 300, wave 300, swing 300, ball **240**, spider **270**, default 270. Spider was changed from "no corridor" to 270: `getGroundHeight` / `updateDualGround` builds the floor and ceiling from this function. |
| UFO | **Rewritten.** The bird branch of `updateJump`: a click sets `vy = max(vy, 7.0·flip·v20)` (8.0 when mini, v20 = 0.85 mini). Gravity is `0.9582·dt·flip·(falling ? 0.8 : 1.2)·0.5 / v20`. Clamp is +8 up and −6.4 down (/v20). The agent had guessed the cube jump, uniform gravity and a ±15 clamp. |
| Swing | Verified: flip with `vy·0.8`, gravity 0.4 (0.6 mini) × 0.9582, clamp ±8 (same branch, v91 = v20 = 1). |
| Wave | Verified: the "dart" branch sets `vy` from horizontal speed (45°, steeper when mini). Solid box 10×10 (`toggleDartMode`); the engine now supports a per-mode `solidHalf`. |
| Robot | Verified the boost loop (`v51 < 1.5`, `+= a2·0.1`; boost and gravity cancel while held). Initial jump is `0.5·jump`; gravity factor is 0.9. |
| Ball | Flip impulse: `jump·flip·v20`, halved by `flipGravity`, then ×0.6. Gravity 0.6 × 0.9582. Matches the jump block at 155762–155860. |
| Blue pad | `gravBumpPlayer` (463221) only acts when the player's gravity is the one the pad flips. `propellPlayer(0.8)` gives `vy = 12.8·flip` (×0.8 mini, ×0.6 ball/spider/swing), then `flipGravity` halves it. |
| Pad hitboxes | Now the sprite size from the object map: 25×4 yellow, 25×5 pink, 29×6.5 red, 25×6 blue. The old 30×14 box made level 12 impossible. |
| Round hazards | Saws, blades and cogwheels collide as **circles**, using the radius from `customSetup`. Smaller variants have no radius in the code; they're scaled from their family's big saw (estimate). Previously they were full-sprite squares, which killed the player in level 17. |
| Mini | Cube jump ×0.8 and ship gravity/clamps ÷0.85 (v20 in `updateJump`). |

## Engine changes made on the agents' requests

- **Orbs before the mode update.** `pushButton` fires rings before `updateJump`, so an orb beats a ground jump on the same click.
- **Pads keep the click.** Pads no longer use up a buffered press.
- **Gravity sign re-read after `update()`.** Covers modes that flip gravity themselves (ball, swing, spider).
- **Per-mode `solidHalf`.** Used by the wave.
- **Out-of-level death.** The player dies above y = 3000 (e.g. a flipped cube in open air). This is a guess at the level's top bound.
- **New portals.** Teleport portals 747 / 2902 move the player by object key 54. Mirror portals 45 / 46 mirror the screen.
- **Level builder.** `tools/mklevel.js` also writes flipX.

## Still open

- **Dual mode** isn't implemented: it needs a second player.
- **Dash orbs, spider orb, toggle/custom orbs and the teleport orb** aren't implemented.
- **Triggers:** most later levels (19+) depend on Move / Toggle / Spawn triggers to build their platforms. The bot fails there for that reason, not because of game modes.
- **Hitboxes still guessed:** the robot / spider / UFO hazard boxes reuse the cube's or ship's.
