/* gdobjects.js - object database helpers: id -> sprite frame (extracted from GeometryDash.exe) and
   id -> gameplay category / hitbox. Works in browser and Node. */
(function (root) {
  'use strict';
  var DB = (typeof module !== 'undefined' && module.exports) ? null : root.GD_OBJDB;
  // optional table from data/objtypes.js: id -> [GameObjectType, w, h, radius?] (from GameObject::customSetup)
  var OT = (typeof module !== 'undefined' && module.exports) ? null : root.GD_OBJTYPES || null;
  function frameFor(id) { return DB ? DB.names[DB.map[id]] : null; }

  var PORTAL = { 10: { grav: 0 }, 11: { grav: 1 }, 12: { mode: 0 }, 13: { mode: 1 }, 47: { mode: 2 }, 111: { mode: 3 }, 660: { mode: 4 },
                 745: { mode: 5 }, 1331: { mode: 6 }, 1933: { mode: 7 }, 99: { size: 0 }, 101: { size: 1 }, 45: { mirror: 1 }, 46: { mirror: 0 },
                 286: { dual: 1 }, 287: { dual: 0 }, 747: { teleport: true }, 2902: { teleport: true } };
  var SPEED = { 200: 'slow', 201: 'normal', 202: 'fast', 203: 'faster', 1334: 'fastest' };
  // pad: id -> {kind, mod for cube} ; real bump modifiers from the game (velocity = mod * 16)
  var PAD = { 35: { kind: 'yellow' }, 140: { kind: 'pink' }, 1332: { kind: 'red' }, 67: { kind: 'blue' } };
  var ORB = { 36: 'yellow', 141: 'pink', 1333: 'red', 84: 'blue', 1022: 'green', 1330: 'black' };
  var COIN = { 142: 1, 1329: 1 };

  // hazard hitboxes by sprite family: [cx, cy, w, h] relative to object centre, y up
  function hazardBox(frame) {
    if (/^spike_01|^colorSpike_01|^invis_spike/.test(frame)) return [0, -3, 6, 12];
    if (/^spike_02|^colorSpike_02/.test(frame)) return [0, -1.5, 12, 6];
    if (/^spike_0[34]|^colorSpike_0[34]/.test(frame)) return [0, -3, 6, 12];
    if (/^pit_/.test(frame)) return [0, 0, 20, 12];
    if (/^(sawblade|blade|darkblade|lightBlade|spinBlade|blackCogwheel)/.test(frame)) return [0, 0, 24, 24];
    return null;
  }
  var HAZ_RE = /^(spike_0\d|colorSpike_0\d|invis_spike_|pit_(0\d|b_\d|\d)|sawblade_|blade_|blade_b_|darkblade_|lightBlade_|spinBlade_|blackCogwheel_)/;
  var NONHAZ_RE = /(_slope_|_low_|_extra|_glow|_shine|_color|_part|_piece)/;
  var SOLID_RE = /^(square_0\d|square_\d\d|block\d{3}[a-z]?_\d\d|plank_\d\d|colorPlank_\d\d)(_\d\d)?_001\.png$/;
  var SOLID_BAD = /(_color|_glow|_piece|_part|_slope|_light|_edge|_base|_top|_bg|_small)/;

  /** returns {cat, box:[cx,cy,w,h]?, ...} */
  function classify(id) {
    var frame = frameFor(id);
    if (id in PORTAL) return { cat: 'portal', frame: frame, p: PORTAL[id] };
    if (id in SPEED) return { cat: 'speed', frame: frame, speed: SPEED[id] };
    if (id in PAD) { var tp = OT && OT[id]; return { cat: 'pad', frame: frame, pad: PAD[id].kind, box: tp && tp[1] ? [0, 0, tp[1], tp[2]] : [0, -5, 30, 14] }; }   // pad box = sprite size (25 x 4) when the type table is loaded
    if (id in ORB) return { cat: 'orb', frame: frame, orb: ORB[id], box: [0, 0, 36, 36] };
    if (id in COIN) return { cat: 'coin', frame: frame };
    if (!frame) return { cat: 'none', frame: null };
    var t = OT && OT[id];
    if (t && (t[0] === 2 || t[0] === 47)) {                       // hazard, size straight from the game's setup code
      if (t[3]) return { cat: 'hazard', frame: frame, box: [0, 0, t[3] * 2, t[3] * 2], radius: t[3] };   // round hazard
      if (t[1] && t[2]) return { cat: 'hazard', frame: frame, box: [0, 0, t[1], t[2]] };
    }
    if (t && t[0] === 0 && !/^(edit_|particle_|persp_outline)/.test(frame)) {   // Solid per GameObject::customSetup. 3D outline pieces are drawn lines (level 17 has free-standing outline columns)
      return { cat: 'solid', frame: frame, box: [0, 0, t[1] || 30, t[2] || 30] };
    }
    if (t && t[0] === 25 && !/^persp_outline/.test(frame)) return { cat: 'slope', frame: frame, box: [0, 0, t[1] || 30, t[2] || 30], hazard: !!t[5] };   // Slope (type 25); spike slopes have byte 944
    if (t && t[0] === 7) return { cat: 'deco', frame: frame };
    if (HAZ_RE.test(frame) && !NONHAZ_RE.test(frame)) { var b = hazardBox(frame); if (b) return { cat: 'hazard', frame: frame, box: b }; }
    if (SOLID_RE.test(frame) && !SOLID_BAD.test(frame)) {
      var half = /^(plank|colorPlank)/.test(frame);
      return { cat: 'solid', frame: frame, box: [0, 0, 30, half ? 15 : 30] };
    }
    if (/^edit_/.test(frame)) return { cat: 'trigger', frame: frame };
    return { cat: 'deco', frame: frame };
  }
  var api = { classify: classify, frameFor: frameFor, PORTAL: PORTAL, SPEED: SPEED, PAD: PAD, ORB: ORB };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; api.setDB = function (d) { DB = d; }; api.setTypes = function (t) { OT = t; }; } else root.GDObjects = api;
})(typeof window !== 'undefined' ? window : globalThis);
