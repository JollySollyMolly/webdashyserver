#!/usr/bin/env node
/* Build a small test level for the bot / browser.
 *   node tools/mklevel.js out.txt [startMode] [startSpeed]  < objects.txt
 * objects.txt: one object per line: "id x y [rot] [flipY] [flipX]"  (GD units; ground top y=0, so a block on the floor has y=15)
 * Lines starting with # are comments. Prints nothing; writes an encoded level string (like levels/*.txt).
 * Also usable as a module: require('./mklevel.js')(objs, {startMode, startSpeed}) -> level string */
'use strict';
const zlib = require('zlib'), fs = require('fs');
function build(objs, h) {
  h = h || {};
  let txt = `kA2,${h.startMode | 0},kA4,${h.startSpeed | 0},kA11,${h.startFlipped ? 1 : 0},kS38,1_40_2_125_3_255_6_1000|1_0_2_102_3_255_6_1001;`;
  for (const o of objs) {
    let s = `1,${o.id},2,${o.x},3,${o.y}`;
    if (o.rot) s += `,6,${o.rot}`;
    if (o.flipY) s += `,5,1`;
    if (o.flipX) s += `,4,1`;
    txt += s + ';';
  }
  return zlib.gzipSync(Buffer.from(txt)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
module.exports = build;
if (require.main === module) {
  const [out, mode, speed] = process.argv.slice(2);
  const objs = fs.readFileSync(0, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    const [id, x, y, rot, flipY, flipX] = l.split(/\s+/).map(Number); return { id, x, y, rot, flipY, flipX };
  });
  fs.writeFileSync(out, build(objs, { startMode: +mode || 0, startSpeed: +speed || 0 }));
}
