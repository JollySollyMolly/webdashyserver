WebDash - personal HTML5 port of Geometry Dash (Stereo Madness, cube + ship)

Run: double-click index.html (Chrome/Edge/Firefox). No server needed.
Controls: Space / Up / W / click / tap (hold to jump or fly)
Add ?debug to the URL to see hitboxes and object IDs.

Art, music and level data come from your own Steam copy of Geometry Dash.
Personal use only - do not distribute (the assets belong to RobTop Games).

--- v2 ---
Engine rebuilt from the game's own physics constants (engine.js), real level-string parser (gdlevel.js),
object-ID -> sprite table pulled from the Windows exe (objdb.js / gdobjects.js), levels 1-22 embedded (levels.js).
Esc = level menu. Drag a level-string .txt or CCLocalLevels.dat onto the page to play your own levels.
Working: cube, ship, pads, gravity/speed/mode portals. Not yet: orbs, ball, UFO, wave, robot, spider, mini, dual, mirror.
Levels 1 and 2 are verified beatable by a bot; later levels need the missing features. Music: only level 1 ships;
put your own tracks at assets/music/<level number>.mp3.

--- v3 ---
GD_RESEARCH.md   - everything we know: decompile map, physics, hitboxes, file formats, servers, songs, roadmap.
OBJECT_MAP.md    - every object ID (blocks, decorations, triggers, portals...) with type, hitbox, used-in levels.
data/objects.json, data/objtypes.js - the same map for code.
Official songs now play straight from the game's own Resources folder (webdash sits inside it).
Online levels + Newgrounds songs: double-click start-webdash.bat (needs Node.js 18+), then use
"Online levels" in the menu. Command line: node tools\gdserver.js search "name" | level <id> | song <id>

--- v4 (game modes) ---
All game modes now play: cube, ship, ball, UFO, wave, robot, spider, swing (+ mini), plus orbs
(yellow, pink, red, blue, green, black), per-mode pads, mirror and teleport portals.
Each mode is a plug-in in modes/ with a report; modes/REVIEW.md lists what was checked against the game.
Bot-verified complete: levels 1, 2, 3, 4, 5, 12. Later levels mainly need Move/Toggle/Spawn triggers,
slopes and dual mode (see GD_RESEARCH.md section 16).
