global.window = {}; require('../src/builtins.js'); const B = window.PadBuiltins;
const names = []; const kinds = ['AcBd','FkSn','RkHHOp','RkCr','FkTm','RkRd','ElBd','JzSnR'];
for (let i = 0; i < 210; i++) names.push((i % 3 ? '14' : '') + kinds[i % kinds.length] + (1 + (i >> 3)));
names[0] = '22AcBd1'; names[1] = '22AcBd2'; names[87] = 'RkCr1'; names[81] = '20RkRd'; names[98] = '14RkHHOp';
const known = new Map([[0, '22AcBd1'], [1, '22AcBd2'], [81, '20RkRd'], [87, 'RkCr1'], [98, '14RkHHOp']]);
function rnd(n) { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 7919 + (i >> 3) * 31) & 255; return u; }
// fixed table, stride 20, with decoy copies of names elsewhere
let u = rnd(300000); let base = 123457;
names.forEach((n, i) => { const p = base + i * 20; u.fill(0, p, p + 20); for (let k = 0; k < n.length; k++) u[p + k] = n.charCodeAt(k); });
u.fill(0, 5000, 5010); for (let k = 0; k < 5; k++) u[5001 + k] = 'RkCr1'.charCodeAt(k);
let r = B.extract(u, known); console.log('fixed:', r && r.length, r && r.slice(85, 90).map(x => x.name).join(','));
// packed strings
u = rnd(300000); let p = 222222; u[p - 1] = 0;
names.forEach(n => { for (let k = 0; k < n.length; k++) u[p++] = n.charCodeAt(k); u[p++] = 0; });
r = B.extract(u, known); console.log('packed:', r && r.length, r && r.slice(85, 90).map(x => x.name).join(','));
console.log('wrong known →', B.extract(u, new Map([[0, '22AcBd1'], [1, '22AcBd2'], [81, 'RkCr1'], [87, 'RkCr1']])));
for (const n of ['22AcBd1', '14RkHHOp', '14FkSnR1', 'RkCr1', '20RkRd', 'FkTm3', 'Weird9']) console.log(n, '→', B.describe(n));
