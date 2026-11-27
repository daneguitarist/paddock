// PADDOCK: find the list of the pad's built-in sound names inside its update file (LDSP_UPD.DAT,
// which sits on the card). Read-only. The list is only accepted if it agrees with every built-in
// sound the card's own kits already use (kits store each sound's number and name).
(function () {
'use strict';
const isNameByte = c => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95 || c === 32 || c === 46;

function find(hay, needle, from) {
  const n0 = needle[0], L = needle.length;
  outer: for (let i = hay.indexOf(n0, from); i !== -1 && i <= hay.length - L; i = hay.indexOf(n0, i + 1)) {
    for (let k = 1; k < L; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}
// every place `name` appears as a whole string (not part of a longer name)
function spots(u8, name) {
  const nd = Uint8Array.from(name, c => c.charCodeAt(0)), out = [];
  for (let i = find(u8, nd, 0); i !== -1 && out.length < 64; i = find(u8, nd, i + 1)) {
    if ((i === 0 || !isNameByte(u8[i - 1])) && !isNameByte(u8[i + nd.length])) out.push(i);
  }
  return out;
}
function readName(u8, p, max) {
  let s = '';
  for (let i = 0; i < max; i++) { const c = u8[p + i]; if (!c || !isNameByte(c)) break; s += String.fromCharCode(c); }
  return (u8[p + s.length] === 0 || s.length === max) ? s.trim() : '';
}

// known: Map(index -> name) from the kits on the card. Returns [{i, name}] or null.
function extract(u8, known) {
  const pairs = [...known.entries()].filter(([, n]) => n && n.length >= 3).sort((a, b) => a[0] - b[0]);
  if (pairs.length < 3) return null;
  const at = pairs.map(([i, n]) => ({ i, n, s: spots(u8, n) })).filter(p => p.s.length);
  if (at.length < 3) return null;
  // 1) fixed-size table: entry i at base + i * stride
  const votes = new Map();
  for (let x = 0; x < at.length; x++) for (let y = x + 1; y < at.length; y++) {
    const d = at[y].i - at[x].i; if (d <= 0) continue;
    for (const px of at[x].s) for (const py of at[y].s) {
      const diff = py - px; if (diff <= 0 || diff % d) continue;
      const stride = diff / d; if (stride < 4 || stride > 256) continue;
      const base = px - at[x].i * stride, k = base + ':' + stride;
      votes.set(k, (votes.get(k) || 0) + 1);
    }
  }
  const tries = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [k] of tries) {
    const [base, stride] = k.split(':').map(Number);
    const list = [];
    for (let i = 0; i < 2000; i++) {
      const p = base + i * stride; if (p < 0 || p >= u8.length) break;
      const nm = readName(u8, p, Math.min(stride, 24));
      if (!nm) break;
      list.push({ i, name: nm });
    }
    if (check(list, known)) return list;
  }
  // 2) packed strings one after another (zero between them)
  for (const p of at) for (const s of p.s) {
    let q = s; const back = [];
    for (let i = p.i - 1; i >= 0; i--) {
      let e = q - 2; while (e >= 0 && u8[e] === 0) e--;
      let b = e; while (b >= 0 && isNameByte(u8[b])) b--;
      if (e < 0 || e - b < 1 || e - b > 24) break;
      back.unshift(String.fromCharCode(...u8.subarray(b + 1, e + 1))); q = b + 1;
    }
    if (back.length !== p.i) continue;
    const list = back.map((name, i) => ({ i, name }));
    q = s;
    for (let i = p.i; i < 2000; i++) {
      const nm = readName(u8, q, 24); if (!nm) break;
      list.push({ i, name: nm });
      q += nm.length; while (q < u8.length && u8[q] === 0) q++;
    }
    if (check(list, known)) return list;
  }
  return null;
}
function check(list, known) {
  if (list.length < 50) return false;
  for (const [i, n] of known) if (!list[i] || list[i].name !== n) return false;
  return true;
}

// friendlier words for the pad's short names, e.g. 14RkHHOp → 14" rock hat open
const WORDS = { Ac: 'acoustic', Fk: 'funk', Rk: 'rock', Jz: 'jazz', El: 'electro', Ec: 'electro', Ht: 'hip-hop', Hp: 'hip-hop', Br: 'brush', Vn: 'vintage', Mt: 'metal', Rg: 'reggae',
  Bd: 'kick', Kk: 'kick', Sn: 'snare', SnR: 'snare rim', Rm: 'rim', Tm: 'tom', Cr: 'crash', Rd: 'ride', RdB: 'ride bell', Ch: 'china', Sp: 'splash', Cb: 'cowbell', Cl: 'clap',
  HHCl: 'hat closed', HHOp: 'hat open', HHPd: 'hat pedal', HHSp: 'hat splash', HHHf: 'hat half', HH: 'hat' };
function describe(name) {
  const m = name.match(/^(\d{2})?([A-Za-z]+?)(\d*)$/);
  if (!m) return '';
  const toks = m[2].match(/HH[A-Z][a-z]|HH|[A-Z][a-z]*R?(?=[A-Z]|$)/g);
  if (!toks || toks.join('') !== m[2]) return '';
  const words = toks.map(t => WORDS[t]);
  if (words.some(w => !w)) return '';
  return (m[1] ? m[1] + '" ' : '') + words.join(' ') + (m[3] ? ' ' + m[3] : '');
}

window.PadBuiltins = { extract, describe };
})();
