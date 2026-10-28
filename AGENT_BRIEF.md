# Brief for game-mode agents (WebDash engine v3)

You are porting ONE Geometry Dash 2.2 game mode (or the orbs) into WebDash, a faithful HTML5 port.
The goal is to match the real game's physics using the decompiled source, not to invent new behaviour.

## Hard rules

- **Only create or edit the files assigned to you.** That's normally `modes/<yourmode>.js` plus a short report `modes/<yourmode>.md`. Other agents are working in parallel on other modes.
- **Do NOT edit** `engine.js`, `game.js`, `index.html`, `gdobjects.js` (the orb agent may edit only the `ORB` table there), or anyone else's files.
  - If you need an engine change, write it under "Engine requests" in your report. The lead will integrate it.
- **The decompile is 42 MB:** `/tmp/claude-0/-home-claude/b7822a02-4c6f-56a7-b43a-479d8c236dec/scratchpad/gd206/GD-2.206-Decompiled-main/asm/gd-ida-decomp.cpp`.
  - Never `cat` it. Use `grep -n` and `sed -n 'A,Bp'` on small ranges.
  - Inside a function, `*((float *)this + N)` is a member field at byte offset 4·N.
- **Run Python with `-I`** if you read game files with it.
- **Finish in a reasonable time.** Aim for a working, tested implementation and an honest report. Mark anything not confirmed from the code as a GUESS.

## Project layout

- **Project root:** `/home/claude/webdash/`
- `engine.js`: core physics.
  - Read it first, especially `registerMode`, `makeCtx`, `substep`, and the built-in `CUBE` / `SHIP` modes at the bottom. Those two are your templates.
- `modes/`: your plug-in goes here. It must work in Node and in the browser:

```js
(function (E) {
  'use strict';
  var MODE = E.BALL;                       // E.BALL=2, E.UFO=3, E.WAVE=4, E.ROBOT=5, E.SPIDER=6, E.SWING=7
  E.registerMode(MODE, {
    name: 'ball', corridor: 240, grounded: true, hazardHalf: 13.5,
    update: function (s, ctx) { /* set s.vy */ },
    afterMove: function (s, ctx) {},          // optional
    onEnter: function (s, ctx, prevMode) {},  // optional
    wall: function (s, ctx, b, info) {},      // optional: return 'die' | 'snap' | 'ignore' | undefined (default rules)
    rotation: function (s, ctx) { /* s.rot in degrees, cosmetic */ }
  });
  if (typeof window !== 'undefined' && window.GDRender) window.GDRender.register(MODE, function (api, S) {
    // api.icon(baseFrameName, x, y, {rot, scale, fy, extra}) draws the P1+P2 layers of an icon (handles mini scale)
    // api.sprite(frameName, x, y, {rot, scale, tint, alpha, fx, fy}) draws any frame
    api.icon('player_ball_01', S.x, S.y, { rot: S.rot });
  });
})(typeof module !== 'undefined' && module.exports ? require('../engine.js') : window.GDEngine);
```

### Player state `s` (useful fields)

| Field | Meaning |
|---|---|
| `x`, `y` | Centre position, in GD units (1 block = 30). The floor top is `s.gy`; the ceiling is `s.ceil` (`E.NO_CEIL` when there is no corridor). |
| `vy` | Vertical velocity. **Positive is up.** `y += vy * ctx.dtv` each substep. |
| `flip` | Gravity is upside down (`ctx.fm` is +1 normally, −1 when flipped). |
| `ground` | Standing on a surface, but only maintained if your mode has `grounded: true`. `s.onSurface` is set for every mode. |
| `hitCeiling` | True when the player bumped a surface on the "head" side this substep. |
| `hold` | Button is down. `ctx.pressed` is true on the substep where the press happened; `ctx.released` likewise. |
| `buffer` | A press that hasn't been used yet. Set `s.buffer = false` when your mode consumes it, e.g. a ball gravity switch. Orbs also consume it. |
| `mini` | Mini size (`ctx.mini`). The hitbox is already scaled by the core (`ctx.half`). If your mode has different mini physics, use it. |
| `speed`, `ctx.P` | The current speed's `{ tm, jump, grav, ps }`. |
| `rot` | Cosmetic rotation in degrees. |
| `k` | Optional string: put any extra mode state that matters for the future here (e.g. a robot boost timer as a rounded number), so the bot can tell states apart. Keep it short. |
| *(your own)* | You may add fields, e.g. `s.robotBoost`. Keep them numbers or booleans so `cloneState` copies them. |

### `ctx`

| Field | Meaning |
|---|---|
| `P` | Speed params |
| `fm` | Gravity sign |
| `dtv` | Vertical step factor (`0.25 * 0.9`) |
| `A` | Frame fraction per substep (0.25) |
| `V_DT` | 0.9 |
| `half` | Player half-size |
| `C` | Constants: `SHIP_G 0.9582`, `CUBE_FALL_MAX 15`, `SHIP_UP 8`, `SHIP_DOWN 6.4`, `MINI_SCALE 0.6` |
| `findSurface(dir)` | Centre-y to stand on the nearest surface above (+1) or below (−1), or `null`. Useful for the spider. |
| `padMod(kind)` | Current pad bump modifier |

### Physics loop (one substep = 1/240 s)

1. Your `update`.
2. Vertical move.
3. Landing / ceiling resolution against blocks and against the corridor floor and ceiling.
4. Horizontal move, with wall checks (6-unit ledge and ceiling forgiveness; your `wall()` can override).
5. Hazards, pads, orbs, portals.
6. Your `afterMove`.
7. Your `rotation`.

## How the existing modes were derived

The cube and ship use the speed table (jump, grav, ps, tm) and constants from `PlayerObject::updateJump`, the substep factor 0.9, and `vy *= 0.5` on gravity flips. Velocity units are "per frame at 60 fps"; position integrates `vy * 0.9 * 0.25` per substep. Keep the same convention.

### Decompile functions for each mode (line numbers in `gd-ida-decomp.cpp`)

| Function | Line |
|---|---:|
| `PlayerObject::updateJump` (all modes branch here) | 155299 |
| `PlayerObject::update` | 160837 |
| `PlayerObject::updateInternalActions` | 153394 |
| `PlayerObject::pushButton` | 160405 |
| `PlayerObject::releaseButton` | 159494 |
| `PlayerObject::ringJump` (orbs) | 159830 |
| `PlayerObject::bumpPlayer` (pads) | 157048 |
| `GJBaseGameLayer::bumpPlayer` | 463168 |
| `GJBaseGameLayer::playerTouchedRing` | 463276 |
| `PlayerObject::spiderTestJump` | 155248 |
| `PlayerObject::propellPlayer` | 147666 |
| `PlayerObject::hitGround` | 149979 |
| `PlayerObject::toggleRollMode` (ball) | 153113 |
| `PlayerObject::toggleBirdMode` (UFO) | 152905 |
| `PlayerObject::toggleDartMode` (wave) | 153003 |
| `PlayerObject::toggleRobotMode` | 153191 |
| `PlayerObject::toggleSpiderMode` | 152689 |
| `PlayerObject::toggleSwingMode` | 152569 |
| `PlayerObject::toggleFlyMode` (ship) | 152796 |
| `PlayerObject::updateRotation` | 144749 / 144846 |
| `PlayerObject::flipGravity` | ~151121 |
| `PlayerObject::updatePlayerRobotFrame` | 146304 |
| `PlayerObject::updatePlayerSpiderFrame` | 146331 |
| `PlayerObject::updatePlayerSwingFrame` | 146587 |
| `PlayerObject::updateSwingFire` | 151075 |
| `PlayerObject::playSpiderDashEffect` | 145700 |
| `PlayerObject::updateRobotAnimationSpeed` | 150248 |
| `GJBaseGameLayer::switchToFlyMode` (5 ship, 19 UFO, 41 swing, default wave) | 420198 |
| `switchToRobotMode` / `switchToSpiderMode` / `switchToRollMode` | 420262 / 420291 / 420320 |
| `GJBaseGameLayer::getTargetFlyCameraY` / `processCameraObject` | after 420320 (grep) |
| `GJBaseGameLayer::playerWillSwitchMode` | 462507 |

Search tips:
- `grep -n "PlayerObject::updateJump" FILE`, then read about 300 lines at a time with `sed -n`.
- Mode flags live in `PlayerObject` bytes. For example, the ship's `isFlying` reads a flag; find the bytes each `toggleXMode` sets, then find where `updateJump` tests them.

Believed corridor heights, to verify where you can (`getTargetFlyCameraY` / `processCameraObject`):

| Mode | Corridor |
|---|---|
| Ship, UFO, wave, swing | 300 (10 blocks) |
| Ball, spider | 240 (8 blocks) |
| Cube, robot | None |

## Icons (already loaded in the browser)

| Mode | Frames |
|---|---|
| Ball | `player_ball_01_001.png`, `_2_001` |
| UFO | `bird_01_001.png`, `_2_001`, `_3_001` (dome). The UFO also shows a small cube (`player_01`) sitting in the dome. |
| Wave | `dart_01_001.png`, `_2_001` |
| Swing | `swing_01_001.png`, `_2_001`, `_extra_001` |
| Robot | `robot_01_01..04_001.png` (+ `_2_`): body/head, leg parts. Pose data: `/home/claude/gdtools/Robot_AnimDesc.plist` (big; optional). A simple static pose is acceptable. |
| Spider | `spider_01_01..04_001.png` (+ `_2_`, `_extra`). `/home/claude/gdtools/Spider_AnimDesc.plist`. |

Frame metadata is in `icons.js` (`sw`/`sh` = size in hd px; 2 px = 1 unit).

## Testing (required)

**Bot:** `node /home/claude/webdash/tools/bot.js <level> [cap] [maxFrames]`

- `<level>` is a built-in level number (1–22) or a path to a level-string file.
- It loads every `modes/*.js` automatically.
- It prints `LEVEL CLEARED` or `NO SURVIVORS at …` with the death reason. It proves a level can be completed under the engine.
- Built-in levels 1 and 2 must keep clearing (cube/ship). Don't break them. Each takes about 2–3 minutes; run at least one as a regression check at the end.

**Test levels:** `node /home/claude/webdash/tools/mklevel.js OUT.txt <startMode> <startSpeed> < objects.txt`

- Each line of `objects.txt` is `id x y [rot] [flipY]`.
- Useful IDs:

| Category | IDs |
|---|---|
| Block | 1 |
| Spike | 8 (on the floor: `8 X 15`) |
| Small spike | 39 |
| Mode portals | 12 cube, 13 ship, 47 ball, 111 UFO, 660 wave, 745 robot, 1331 spider, 1933 swing |
| Gravity portals | 11 flip, 10 normal |
| Size portals | 101 mini, 99 normal |
| Orbs | 36 yellow, 141 pink, 1333 red, 84 blue, 1022 green, 1330 black |
| Pads | 35 yellow, 140 pink, 1332 red, 67 blue |

- Portals are placed with their centre at the corridor centre you want, e.g. `47 600 135`.
- Build several small courses that only your mode's correct physics can clear. Make one need precise timing.

**Real levels using your mode:**

| Mode | First built-in level |
|---|---|
| Ball | 9 (Cycles) |
| UFO | 12 |
| Wave | 17 |
| Robot | 19 |
| Spider | 21 |
| Swing | 22 |

- Those levels also contain orbs and triggers that may not exist yet, so they may stop early for unrelated reasons.
- Still run one and report where it stops and why (the bot prints the cause).
- To jump straight to a section, make a test level from it: use `/home/claude/webdash/gdlevel.js` (`loadLevelStringSync`) in a small Node script to read a built-in level and keep only the objects between two x positions.

**Plug-in sanity check:**

```
node -e "const E=require('/home/claude/webdash/engine.js');require('/home/claude/webdash/modes/<f>.js');console.log(Object.keys(E.MODES))"
```

## Report (`modes/<yourmode>.md`)

Keep it under about 60 lines:

1. What you implemented and the exact constants, each with its decompile line numbers.
2. What is a GUESS.
3. Tests run and their results, including the bot output lines.
4. Engine requests: anything the core must change. Be specific.
