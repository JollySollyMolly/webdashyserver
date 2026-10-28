# UFO (bird) mode: report

Files: `modes/ufo.js` (plug-in, `E.UFO` = 3). Decompile: `asm/gd-ida-decomp.cpp`.
Flag byte 1962 = bird. Set by `toggleBirdMode` (152905). It is part of the "flying" family (`isFlying`, 144427).

## 1. Implemented, with decompile lines

| Item | Value | Source |
|---|---|---|
| Mode switch | `vy *= 0.5` in `onEnter` | toggleBirdMode 152928 |
| Gravity (rising and falling, no hold factor) | `vy -= 0.9582 * dtv * flip` per substep | updateJump 155463-155464 (v15 = 0.9582 for flying); 155988-155990 (term 63, v18 = 1.0 for bird) |
| Velocity clamp | +-15, flipped uses the upper bound | updateJump 155994-156008 (setYVelocity ids 5/6) |
| Click impulse | `vy = P.jump * flip * v20` on `ctx.pressed` only (no repeat while held) | jump read 155785; setYVelocity id 2 at 155814 |
| v20 (mini, flying) | 0.85 when mini, else 1.0 | 155476-155480 |
| Rotation target | `-0.4 * atan2(-dy, dx)` (dy = vy*0.9 per frame, dx = ps*tm per frame) | updateShipRotation 144654-144657 |
| Rotation clamp | +-0.1 rad, only when not flipped | 144664-144671 |
| Rotation rate | 0.07 per frame, applied per substep as 0.07/4 | 144722-144731 |
| Corridor | 300 | GUESS (see below) |
| Hit box (`hazardHalf`) | 11 | GUESS (ship value) |
| Draw | `bird_01` icon, `_3_` dome (P2 tint), `player_01` cube at 0.5 scale in the dome | render layer |

Numbers as seen in the game sim: a tap from rest gives about 64 units of rise. Holding for 20 frames after a press gives vy 10.3 then -6.9 (no repeat).

## 2. What is a GUESS or not confirmed

1. **Click impulse trigger in mid-air (main gap).** In `updateJump` the only general jump is `setYVelocity(P.jump*flip*v20, 2)`, and it is gated by `v11 && 1969` (155762). Flag 1969 is set only by `hitGround` (150168) and cleared by `toggleBirdMode` (152933). The flying 7.0/8.0 "burst" click (155686-155703) is excluded for the bird by `if (!1962)` (155601). So the decompile I could read contains no bird-specific mid-air impulse. I used the cube's `P.jump` value, which is the only general impulse, and fired it on every new press. **Unverified.** Someone should check where the bird's air click is applied, possibly in a function IDA did not recover.
2. Corridor 300 is the brief's belief. I did not verify `getTargetFlyCameraY` or `processCameraObject`.
3. Hit box 11 is a guess. `didHitHead` (151842, 152212) has a bird-only head rectangle, which is not implemented.
4. **Tilt direction.** With the decompile's sign, the UFO tilts positive when rising. The ship tilts negative when rising. This follows the code, but it should be checked by eye in the browser.
5. Slerp2D step: I read `0.07 * a2` as a fraction per frame. The function may be a radian step.
6. Update term `addToYVelocity(v24 * v592 * v26, 69)` (161399, v26 = 0.58 for bird). The field at PlayerObject+2368 has no writer in the decompile, so I treated it as 0 and did not implement it.
7. Mini gravity and mini impulse scaling (0.85) follow the flying branch, but I did not test a mini UFO.
8. Orb multipliers for bird (`ringJump` 160172-160195: 0.42 / 1.02 / 0.37) belong to the orb agent. Not implemented here.

## 3. Tests run

- Plug-in check: `E.MODES` contains `[0, 1, 3]`, and mode 3 is named `ufo`.
- Physics trace (single tap from y=110, vy about -8.6): vy 10.32 after the press, apex about 174, rot range -2.75 to +2.01.
- Custom courses (generated from sinusoidal tunnels; blocks id 1; start mode 3; scripts in the scratch dir):
  - `test_F` (80 wide, amp 50, period 500): `LEVEL CLEARED in 340 frames (5.7s)`
  - `test_G` (60 wide, amp 40, period 600): `LEVEL CLEARED in 340 frames (5.7s)`
  - `test_H` (56 wide, amp 60, period 700, needs steady timed taps): `LEVEL CLEARED in 340 frames (5.7s)`
  - `test_C` (47 spikes on floor and ceiling): `LEVEL CLEARED in 511 frames (8.5s)`
  - `test_D` (60 wide, amp 80, period 500): `NO SURVIVORS at frame 138 x~ 732 y 185`. Same result with cap 12000, and with impulse x0.58, x1.0, x1.3.
  - `test_E` (50 wide, amp 70, period 350): `NO SURVIVORS at frame 63 x~ 342 y 129`.
  - Two earlier designs (separate 60/50 bands with no transition space) were unfair and were dropped.
- Built-in level 12: `LEVEL CLEARED in 4968 frames (82.8s), search 77.4s`. Unsupported in the level: `{"mirror":4}`, which was ignored. It did not stop early.
- Regression (level 1): the bot wrote `tools/sol_1.json` (5136 entries), but my log stopped at frame 2000 with no CLEARED line. Replaying that file through the engine gives `won true, 5135 frames, dead false`. Level 1 still clears with `modes/ufo.js` loaded. Level 1 is cube/ship, so the UFO code should not affect it.
- The bot also left `tools/sol_12.json` (replay: won, 4968 frames). The `sol_test_*` files I created were deleted.

## 4. Engine requests

- None required for this mode. `E.STEPS` is used for the rotation rate.
- Optional: expose the bird's head or floor hit rectangle (`didHitHead`) if the lead wants it, and a per-frame previous position for an exact tilt.

## Lead review (corrections applied to ufo.js)
Re-read the bird branch of updateJump (≈155600-155700 region, flag 1962 path at "v82 = 8.0; if (scale == 1.0) v82 = 7.0"):
- Click impulse is NOT P.jump: vy = max(vy, 7.0·flipMod·v20) (8.0 when mini; v20 = 0.85 mini). Applied with playBurstEffect.
- Gravity is NOT uniform: addToYVelocity(-(0.9582·dt·flipMod·k·0.5)/v20) with k = 1.2, or 0.8 when playerIsFallingBugged (falling).
- Clamp is the flying LABEL_237 clamp with v91 = 0.8: +8/v20 upward, −6.4/v20 downward (mirrored when flipped), not ±15.
- Corridor 300 confirmed: getGroundHeightForMode(19) = 300.
