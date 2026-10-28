# Geometry Dash research compendium (WebDash)

Everything gathered while porting Geometry Dash 2.2 to HTML5. It covers the decompiled source, the Windows `GeometryDash.exe`, the game's data files, the official servers, the public community documentation, and the current state of the WebDash code.

Personal-use project: assets and levels come from a copy of the game you own on Steam. Nothing here is for redistribution.

Each fact is tagged with how sure it is:

| Tag | Meaning |
|---|---|
| **[game]** | Read directly out of the game's code, executable or data files. |
| **[docs]** | From the community GD docs (gddocs) or the Geode SDK bindings. Widely used, but not verified here. |
| **[tested]** | Checked by running the WebDash engine or tools. |
| **[guess]** | Our own approximation. It works, but the exact value hasn't been confirmed. |

---

## Contents

1. [Sources and what they contain](#1-sources-and-what-they-contain)
2. [The decompile: map of useful code](#2-the-decompile-map-of-useful-code)
3. [Coordinates, units and timing](#3-coordinates-units-and-timing)
4. [Player physics](#4-player-physics)
5. [Collision and hitboxes](#5-collision-and-hitboxes)
6. [Camera](#6-camera)
7. [Objects: types, classes, IDs](#7-objects-types-classes-ids)
8. [Triggers used by the built-in levels](#8-triggers-used-by-the-built-in-levels)
9. [Level data format](#9-level-data-format)
10. [Save files (local levels)](#10-save-files-local-levels)
11. [Official servers: protocol and endpoints](#11-official-servers-protocol-and-endpoints)
12. [Songs: official, Newgrounds, music library](#12-songs-official-newgrounds-music-library)
13. [Level searcher and song downloader (tools/gdserver.js)](#13-level-searcher-and-song-downloader-toolsgdserverjs)
14. [Assets and texture atlases](#14-assets-and-texture-atlases)
15. [WebDash: current state and file guide](#15-webdash-current-state-and-file-guide)
16. [Roadmap: what is missing, in order](#16-roadmap-what-is-missing-in-order)
17. [Reverse-engineering methods used](#17-reverse-engineering-methods-used)
18. [References](#18-references)

---

## 1. Sources and what they contain

| Source | What it gave us |
|---|---|
| `GD-2.206-Decompiled-main` (CallocGD) | See the breakdown below. |
| `GeometryDash.exe` (Steam, Windows x64, 2.2) | The object ID → sprite frame table (4,093 IDs), disassembled out of the `ObjectToolbox` constructor. It also gave the speed-mode table. |
| `Resources/` in the Steam folder | Texture atlases (`GJ_GameSheet*-hd.png` + `.plist`), backgrounds and grounds, all official songs (`.mp3`), and the built-in levels (`levels/1.txt`–`22.txt`, `3001`, `5001`–`5004`). |
| gddocs (community docs) | Server endpoints and parameters, level/song/user object keys, level-string object keys, start keys, hash salts. |
| Geode SDK bindings (`bindings/include/Geode/Enums.hpp`) | The official names of the `GameObjectType` and `Speed` enums. |
| Earlier `cocos-headers` repo | Only cocos2d-x 2.2 headers. They're useful for knowing the CC classes, but contain no game logic. |

What's inside the decompile:

| Part | Contents |
|---|---|
| `asm/gd-ida-decomp.cpp` | 42.9 MB of IDA pseudo-C for the Android ARMv7 build 2.206. This is the real code. |
| `src/`, `headers/` | Hand-rewritten classes. Most are stubs. `GameLevelManager.cpp` is fully written out, and `GameObject.cpp` keeps a partial Ghidra dump of `customSetup` in comments. |
| `rt-freebies/PlayerObject.cpp` | Code snippets RobTop has shown publicly, such as slope collision. |
| `asm/geometrydash.s`, `libcocos2dcpp-armeabi-v7a-symbols.json` | Raw disassembly and the symbol list. |

**Version note.** The decompile is the Android 2.206 build. The executable is the Steam build. The object table, speeds and constants matched between the two everywhere we compared them.

---

## 2. The decompile: map of useful code

All line numbers refer to `asm/gd-ida-decomp.cpp`. Object fields are written as `this + N`, meaning DWORD index N (byte offset 4·N).

| Function | Line | What it is |
|---|---:|---|
| `PlayerObject::updateJump` | ~155299 | Per-substep vertical velocity for every game mode. This is the core of the physics. |
| `PlayerObject::updateTimeMod` | ~150500 | Sets the time modifier and player speed for each speed portal (see §4). |
| `PlayerObject::flipGravity` | ~151121 | Gravity portals and orbs: flips gravity and halves velocity. |
| `PlayerObject::bumpPlayer` | ~157048 | Jump pads. `getBumpMod` is at ~463168. |
| `PlayerObject::ringJump` | ~159830 | Orbs. **Not decoded yet** (next job, see §16). |
| `GJBaseGameLayer::updateCamera` | 449342 | Camera dead zone 70/40, eased by 1/10 per frame (see §6). |
| `GameObject::customSetup` | 177013–181482 | Per-ID object type, hitbox size/scale, Z order and layer, particles. A 4,469-line binary-search `if` tree over the object ID. |
| `EnhancedGameObject::customSetup` | 181863 | The same for animated and rotating objects (saws, cogwheels, wheels). It falls back to `GameObject::customSetup` for anything else. |
| `GameObject::commonInteractiveSetup` | — | Collectibles: type 30, Z order 9, `keyEffect.plist`. |
| `GameObject::createWithKey` | 182950 | Chooses the C++ class for each object ID (see §7.3). |
| `GameObject::GameObject` | 165487 | Constructor. Sets `this+194` (object type) to 0, so anything not set otherwise counts as Solid. |
| `LevelTools::getAudioTitle` | 120541 | Official song number → title. |
| `LevelTools::getAudioFileName` | 121109 | Official song number → `.mp3` file name (see §12). |
| `MusicDownloadManager::getSongInfo` | ~395060 | POSTs to `getGJSongInfo.php`. |
| `MusicDownloadManager::downloadSong` | 395833 | Newgrounds download. Falls back to `https://www.newgrounds.com/audio/download/%i` and saves as `%i.mp3`. |
| `MusicDownloadManager::pathForSong` | 394118 | Save path. Library songs are `.ogg`, Newgrounds songs `.mp3`. |
| `MusicDownloadManager::getCustomContentURL` | 395114 | `getCustomContentURL.php` returns the CDN base URL. Library files are `/music/<id>.ogg`, SFX are `/sfx/s<id>.ogg`, and the indexes are `/music/musiclibrary_02.dat`, `musiclibrary_version_02.txt`, `/sfx/sfxlibrary.dat`. |
| `src/Managers/GameLevelManager.cpp` | — | Every HTTP request the game makes, with exact parameters, secrets and the `chk` hashing (see §11). |

Object field offsets confirmed by running `customSetup` **[game]**:

| Byte offset | DWORD | Meaning |
|---:|---:|---|
| 648 / 652 | 162 / 163 | Custom hitbox width and height (float, e.g. 30.0) |
| 756 | 189 | Circular hitbox radius (float). Saws use it, e.g. 32.3 for `sawblade_01`. |
| 764 / 768 | 191 / 192 | Hitbox width and height scale (float, e.g. spike 0.2 × 0.4) |
| 776 | 194 | `GameObjectType` |
| 884 | 221 | Object ID |
| 904 | 226 | Default Z order |
| 964 | 241 | Default Z layer |
| 549 | — | Byte flag: "in level editor" |

---

## 3. Coordinates, units and timing

- **1 block = 30 units.** In `-hd` textures, 1 unit = 2 px (a block is 60 × 60 px); in `-uhd`, 1 unit = 4 px. **[game]**
- **The y axis points up.** In WebDash the top of the ground is at y = 0, so a block resting on the ground has its centre at y = 15. In the game's own world the ground line is at y = 90 and the player starts at y = 105. The `105.0` check in `updateCamera` confirms this. **[game]**
- **Level-string positions use the same units.** The first column of blocks is at x = 15. Objects are positioned by their centre. **[game]**
- **The screen is 320 units tall** in the game's design resolution. The width depends on the aspect ratio: 569 units at 16:9. **[game]**
- **Timing.**
  - The game simulates in substeps, and WebDash uses 4 substeps per 60 Hz frame (240 Hz). **[game/tested]**
  - Vertical motion is multiplied by a 0.9 factor per step. **[game]**
  - gddocs says the level verification time is stored "in frames, assuming 240 FPS", which matches the 240 Hz step. **[docs]**
- **Horizontal speed per second** is the player speed × time modifier × 60. The resulting values match the well-known community figures: **[game + tested]**

| Speed | Portal ID | Time modifier | Player speed | Units/second | Blocks/second |
|---|---:|---:|---:|---:|---:|
| Slow (0.5×) | 200 | 0.7 | 5.980002 | 251.16 | 8.37 |
| Normal (1×) | 201 | 0.9 | 5.770002 | 311.58 | 10.39 |
| Fast (2×) | 202 | 1.1 | 5.870002 | 387.42 | 12.91 |
| Faster (3×) | 203 | 1.3 | 6.000002 | 468.00 | 15.60 |
| Fastest (4×) | 1334 | 1.6 | 6.000002 | 576.00 | 19.20 |

The `Speed` enum numbering (also used by level start key `kA4`) is Normal 0, Slow 1, Fast 2, Faster 3, Fastest 4 **[docs: Geode]**.

---

## 4. Player physics

Values are per substep unless stated otherwise. "fm" is +1 for normal gravity and −1 for flipped.

### 4.1 Cube **[game]**

Jump velocity and gravity change with the speed mode (decoded from the game's speed table):

| Speed | Jump velocity | Gravity per step |
|---|---:|---:|
| Slow | 10.620032 | 0.940199 |
| Normal | 11.180032 | 0.958199 |
| Fast | 11.420032 | 0.957199 |
| Faster / Fastest | 11.230032 | 0.961199 |

- **Each substep:** `vy -= gravity * 0.9 * (1/4) * fm`, clamped to a terminal velocity of 15. Then `y += vy * 0.9 * (1/4)`.
- **Jumping:** holding the button while on the ground sets `vy = jump * fm`. Holding keeps auto-jumping, as in the real game.
- **Rotation (cosmetic):** about 415°/s while in the air, snapping to the nearest 90° on landing. **[guess]**
- **Cube ceiling:** 330 units above the ground. **[guess]**

### 4.2 Ship **[game]**

- Gravity constant is 0.9582.
  - Holding: multiplier −1.0, or 0.5 instead of 0.4 when holding while falling.
  - Not holding: multiplier 0.8 while falling and 1.2 while rising, with lift 0.4.
- Velocity clamps are +8 up and −6.4 down (swapped when gravity is flipped).
- **Corridor:** the floor is placed at `floor((portalY − 150) / 30) * 30` and kept at 0 or above. The ceiling is the floor + 300 units (10 blocks).
  - The floor eases toward its target at 4 units per substep. The easing rate is a **[guess]**.

### 4.3 Pads (bumpPlayer / getBumpMod) **[game]**

Velocity = bump modifier × 16 × fm.

| Pad | ID | Cube modifier | Ship modifier |
|---|---:|---:|---:|
| Yellow | 35 | 1.0 | 1.0 |
| Pink | 140 | 0.65 | 0.35 |
| Red | 1332 | 1.25 | 0.95 |
| Blue (gravity) | 67 | — | — |

The blue pad flips gravity and halves velocity. Its exact launch velocity hasn't been decoded yet **[guess]**.

### 4.4 Portals **[game]**

- **Gravity portals** (10 = normal, 11 = inverse): flip gravity and multiply `vy` by 0.5. Only one trigger per touch.
- **Mode portals:** 12 cube, 13 ship, 47 ball, 111 UFO, 660 wave, 745 robot, 1331 spider, 1933 swing.
- **Other portals:** 99 / 101 normal / mini size, 45 / 46 mirror, 286 / 287 dual / solo, 747 teleport, 2926 gravity toggle.
- **Trigger box:** portals are triggered by a 34 × 86 box, rotated with the object. This size is a **[guess]**. The game's own portal size isn't set in `customSetup`, so it comes from the sprite.

### 4.5 The other game modes and orbs (engine v3 plug-ins)

All eight modes and the six basic orb colours are now ported. Each mode lives in `modes/<name>.js` and registers itself with `GDEngine.registerMode`. The orbs register through `registerOrbHandler` and `setPadMod`. Constants, line numbers and test results are in each `modes/<name>.md`; the lead review is in `modes/REVIEW.md`. Key values **[game]**:

| Mode | Corridor | Click | Gravity (× dt × flip) | Clamp |
|---|---|---|---|---|
| Ball | 240 | Flip gravity on a surface. `vy = jump·v20`, then ×0.5 (`flipGravity`), then ×0.6. | 0.6 × 0.9582 | ±15 |
| UFO | 300 | `vy = max(vy, 7.0·v20)` (8.0 mini) | 0.9582 × (1.2 rising / 0.8 falling) × 0.5 / v20 | +8 / −6.4 |
| Wave | 300 | Hold = up | None: `vy` set from horizontal speed (45°, steeper mini). Solid box 10×10. | — |
| Robot | none | Ground jump `0.5·jump`. Holding cancels gravity until a 1.5 accumulator (`+= dt·0.1`) runs out. | 0.9 × speed gravity | ±15 |
| Spider | 270 | Teleports to the opposite surface and flips gravity | 0.9582 | ±15 *(guess)* |
| Swing | 300 | Flip gravity, `vy ×0.8` | 0.4 (0.6 mini) × 0.9582 | ±8 |

- **Orbs:** `vy = jump · k(colour, mode) · (0.8 mini) · flip`, with per-mode factors from `ringJump` (e.g. pink 0.72, red 1.38; ball ×0.7 afterwards). Blue and green orbs flip gravity. The black orb is a fixed downward speed.
- **Flying modes:** orbs need a fresh press.
- **Pads:** strength depends on mode (`getBumpMod`).
- **Blue pad:** `propellPlayer(0.8)`, then flip.
- **Mirror and teleport portals:** also supported.

Not implemented yet: **dual mode**, **slopes**, and the **dash / spider / toggle / teleport orbs**.

---

## 5. Collision and hitboxes

### 5.1 Player

- The player box is 30 × 30 (15 units each side of the centre).
- WebDash uses a smaller 27 × 27 box against hazards in cube mode and 22 × 22 in ship mode. **[guess, tuned]**

### 5.2 Solids

These rules are **[guess, tuned so the bot can beat levels 1–2]**:

- Landing happens when the player was above the block's top on the previous step.
- Running into a block's side kills, with a 6-unit ledge forgiveness (the player snaps up onto it) and a 6-unit ceiling forgiveness (the player is pushed down).
- The 6-unit forgiveness was needed for a 1-block gap in Back On Track at x ≈ 19,500.

### 5.3 Object hitboxes **[game]**

`customSetup` sets a size, a scale, or a radius:

| Object | ID | Setup code | Resulting box |
|---|---:|---|---|
| Spike | 8 | box 30 × 30, scale 0.2 × 0.4 | **6 × 12**, centred |
| Small spike | 39 | sprite size × scale 0.2 × 0.4 | **6 × 5.4** |
| Spike variant | 103 | sprite size × scale 0.2 × 0.4 | **4 × 7.6** |
| Pit | 9 | sprite size × scale 0.3 × 0.4 | **9.15 × 10.6** |
| Yellow / pink / red / gravity orbs | 36, 141, 1333, 84… | box 30 × 30, scale 1.2 | **36 × 36** |
| Toggle orb | 1594 | box | **36 × 36** |
| Saws and cogwheels | 88, 186, 740, 1705 / 397, 1708 / 675, 1734 | radius | **32.3** / **28.9** / **32.0** |
| Spinning blades | 1619 / 1620 | radius | **25** / **15** |
| Fireballs | 1582 / 1583 | radius | **4** |
| Collectibles | 1275, 1614… | box | **25 × 20** |
| Teleport portal | 747 | box | 25 × 0 (special case) |

- WebDash now uses these game-derived hazard boxes, from `data/objtypes.js`. With them, Stereo Madness and Back On Track still clear in the bot **[tested]**.
- Where `customSetup` sets no box (most solids), the object map lists the sprite size as an estimate, marked `*`.
- Real solids almost certainly use the full 30 × 30 cell; WebDash uses 30 × 30, and 30 × 15 for planks.
- Level start key `kA39` ("Fix Radius Collision") turns on true circular hitboxes for round hazards **[docs]**. WebDash now uses true circle-vs-box collision for these. The smaller saw sizes have no radius in the code, so theirs are scaled from the big saw of the same family **[estimate]**.

---

## 6. Camera

From `GJBaseGameLayer::updateCamera` **[game]**:

- **Dead zone:** in cube-like modes the camera only moves vertically when the player is more than **70 units above** or **40 units below** the screen centre. The two limits swap when gravity is flipped. Mini mode uses 55 / 27.5.
- **Easing:** the camera moves **1/10 of the remaining distance per frame** vertically (horizontal 1/1). Mini mode uses (8, 10).
- **Floor:** the camera never goes below the default ground view, which shows the ground line 90 units above the bottom of the screen.
- **Flying modes:** the camera centres on the corridor.
- **Player position:** the player sits at a fixed horizontal offset. WebDash uses 33% of the screen width **[guess]**.

---

## 7. Objects: types, classes, IDs

### 7.1 GameObjectType

Names are from Geode; the numbers match what `customSetup` writes to `this+194`. The count column is how many 2.2 object IDs `customSetup` gives each type.

| Value | Name | # IDs | Value | Name | # IDs |
|---:|---|---:|---:|---|---:|
| 0 | Solid | 326* | 24 | SoloPortal | 1 |
| 2 | Hazard | 94 | 25 | Slope | 74 |
| 3 | InverseGravityPortal | 1 | 26 | WavePortal | 1 |
| 4 | NormalGravityPortal | 1 | 27 | RobotPortal | 1 |
| 5 | ShipPortal | 1 | 28 | TeleportPortal | 2 |
| 6 | CubePortal | 1 | 29 | GreenRing | 1 |
| 7 | Decoration | 3263 | 30 | Collectible | 145 |
| 8 | YellowJumpPad | 1 | 31 | UserCoin | 1 |
| 9 | PinkJumpPad | 1 | 32 | DropRing (black) | 1 |
| 10 | GravityPad | 1 | 33 | SpiderPortal | 1 |
| 11 | YellowJumpRing | 1 | 34 | RedJumpPad | 1 |
| 12 | PinkJumpRing | 1 | 35 | RedJumpRing | 1 |
| 13 | GravityRing | 1 | 36 | CustomRing (toggle) | 2 |
| 14 | InverseMirrorPortal | 1 | 37 | DashRing | 1 |
| 15 | NormalMirrorPortal | 1 | 38 | GravityDashRing | 1 |
| 16 | BallPortal | 1 | 39 | CollisionObject | 1 |
| 17 | RegularSizePortal | 1 | 40 | Special (D/J/S/H/F blocks) | 7 |
| 18 | MiniSizePortal | 1 | 41 | SwingPortal | 1 |
| 19 | UfoPortal | 1 | 42 | GravityTogglePortal | 1 |
| 20 | Modifier (triggers, speed portals) | 126 | 43 | SpiderOrb | 1 |
| 21 | Breakable | 1 | 44 | SpiderPad | 1 |
| 22 | SecretCoin | 1 | 45 | EnterEffectObject | — |
| 23 | DualPortal | 1 | 46 | TeleportOrb | 1 |
| | | | 47 | AnimatedHazard | 5 |

\* Type 0 is also the default, so a few IDs that get their type elsewhere show up as 0. The secret coin (142) and user coin (1329) are set by their own subclass; the map overrides them by hand.

### 7.2 The object map

`OBJECT_MAP.md` (readable) and `data/objects.json` (machine-readable) list **every one of the 4,093 IDs** with:

- sprite frame
- type and type name
- category: solid / hazard / slope / portal / speed portal / pad / orb / coin / collectible / special / trigger / decoration
- sprite sheet and size
- hitbox, scale and radius
- default Z order and layer
- trigger name (from the editor button sprite)
- which built-in levels use it, and how many times

Summary:

| Category | IDs | Used by built-in levels |
|---|---:|---:|
| Solid blocks | 326 | 156 |
| Slopes | 74 | 31 |
| Hazards | 99 | 65 |
| Portals | 19 | 18 |
| Speed portals | 5 | 4 |
| Pads | 5 | 4 |
| Orbs | 12 | 11 |
| Coins | 2 | 1 |
| Collectibles | 145 | 11 |
| Special / breakable / collision | 9 | 9 |
| Triggers | 134 | 104 |
| Decorations | 3,263 | 949 |

The built-in levels use **1,367 distinct IDs**. Four IDs appear in levels but are missing from the 2.2 table: the legacy colour triggers **104** (Line), **221** (Col 1), **717** (Col 2) and **718** (Col 3).

### 7.3 Which C++ class each ID becomes **[game]**

`GameObject::createWithKey` picks the class by ID: `GameObject`, `EffectGameObject` (most triggers), `RingObject` (orbs), `DashRingObject`, `EnhancedGameObject` (rotating/animated), `AnimatedGameObject`, `StartPosObject`, `TextGameObject`, `SpawnTriggerGameObject`, `CountTriggerGameObject`, `CameraTriggerGameObject`, `PlayerControlGameObject`, `SongTriggerGameObject`, `SFXTriggerGameObject`, `ShaderGameObject`, `TransformTriggerGameObject`, `CheckpointGameObject`, `ParticleGameObject`, `RandTriggerGameObject`, `ForceBlockGameObject`, `GameOptionsTrigger`, `SmartGameObject`, `GradientTriggerObject`, `RotateGameplayGameObject`, `SequenceTriggerGameObject`, `UISettingsGameObject`, `TimerTriggerGameObject`, `SpawnParticleGameObject`, `EndTriggerGameObject`, `EventLinkTrigger`, `ObjectControlGameObject`, `TriggerControlGameObject`, `LabelGameObject`, `SpecialAnimGameObject`, `EnhancedTriggerObject`.

### 7.4 Drawing order **[game, partly docs]**

- Every object has a default Z layer (B5…T3) and a Z order. Portals, for example, are Z order 10 on layer 5; orbs are Z order 12 on layer 3.
- Levels can override these with object keys `24` (Z layer) and `25` (Z order).
- Colour channels: 1000 BG, 1001 Ground, 1002 Line, 1003 3DL, 1004 Obj, 1009 Ground 2, 1013/1014 MG, plus user channels 1–999 **[docs]**. Sprites are grayscale and multiplied by their channel's colour, which is how WebDash already draws them.

---

## 8. Triggers used by the built-in levels

This is what the port must support to play the official levels correctly. Counts are totals across all built-in levels.

**Levels 1–18 (1.x era)** only need:

- Colour triggers 29 (BG ×1,323), 30 (Ground ×187), 105 (Obj ×297, levels 12–20), 744 (3DL ×97, levels 17–20).
- Enter-effect objects 22–28 and 55–59, which only change how blocks fly in.
- Ghost trail on/off: 32 / 33.
- Speed portals 200–203 (from level 15 on).

WebDash already handles 29 / 30.

**Levels 19–21 (2.0–2.1)** add:

| Trigger | ID | Uses |
|---|---:|---:|
| Color | 899 | 593 |
| Move | 901 | 894 |
| Pulse | 1006 | 1,376 |
| Alpha | 1007 | 500 |
| Toggle | 1049 | 352 |
| Spawn | 1268 | 1,073 |
| Rotate | 1346 | 192 |
| Shake | 1520 | 82 |
| Animate | 1585 | 92 |
| Stop | 1616 | 64 |
| Count | 1611 | — |
| Instant Count | 1811 | — |
| On Death | 1812 | — |
| Line colour | 915 | — |
| Ground 2 colour | 900 | — |

**Level 22 (Dash) and the Tower levels 5001–5004 (2.2)** add camera triggers (1913 Zoom, 1914 Static, 1916 Offset, 2015 Rotate, 2062 Edge, 2925 Mode). They also use:

- Shader triggers 2904–2924.
- Area / Enter triggers 3006–3024.
- Keyframes 3033, Sequence 3607, Advanced Follow 3016.
- SFX 3602 / 3603, Song 1934 / 3605, Event Link 3604.
- Item edit / compare 3619 / 3620.
- Time triggers 3614 / 3617.
- Collision State 3640, Teleport 3022, Gradient 2903, Particles 2065 / 3608.

The full per-trigger table, with level lists, is in `OBJECT_MAP.md` under *Triggers*.

**Trigger parameters** use the object keys in §9.3, for example:

- Move trigger 901: keys 28 / 29 (offset), 10 (duration), 30 (easing), 51 (target group).
- Pulse trigger 1006: keys 45 / 46 / 47 (fade in, hold, fade out), 48 (mode), 52 (target type).

---

## 9. Level data format

### 9.1 Encoding **[game + tested]**

```
level string (as stored in levels/*.txt, server key 4, save key k4)
  = URL-safe base64 ( gzip or zlib ( "header;obj;obj;...;" ) )
```

- Gzip data starts `H4sI`; zlib data starts `eJ`.
- The decoded text is `;`-separated. The first record is the **start object** (header). Each later record is an object of comma-separated `key,value` pairs.
- WebDash's `gdlevel.js` decodes all 27 built-in levels with **0 bad records** **[tested]**.

### 9.2 Start / header keys **[docs + game]**

| Key | Meaning |
|---|---|
| kA1 | Audio track (official song index, 0-based) |
| kA2 | Start game mode: 0 cube, 1 ship, 2 ball, 3 UFO, 4 wave, 5 robot, 6 spider, 7 swing |
| kA3 | Start mini |
| kA4 | Start speed (Speed enum) |
| kA6 / kA7 / kA25 | Background / ground / middleground texture ID |
| kA8 | Dual |
| kA9 | Start-pos flag |
| kA10 | Two-player |
| kA11 | Flip gravity |
| kA13 | Song offset in seconds (WebDash now starts the music here) |
| kA15 / kA16 | Fade in / out |
| kA17 | Ground line |
| kA18 | Font |
| kA20 | Reverse |
| kA22 | Platformer |
| kA28 | Mirror |
| kA29 | Rotate gameplay |
| kA31–kA45 | Compatibility switches. kA32 fixes the gravity bug, kA33 negative scale, kA34 robot jump, kA37 dynamic level height, kA39 radius collision, kA40 enables 2.2 changes. |
| kA36 | Spawn group |
| kS38 | Colour channels: `\|`-separated colour strings |
| kS29–kS37 | Legacy (pre-2.0) channels: 29 BG, 30 Ground, 31 Line, 32 Obj, 33 3DL, 34–37 Col 1–4. Format `1_r_2_g_3_b_4_playerColor_5_blending`. |

### 9.3 Object keys (most useful) **[docs + tested]**

- **Position and orientation:** 1 id · 2 x · 3 y · 4 flip X · 5 flip Y · 6 rotation (degrees, clockwise).
- **Trigger colour and timing:** 7 / 8 / 9 RGB (colour trigger) · 10 duration · 11 touch-triggered · 62 spawn-triggered · 87 multi-trigger.
- **Colour channels and layers:** 20 / 61 editor layers · 21 / 22 main / secondary colour channel · 23 target colour · 24 Z layer · 25 Z order · 41–44 HSV · 50 copied colour.
- **Groups and links:** 51 target group · 57 groups (`.`-separated) · 71 secondary group · 80 item / block ID · 108 linked group.
- **Scale:** 32 scale (pre-2.2) · 128 / 129 scale X / Y (2.2).
- **Move trigger:** 28 / 29 move offset · 30 easing · 85 easing rate · 58 / 59 lock to player.
- **Pulse trigger:** 45 / 46 / 47 fade in / hold / fade out · 48 mode · 52 target type.
- **Toggle trigger:** 56 activate group.
- **Rotate trigger:** 68 degrees · 69 times-360.
- **Other trigger parameters:** 63 spawn delay · 75 shake strength · 76 animation ID · 77 count · 120 time-warp modifier.
- **Misc:** 13 portal "checked" state (camera hint) · 31 text (base64) · 96 no glow · 103 high detail · 121 no touch.

The full table (≈130 keys) is on gddocs → *Level String*.

### 9.4 Colour string (`kS38`) **[docs + tested]**

Each `|`-separated entry is `key_value_key_value…`:

- 1 / 2 / 3: RGB
- 4: player colour (−1 none, 1 P1, 2 P2)
- 5: blending
- 6: channel ID
- 7: opacity
- 9: copied channel
- 10: HSV
- 17: copy opacity

WebDash's `parseColorChannels` reads these **[tested]**.

---

## 10. Save files (local levels) **[game + tested]**

- **Location (Windows):** `%LOCALAPPDATA%\GeometryDash\`.
  - `CCLocalLevels.dat` holds your created levels.
  - `CCGameManager.dat` holds progress and settings.
  - `<songID>.mp3` and `<libraryID>.ogg` are songs the game has downloaded.
- **Encoding:** XOR every byte with **11**, then URL-safe base64-decode, then gzip-inflate. The result is a plist-style XML using the tags `<d> <k> <s> <i> <r> <t/> <f/>`.
- **Level entries** live under `LLM_01`:
  - `k2` name · `k3` description (base64) · `k4` level string
  - `k8` official audio track · `k45` custom song ID
- **In WebDash:** drag `CCLocalLevels.dat` onto the page to pick and play one of your own levels. It plays with the right song if the song is in `songs/` or in the game's download folder (through the helper).

---

## 11. Official servers: protocol and endpoints

### 11.1 Request rules

| Rule | Detail | Source |
|---|---|---|
| Host | `https://www.boomlings.com/database/<endpoint>.php` | **[game]** |
| Method | `POST`, `Content-Type: application/x-www-form-urlencoded` | **[game]** |
| User-Agent | **No `User-Agent` header**, and the host must include `www.`. Otherwise Cloudflare blocks the request with code 1020. | **[docs]** |
| Common parameters | `secret=Wmfd2893gb7` is always sent. `getBasePostString` adds `gameVersion=22&binaryVersion=42&udid=…&uuid=…`, plus `&accountID=…&gjp2=…` when logged in. | **[game]** |
| Other secrets | `Wmfp3879gc3` for demon rating; `xI25fpAapCQg` is the hash salt for `chk` and response hashes. | **[game]** |
| Errors | The response body is `-1`, `-2`, … | **[docs]** |
| Rate limits | About 20 level downloads per minute and about 2 other requests per second, plus undisclosed longer-term limits. | **[docs]** |
| Browsers | Browsers can't call the servers directly: there are no CORS headers and the User-Agent can't be removed. A local helper is needed (§13). | **[tested]** |
| From this workspace | Requests from our build workspace get Cloudflare error **1005** (that network is blocked). Run the helper on your own PC. | **[tested]** |

### 11.2 `getGJLevels21.php`: search / browse

| Parameter | Meaning |
|---|---|
| `type` | Search type (table below) |
| `str` | Search text; a user ID for type 5; comma-separated level IDs for type 10; a list ID for type 25 |
| `page` | Page number, 10 results per page |
| `diff` | `-1` N/A, `-2` demon (with `demonFilter` 1–5), `-3` auto, `1`–`5` easy → insane; comma-separated |
| `len` | 0–5: tiny, short, medium, long, XL, platformer |
| Flags (0/1) | `star`, `noStar`, `featured`, `epic`, `legendary`, `mythic`, `original`, `twoPlayer`, `coins`, `uncompleted` / `onlyCompleted` (+ `completedLevels=(1,2,3)`) |
| `song` + `customSong=1` | Filter by song |
| `followed` | Account IDs, for type 12 |

Search types:

| Type | Meaning | Type | Meaning |
|---:|---|---:|---|
| 0 | Search | 13 | Friends (login needed) |
| 1 | Most downloaded | 15 | GD World most liked |
| 2 | Most liked | 16 | Hall of Fame |
| 3 | Trending | 17 | GD World featured |
| 4 | Recent | 21 | Daily history |
| 5 | By user | 22 | Weekly history |
| 6 | Featured | 23 | Event history |
| 7 | Magic | 25 | List |
| 10 | By ID list | 27 | Sent |
| 11 | Awarded | 31 | Hyped |
| 12 | Followed | | |

The response is `levels#creators#songs#total:offset:amount#hash`:

- `levels`: `|`-separated level objects, each `key:value:key:value`.
- `creators`: `userID:name:accountID`, separated by `|`.
- `songs`: `~:~`-separated song objects.

### 11.3 `downloadGJLevel22.php`: download one level

- **Parameter:** `levelID`. Use −1 for the daily, −2 for the weekly, −3 for the event level.
- **Response:** `level#hash1#hash2#user#songs#extraArtists`. The `user` part only comes back for −1 to −3, and the last three parts only when `binaryVersion` ≥ 42.
- **In-game download count:** the game sends `inc=1`, plus `rs` (a random 10-character string) and a `chk`. The `chk` is `base64( xor( sha1(levelID + inc + rs + accountID + udid + uuid + "xI25fpAapCQg"), "41274") )`. You only need this to bump the download count. **[game: GameLevelManager::downloadLevel]**

### 11.4 Level object keys (server)

| Key | Meaning | Key | Meaning |
|---:|---|---:|---|
| 1 | ID | 25 | Auto |
| 2 | Name | 27 | Password (XOR 26364) |
| 3 | Description (base64) | 30 | Copied from |
| **4** | **Level string** | 31 | Two-player |
| 5 | Version | 35 | Custom song ID |
| 6 | Player ID | 37 / 38 | Coins / verified |
| 9 | Difficulty: 0 N/A, 10 Easy … 50 Insane | 39 | Requested stars |
| 10 | Downloads | 42 | Epic tier: 1 epic, 2 legendary, 3 mythic |
| **12** | **Official song (0-based)** | 43 | Demon type: 3 easy, 4 medium, 0 hard, 5 insane, 6 extreme |
| 13 | Game version | 45 | Object count |
| 14 | Likes | 52 / 53 | Song / SFX ID lists |
| 15 | Length 0–4 | 57 | Verification time (frames at 240 FPS) |
| 17 | Demon | | |
| 18 | Stars | | |
| 19 | Feature score | | |

### 11.5 Other read-only endpoints

| Endpoint | Purpose |
|---|---|
| `getGJSongInfo.php` | `songID` → song object (§12) |
| `getCustomContentURL.php` | CDN base URL for library songs and SFX |
| `getGJDailyLevel.php` | `type` 0 daily / 1 weekly / 2 event → `index\|secondsLeft` |
| `getGJMapPacks21.php` | Map packs (`page`) |
| `getGJGauntlets21.php` | Gauntlets (`special=1`) |
| `getGJLevelLists.php` | Level lists (`str`, `type`, `page`) |
| `getGJLevels21.php` with `gauntlet=N` | Gauntlet levels. The game still calls this one over `http://`. |
| `getGJUserInfo20.php`, `getGJUsers20.php`, `getGJScores20.php`, `getGJComments21.php`, `getGJAccountComments20.php` | Users, scores and comments |

**Response hashes** (the client checks them; we don't need to) **[docs]**:

- `getGJLevels`: sha1 of `(first + last digit of level ID, stars, coins, verified flag)` for each level, plus `xI25fpAapCQg`.
- `downloadGJLevel` hash 1: 40 evenly spaced characters of the level string.
- `downloadGJLevel` hash 2: a set of fields.
- Both use the same salt.

---

## 12. Songs: official, Newgrounds, music library

### 12.1 Official songs **[game: LevelTools::getAudioFileName]**

The game ships these in `Geometry Dash/Resources/`. The number is the audio track (`kA1`, server key 12, save key `k8`). Main level *n* uses track *n − 1*.

| # | Title | File | # | Title | File |
|---:|---|---|---:|---|---|
| 0 | Stereo Madness | StereoMadness.mp3 | 20 | Fingerdash | Fingerdash.mp3 |
| 1 | Back On Track | BackOnTrack.mp3 | 21 | Dash | Dash.mp3 |
| 2 | Polargeist | Polargeist.mp3 | 22 | Explorers | Explorers.mp3 |
| 3 | Dry Out | DryOut.mp3 | 23 | The Seven Seas | The7Seas.mp3 |
| 4 | Base After Base | BaseAfterBase.mp3 | 24 | Viking Arena | VikingArena.mp3 |
| 5 | Cant Let Go | CantLetGo.mp3 | 25 | Airborne Robots | AirborneRobots.mp3 |
| 6 | Jumper | Jumper.mp3 | 26 | Secret | DJRubRub.mp3 |
| 7 | Time Machine | TimeMachine.mp3 | 27 | Payload | Payload.mp3 |
| 8 | Cycles | Cycles.mp3 | 28 | Beast Mode | BeastMode.mp3 |
| 9 | xStep | xStep.mp3 | 29 | Machina | Machina.mp3 |
| 10 | Clutterfunk | Clutterfunk.mp3 | 30 | Years | Years.mp3 |
| 11 | Theory of Everything | TheoryOfEverything.mp3 | 31 | Frontlines | ElectroFrontlines.mp3 |
| 12 | Electroman Adventures | Electroman.mp3 | 32 | Space Pirates | SpacePirates.mp3 |
| 13 | Clubstep | Clubstep.mp3 | 33 | Striker | Striker.mp3 |
| 14 | Electrodynamix | Electrodynamix.mp3 | 34 | Embers | Embers.mp3 |
| 15 | Hexagon Force | HexagonForce.mp3 | 35 | Round 1 | Round1.mp3 |
| 16 | Blast Processing | BlastProcessing.mp3 | 36 | Monster Dance Off | MonsterDanceOff.mp3 |
| 17 | Theory of Everything 2 | TheoryOfEverything2.mp3 | 37 | Press Start | PressStart.mp3 |
| 18 | Geometrical Dominator | GeometricalDominator.mp3 | 38 | Nock Em | knockemout.mp3 |
| 19 | Deadlocked | Deadlocked.mp3 | 39 | Power Trip | PowerTrip.mp3 |

- **On your PC:** tracks 0–21 (the 22 main levels) and 39 (Power Trip) are in your `Resources` folder.
- **Not shipped:** tracks 22–38 (Meltdown, World, SubZero and the Tower songs) aren't there. The game downloads those on demand.
- **In WebDash:** official songs now play straight from `..\Resources\` (WebDash sits inside the Geometry Dash folder), or from `/gdres/` when it's served by the helper.

### 12.2 Newgrounds songs

- **Song info:** POST `getGJSongInfo.php` with `songID` and `secret` **[game]**. The response is a `~|~`-separated song object **[docs]**:

  | Key | Meaning |
  |---:|---|
  | 1 | ID |
  | 2 | Name |
  | 3 | Artist ID |
  | 4 | Artist |
  | 5 | Size in MB |
  | 6 | YouTube video |
  | 7 | YouTube channel |
  | 8 | Verified artist |
  | 10 | **URL-encoded download link** (`audio.ngfiles.com/…mp3`) |
  | 11 | NONG type |
  | 12 / 15 | Extra artists |

  Error `-2` means the song isn't allowed in GD.
- **Download order used by the game** (`MusicDownloadManager::downloadSong`) **[game]**:
  1. The key 10 link from song info.
  2. If that's empty: `https://www.newgrounds.com/audio/download/<id>`.
  3. Saved as `%LOCALAPPDATA%\GeometryDash\<id>.mp3`.
- **Library songs:** songs above a fixed ID threshold are music-library tracks. They come from `<getCustomContentURL>/music/<id>.ogg` and are saved as `.ogg`.
  - The threshold is a compiled constant IDA mislabelled. Community tooling uses **10,000,000** **[docs, not verified]**.
- **SFX:** `<CDN>/sfx/s<id>.ogg`.
- **Library index:** `musiclibrary_02.dat`, which is URL-safe base64 + zlib. Its parts are `version|artists|songs|tags`.
- **Respect the artists.** Newgrounds artists choose whether their music may be used in GD; that's the meaning of `-2`. Download only what you need for personal play.

---

## 13. Level searcher and song downloader (`tools/gdserver.js`)

A single Node.js file with no npm packages (Node 18+). It does three jobs:

1. **Local web server** for the game at `http://localhost:8080/`. It serves `../Resources/*` as `/gdres/` so official songs work.
2. **Proxy to the GD servers.** It sends the POST with no User-Agent and the secret, rate-limits itself to under 2 requests per second, and caches results.
3. **Song downloader.** It checks, in order:
   1. `songs/`
   2. the game's own download folder `%LOCALAPPDATA%\GeometryDash\<id>.mp3`
   3. the `getGJSongInfo` link
   4. `newgrounds.com/audio/download/<id>`
   5. the library CDN, for library IDs

**Start it:** double-click `start-webdash.bat`, or run `node tools\gdserver.js` in the webdash folder. The main menu then shows an **Online levels** panel with search, Most liked, Featured, Trending, Recent, Awarded, Hall of Fame, Daily and Weekly. Clicking a result downloads the level, downloads its song if it's custom, and plays it.

**Command line:**

```
node tools\gdserver.js search "stereo madness"          # 10 results per page, --page N, --star, --diff 1,2, --len 3, --type 2
node tools\gdserver.js level 128                        # -> levels\128.txt + levels\128.json (drag the .txt onto the game)
node tools\gdserver.js daily                            # current daily (weekly also works)
node tools\gdserver.js song 803223                      # -> songs\803223.mp3
```

**HTTP API** (used by the menu):

| Route | Returns |
|---|---|
| `GET /api/search?str=&type=&page=&diff=&len=&star=` | `{total, levels:[{id,name,author,difficulty,stars,length,customSongID,officialSong,…}]}` |
| `GET /api/level/<id>` | Level info + `levelString`. Use −1 for the daily, −2 for the weekly. |
| `GET /api/song/<id>` | Song info |
| `GET /api/song/<id>/file` | The audio file, downloaded once and then cached |

**Tested on your PC (Node v25.9.0) [tested]:**

- `search "stereo madness" --star` returned 38 results.
- `level 2816038` saved *Stereo Madness 2* (3,139 objects, 0 bad records). It uses only cube/ship features, and the reachability bot beat it under the WebDash engine.
- `song 590577` saved a 9.8 MB mp3.

**Caveat:** imported levels play with the current engine. They work only as far as WebDash supports their game modes and triggers. The page warns about unsupported features (`world.unsupported`) when a level loads.

---

## 14. Assets and texture atlases

- **Atlases:** sprites come from `GJ_GameSheet`, `GJ_GameSheet02`–`04` and `GJ_GameSheetGlow` (`-hd` 2048² / `-uhd` 4096²). Each has a cocos2d `.plist` describing frames:
  - frame rectangle, `textureRotated` (stored rotated 90°)
  - `spriteOffset` and `spriteSourceSize` (trimming)
- **Lookup:** WebDash has 3,189 frames in `data.js`. Each object ID maps to its main frame through `objdb.js` (from the exe).
- **Composite objects:** in-game, many objects are built from several frames (a main sprite plus colour, glow or detail children; `addColorSprite`, `addGlow`, `addCustomChild` in `GameObject`). WebDash currently draws only the main frame, so composite objects such as portals (front + back), some blocks and animated objects look simplified.
- **Backgrounds and grounds:**
  - Backgrounds: `game_bg_01`–`59` (`kA6`). WebDash only uses `_01` so far.
  - Grounds: `groundSquare_01`–`22`, plus `_2` overlays and ground lines (`kA7`, `kA17`).
  - Middlegrounds: `fg_` / `mg_` (`kA25`).
  - All of these are in `Resources/`.
- **Player icons:** `player_01`, `ship_01` and so on, each with layers (`_001` main, `_2_001` secondary, `_glow`, `_extra`). They're tinted with player colours 1 and 2.

---

## 15. WebDash: current state and file guide

| File | Role |
|---|---|
| `index.html` | Page shell and menu styles |
| `game.js` | Renderer, menu, input (timestamped and applied per 240 Hz substep), camera, music, online browser |
| `engine.js` | Physics core: movement, collisions (box and circle), pads, portals, speed, mini, corridors, plug-in API |
| `modes/*.js` | Game modes (ball, UFO, wave, robot, spider, swing) and orbs. Each comes with a `.md` report; `modes/REVIEW.md` has the lead review. |
| `tools/bot.js`, `tools/mklevel.js` | Reachability bot (proves a level can be completed) and test-level builder |
| `gdlevel.js` | Level-string, save-file and colour-string parser |
| `gdobjects.js` | Gameplay classification for each ID; uses `data/objtypes.js` when loaded |
| `objdb.js` | Object ID → frame (from the exe) |
| `data.js` | Atlas frames |
| `levels.js` | The 22 main levels (encoded strings) |
| `data/objects.json`, `OBJECT_MAP.md`, `data/objtypes.js` | The object map (§7.2) |
| `tools/gdserver.js`, `start-webdash.bat` | Helper server: level search and download, songs |
| `assets/` | Fallback copies of a few textures and sounds |

**Verified [tested]:**

- Stereo Madness and Back On Track can be beaten. A reachability bot searched every hold/release sequence under the engine, and its solutions replay to the end in the browser.
- All 27 built-in levels parse cleanly.
- Input reaches the physics within about 4 ms of the key press.

**Not yet supported:** dual mode; slopes; dash, spider, toggle and teleport orbs; and every trigger except the legacy BG / ground colour triggers.

Bot results under the current engine **[tested]**:

| Level | Result |
|---|---|
| 1 Stereo Madness, 2 Back On Track, 3 Polargeist, 4 Dry Out, 5 Base After Base | **Cleared** |
| 12 Theory of Everything (UFO, blue pads, saws) | **Cleared** |
| 9 Cycles | Stops at x ≈ 8,085 (cube section, before the ball). A tight jump between floor and ceiling spikes: probably a small hitbox or jump mismatch, still open. |
| 17 Blast Processing | Got to x ≈ 24,100 of 25,000+ in the best run, through the wave section; it stops at a slope, and slopes aren't simulated yet. |
| 19–22 and the Tower levels | Need Move / Toggle / Spawn triggers: their platforms are built by triggers. |

---|---|
| 1–2 | Fully playable |
| 3 onward | Orbs |
| 9 onward | Ball |
| 12 onward | UFO |
| 17 onward | Wave |
| 19 onward | Robot and 2.0 triggers |
| 21 onward | Spider |
| 22 | Swing and 2.2 triggers |

---

## 16. Roadmap: what is missing, in order

1. **Move, Toggle, Spawn, Alpha, Pulse and Rotate triggers.** They gate levels 19–22 and every 2.0+ online level. They need a group system: object key 57 holds an object's groups, and the triggers target them through key 51.
2. **Slopes** (type 25). RobTop's own snippet is in `rt-freebies/PlayerObject.cpp`. This blocks the end of level 17 and the slope-heavy levels 16–18.
3. **Dual mode**: a second player with mirrored gravity (`GJBaseGameLayer::toggleDualMode` 462616, `updateDualGround` 451158).
4. **The remaining orbs**: dash 1704 / 1751 (`startDashing` 148504), spider orb 3004, toggle 1594, teleport orb 3027.
5. **Open accuracy questions**:
   - Level 9's tight cube jump.
   - Hazard boxes for robot, spider and UFO.
   - The out-of-level bound (y > 3000).
   - Radii of the smaller saws (estimated).
6. **Visual accuracy**: composite sprites (colour and glow children), backgrounds and grounds per level, Z layers from the object map, robot and spider animations (from `Robot_AnimDesc.plist` and `Spider_AnimDesc.plist`).

---

## 17. Reverse-engineering methods used

- **Object ID → frame table:**
  - Disassembled `GeometryDash.exe` with capstone and pefile.
  - The `ObjectToolbox` constructor (~0x1404a1cd9–0x1404c9ac2) stores pairs as `mov dword [rsp+X], ID` followed by a string load (`lea rdx, [rip+str]`).
  - Walking that pattern gave 4,094 pairs.
- **Object types and hitboxes:**
  - Took `GameObject::customSetup` and `EnhancedGameObject::customSetup` (IDA pseudo-C, about 5,400 lines).
  - Converted them mechanically to compilable C++: stubbed cocos2d calls, modelled `commonInteractiveSetup`, and kept typed pointers.
  - Ran them in a forked sandbox once per object ID (1–4,700) on a zeroed object, then diffed the memory to read type, scales, box, radius and Z.
  - Spot-checked against known values (spike 6 × 12, orb 36 × 36, portal and pad types) and the Geode enum. 6 IDs crashed mid-setup and are flagged `partial`.
- **Physics constants:** read from `updateJump`, `updateTimeMod`, `bumpPlayer` / `getBumpMod` and the exe's speed table.
- **Validation:** a frame-by-frame reachability bot (state-merged breadth-first search over hold/release) proves whether a level can be completed under the engine. Every engine change is re-checked against levels 1–2.

---

## 18. References

- Decompile: `GD-2.206-Decompiled-main` by CallocGD (attached zip). Tools: https://github.com/CallocGD/Geometry-Dash-Miscellaneous-Decomp-Tools
- gddocs (community docs, mirrored):
  - https://gddocs.omgrod.me/
  - Level resource: https://gddocs.omgrod.me/resources/server/level
  - Song resource: https://gddocs.omgrod.me/resources/server/song
  - Level string: https://gddocs.omgrod.me/resources/client/level/level-string
  - Start keys: https://gddocs.omgrod.me/resources/client/level/level-start
  - Request rules: https://gddocs.omgrod.me/endpoints/generic
  - Hashes: https://gddocs.omgrod.me/resources/server/hashes
  - Music library: https://gddocs.omgrod.me/resources/client/musiclibrary
- gd-docs source markdown:
  - https://raw.githubusercontent.com/Rifct/gd-docs/main/docs/endpoints/levels/getGJLevels21.md
  - https://raw.githubusercontent.com/Rifct/gd-docs/main/docs/endpoints/levels/downloadGJLevel22.md
  - https://raw.githubusercontent.com/Rifct/gd-docs/main/docs/endpoints/songs/getGJSongInfo.md
- Daily-level docs: https://trigamdev.github.io/gd-docs/server/endpoints/levels/event/getGJDailyLevel
- Geode bindings (enum names): https://github.com/geode-sdk/bindings (`bindings/include/Geode/Enums.hpp`)
- Object ID notes: https://a-zalt.github.io/gdknowledge/resources/object_ids.html
- Trigger overview: https://geometrydash.wiki.gg/wiki/Triggers
