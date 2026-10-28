# ROBOT mode (E.ROBOT = 5) - port report

Files: `modes/robot.js` (plug-in, mode 5, corridor 0, grounded true, hazardHalf 13.5).
Decompile: `gd-ida-decomp.cpp`, `PlayerObject::updateJump` 155299-156051, `toggleRobotMode` 153191, `pushButton` 160405, `releaseButton` 159494.

## 1. Implemented (constants and decompile lines)

- **Ground jump**: needs onGround (1969) and a buffered press (1909 && 1910; the robot-only gate is at 155461). Happens at 155762 and sets vy = 0.5 * P.jump * fm (v26 = field196 at 155785, halved for robot at 155787, v20 = 1.0). That substep applies no gravity. Jump start clears the boost accumulator (155779) and the release flag (155778).
- **Gravity factor**: v18 = 0.9 for robot (155739). In-jump gravity is `vy -= P.grav * dtv * 0.9 * fm` (addToYVelocity 62, line 155936). Airborne gravity after the jump state is the same factor (63, line 155990).
- **Hold boost**: while holding (1909), not released (1932 clear), and accumulator < 1.5 (155924): accumulator += dtv * 0.1 (155926), and vy += P.grav * dtv * 0.9 * fm (61, line 155929). The accumulator is stored in `s.robotBoost` (field 210, byte offset 1680). Max boost is 1.5 / (0.1 * dtv) = 66.7 substeps = 0.278 s.
- **Release**: releaseButton sets 1932 (line 159517). The release flag blocks further boost until the next jump start. Re-pressing in the air does not re-arm the boost (verified).
- **Jump state end**: `s.robotJump` (2060) clears when playerIsFallingBugged (144334) is true, i.e. vy < 2*grav when not flipped. The in-jump path has no terminal clamp.
- **Terminal velocity**: non-jump path clamps vy to -15 (or +15 when flipped), lines 155999-156010. Verified by a fall test.
- **Rotation**: none. toggleRobotMode calls stopRotation (153226). `s.rot` stays 0. Flip is shown by mirroring the draw (fy).
- **toggleRobotMode** sets field 210 = 1.5 on enter (153225). Implemented in onEnter.
- **Fields**: `s.robotJump` (bool), `s.robotCut` (bool), `s.robotBoost` (number), `s.k` (string: `j<round(boost*100)>h|c` while jumping, `g` otherwise). All are copied by cloneState.
- **Mini**: no robot-specific mini physics in updateJump. Mini only changes size (core).
- **Draw**: static pose from robot_01_04 (feet), robot_01_03 (shins), robot_01_02 (thighs, rot frame) and robot_01_01 (body, drawn last). Offsets are approximate. Flipped by `fy`.

Measured (flat floor, normal speed, hold length in substeps, peak above standing centre):
tap (1 substep) 18.8 units (0.62 blocks); 16 substeps 37.6; 32 substeps 57.7; 48 substeps 77.9; 67+ substeps 101.8 (3.39 blocks, the cap).

## 2. GUESS / not confirmed from code

- hazardHalf 13.5 (copied from the cube). Robot hitbox not checked. Changing it to 9 did not change the level 19 blocker (see 3).
- v20 = 1.0 assumed (field504 == 1.0 in normal play, line 155440s).
- a2 mapping: updateJump is called with dt * 0.9 (line 161031). Equated to the engine's per-substep dtv = A * 0.9. This sets the boost length (66.7 substeps). If the game's dt is per frame, the boost would be 4x longer per frame.
- Field196 is taken as SPEEDS.jump, as the cube does.
- Pose offsets and the fy mirroring were not checked in a browser (no render run).
- The robot's gameplay-level rules outside updateJump (ground checks, ceiling) were left to the core.

## 3. Tests

Plug-in check: `Object.keys(E.MODES)` = `[ '0', '1', '5' ]`, name `robot`.

Hold-window scan (flat floor, press swept over all x positions, wall = N solid blocks at x=600):
- 1 block high: holds of 6 substeps or more clear it (min 6, max 110).
- 2 blocks high: min 30 substeps.
- 3 blocks high: min 53 substeps.

Bot runs (`node tools/bot.js`):
- Course with one block: `LEVEL CLEARED in 170 frames (2.8s)`.
- Course with 2 blocks: `LEVEL CLEARED in 170 frames (2.8s)`. Bot solution holds 32 substeps (8 frames) before the wall.
- Course with 3 blocks: `LEVEL CLEARED in 170 frames (2.8s)`.
- Floor spike at x=600: `LEVEL CLEARED in 170 frames`.
- Ceiling spike (flipY) with a block, at y 55, 58, 61, 63, 65, 80: all `LEVEL CLEARED`. These spikes were not a real ceiling, so the robot just flew over them. Solid "tunnel" lids were also cleared by standing on the lid. Those courses do not test timing.
- Built-in level 19, whole level: `NO SURVIVORS at frame 138 x~ 732 y 168 mode 0 ... wall [750,150,780,180]`. It stops in the cube section, before the first robot portal (x=1923). Not a robot issue.
- Level 19 robot section (x 1800-4900, shifted to start at x=100): `NO SURVIVORS at frame 82 x~ 441 y 51 mode 5 why wall [460,36,490,66]`. The robot lands on the block top at (430-460, top 36), is at height 51 at x=441, and cannot reach the ~75 needed for the wall. Same result with CAP 20000 (search per frame stays under 200 states). A substep-resolution search (finer dedupe key) dies at the same place (x 444.7, y 51).
- Sensitivity, scratch copy only (not in the project): if holding gave a net upward push instead of cancelling gravity (boost without the gravity term), the same section is passed to shifted x ~1438 (original ~3138), where a spike at y 4-9 kills. So the exact boost/gravity cancellation (61 and 62 in the decompile) is the most likely cause of the failure, and it is the main thing to verify.
- Level 1 regression: `LEVEL CLEARED in 5135 frames (85.6s), search 490.1s`.

## 4. Engine requests

None. Notes for the lead:
- Robot press is buffered via `s.buffer` (set on press edge, cleared on release or jump), which matches 1910.
- The bot's input is per 4-substep frame. A substep-level search gave the same result for level 19, so the granularity is not the cause.
- Test files, scratch courses and the sensitivity copy are in the scratchpad only. I deleted the `tools/sol_*` files my runs created. Other agents' `sol_*` files were not touched.
