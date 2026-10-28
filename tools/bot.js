// Reachability bot for engine v3 + mode plug-ins. usage: node bot3.js <levelNumber|path> [cap] [maxFrames]
// Loads every modes/*.js plug-in. Exit code 0 = cleared, 1 = no survivors (prints where), 2 = gave up.
const path = require('path'), fs = require('fs');
const W = process.env.WEBDASH || require('path').resolve(__dirname, '..') + '/';
const E = require(W + 'engine.js'), G = require(W + 'gdlevel.js'), O = require(W + 'gdobjects.js');
for (const f of fs.existsSync(W + 'modes') ? fs.readdirSync(W + 'modes').filter(f => f.endsWith('.js')).sort() : []) require(W + 'modes/' + f);
const raw = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'objtable_raw.json'))); const names = [], map = {};
raw.forEach(([k, v]) => { let i = names.indexOf(v); if (i < 0) { i = names.length; names.push(v); } map[k] = i; });
O.setDB({ names, map }); O.setTypes(require(W + 'data/objtypes.js'));
const n = process.argv[2] || '1', CAP = +process.argv[3] || 2500, MAXF = +process.argv[4] || 20000;
const file = n.includes('/') ? n : `/mnt/user-data/uploads/Geometry Dash/Resources/levels/${n}.txt`;
const lv = G.loadLevelStringSync(fs.readFileSync(file, 'utf8'));
const world = E.buildWorld(lv, O.classify);
console.log('level', n, JSON.stringify(world.counts), 'unsupported', JSON.stringify(world.unsupported), 'start', world.startMode, world.startSpeed, 'endX', world.endX);
const KEYF = ['mode', 'ground', 'flip', 'speed', 'mini', 'buffer', 'lastTrig', 'usedOrbs', 'k'];
function key(s, act) {
  let k = Math.round(s.y * 2) + '|' + Math.round(s.vy * 4) + '|' + Math.round(s.gy) + '|' + Math.round(Math.min(s.ceil, 1e6)) + '|' + act;
  for (const f of KEYF) k += '|' + (s[f] === undefined ? '' : s[f]);
  return k;
}
let layer = [E.newState(world)]; const parents = [], acts = [];   // per frame: Int32Array parent index, Uint8Array action
const t0 = Date.now(); let f = 0;
for (; f < MAXF; f++) {
  const seen = new Map(), nextS = [], par = [], ac = []; let won = -1, wonAct = 0;
  for (let i = 0; i < layer.length && won < 0; i++) for (let act = 0; act < 2; act++) {
    const s = E.cloneState(layer[i]); E.stepFrame(world, s, !!act);
    if (s.dead) continue;
    if (s.won) { won = i; wonAct = act; break; }
    const k = key(s, act);
    if (!seen.has(k)) { seen.set(k, nextS.length); nextS.push(s); par.push(i); ac.push(act); }
  }
  if (won >= 0) {
    const out = [wonAct]; let idx = won;
    for (let i = f - 1; i >= 0; i--) { out.push(acts[i][idx]); idx = parents[i][idx]; }
    out.reverse();
    fs.writeFileSync(path.join(__dirname, 'sol_' + path.basename(String(n)).replace(/\W/g, '_') + '.json'), JSON.stringify(out));
    console.log('LEVEL CLEARED in', f, 'frames (' + (f / 60).toFixed(1) + 's), search', ((Date.now() - t0) / 1000).toFixed(1) + 's'); process.exit(0);
  }
  if (!nextS.length) {
    const any = layer.slice().sort((a, b) => b.x - a.x)[0];
    const d1 = E.cloneState(any); E.stepFrame(world, d1, false); const d2 = E.cloneState(any); E.stepFrame(world, d2, true);
    console.log('NO SURVIVORS at frame', f, 'x~', Math.round(any.x), 'y', Math.round(any.y), 'mode', any.mode, 'why(release)', JSON.stringify(d1.why), 'why(hold)', JSON.stringify(d2.why));
    process.exit(1);
  }
  let keepIdx;
  if (nextS.length > CAP) { const order = nextS.map((s, i) => i).sort((a, b) => nextS[a].y - nextS[b].y), st = order.length / CAP; keepIdx = []; for (let i = 0; i < CAP; i++) keepIdx.push(order[Math.floor(i * st)]); }
  else keepIdx = nextS.map((s, i) => i);
  parents.push(Int32Array.from(keepIdx.map(i => par[i]))); acts.push(Uint8Array.from(keepIdx.map(i => ac[i])));
  layer = keepIdx.map(i => nextS[i]);
  if (f % 1000 === 0) console.log(' frame', f, 'x', Math.round(layer[0].x), 'states', layer.length, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
console.log('gave up at frame', f); process.exit(2);
