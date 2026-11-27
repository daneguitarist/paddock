// PADDOCK sound handling: read WAV/AIFF headers and audio, convert anything to what the
// SamplePad Pro plays (16-bit PCM WAV, mono or stereo, 48/44.1/32/22.05/11.025 kHz),
// trim dead air, fold fake stereo to mono, and make 8-character card names.
(function () {
'use strict';
const RATES = [48000, 44100, 32000, 22050, 11025];
const MB = 1024 * 1024;

const str4 = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);

// WAV header only (works on the first few KB of a file). Returns null if it isn't a WAV.
function wavInfo(u8) {
  if (u8.length < 12 || str4(u8, 0) !== 'RIFF' || str4(u8, 8) !== 'WAVE') return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const info = { tag: 0, ch: 0, sr: 0, bits: 0, dataOff: -1, dataLen: 0, extra: [] };
  let o = 12;
  while (o + 8 <= u8.length) {
    const id = str4(u8, o), len = dv.getUint32(o + 4, true);
    if (id === 'fmt ' && o + 24 <= u8.length) {
      info.tag = dv.getUint16(o + 8, true); info.ch = dv.getUint16(o + 10, true);
      info.sr = dv.getUint32(o + 12, true); info.bits = dv.getUint16(o + 22, true);
      if (info.tag === 0xfffe && len >= 40 && o + 34 <= u8.length) info.sub = dv.getUint16(o + 32, true);
    } else if (id === 'data') { info.dataOff = o + 8; info.dataLen = len; break; }
    else info.extra.push(id);
    o += 8 + len + (len & 1);
  }
  if (!info.ch) return null;
  info.frames = info.dataOff >= 0 ? Math.floor(info.dataLen / Math.max(1, info.ch * info.bits / 8)) : 0;
  return info;
}

// what the pad can play as-is
function padReady(info) {
  return !!info && info.tag === 1 && info.bits === 16 && (info.ch === 1 || info.ch === 2) && RATES.includes(info.sr) && info.dataOff >= 0;
}

function describe(info) {
  if (!info) return 'not a WAV';
  const ch = info.ch === 1 ? 'mono' : info.ch === 2 ? 'stereo' : info.ch + 'ch';
  const fmt = info.tag === 3 || info.sub === 3 ? '32-bit float' : info.bits + '-bit';
  return `${ch} ${fmt} ${(info.sr / 1000).toFixed(info.sr % 1000 ? 1 : 0)}k`;
}

// full WAV decode to float channels, no resampling
function readWav(u8) {
  const info = wavInfo(u8);
  if (!info || info.dataOff < 0) throw new Error('this WAV has no audio in it');
  const fmt = info.tag === 0xfffe ? (info.sub || 1) : info.tag;
  const { ch, bits } = info, bps = bits / 8;
  const avail = Math.min(info.dataLen, u8.length - info.dataOff);
  const frames = Math.floor(avail / (ch * bps));
  const dv = new DataView(u8.buffer, u8.byteOffset + info.dataOff, frames * ch * bps);
  const out = Array.from({ length: ch }, () => new Float32Array(frames));
  for (let i = 0, p = 0; i < frames; i++) for (let c = 0; c < ch; c++, p += bps) {
    let v;
    if (fmt === 3 && bits === 32) v = dv.getFloat32(p, true);
    else if (fmt === 3 && bits === 64) v = dv.getFloat64(p, true);
    else if (fmt !== 1) throw new Error('this WAV uses a compressed format');
    else if (bits === 16) v = dv.getInt16(p, true) / 32768;
    else if (bits === 24) v = ((dv.getUint8(p + 2) << 24 >> 8) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p)) / 8388608;
    else if (bits === 32) v = dv.getInt32(p, true) / 2147483648;
    else if (bits === 8) v = (dv.getUint8(p) - 128) / 128;
    else throw new Error(bits + '-bit WAVs aren\'t supported');
    out[c][i] = v;
  }
  return { chans: out, sr: info.sr, int16: fmt === 1 && bits === 16 };
}

// AIFF / AIFC (Chrome can't decode these itself)
function readAiff(u8) {
  if (str4(u8, 0) !== 'FORM' || !['AIFF', 'AIFC'].includes(str4(u8, 8))) throw new Error('not an AIFF');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 12, ch = 0, frames = 0, bits = 0, sr = 0, comp = 'NONE', ssnd = -1;
  while (o + 8 <= u8.length) {
    const id = str4(u8, o), len = dv.getUint32(o + 4, false);
    if (id === 'COMM') {
      ch = dv.getInt16(o + 8, false); frames = dv.getUint32(o + 10, false); bits = dv.getInt16(o + 14, false);
      const ex = dv.getUint16(o + 16, false) & 0x7fff, hi = dv.getUint32(o + 18, false), lo = dv.getUint32(o + 22, false);
      sr = Math.round((hi * 2 ** 32 + lo) * 2 ** (ex - 16383 - 63));
      if (len >= 22) comp = str4(u8, o + 26);
    } else if (id === 'SSND') ssnd = o + 16 + dv.getUint32(o + 8, false);
    o += 8 + len + (len & 1);
  }
  if (!ch || ssnd < 0) throw new Error('this AIFF has no audio in it');
  const le = comp === 'sowt', flt = comp === 'fl32' || comp === 'FL32', bps = flt ? 4 : Math.ceil(bits / 8);
  frames = Math.min(frames, Math.floor((u8.length - ssnd) / (ch * bps)));
  const out = Array.from({ length: ch }, () => new Float32Array(frames));
  for (let i = 0, p = ssnd; i < frames; i++) for (let c = 0; c < ch; c++, p += bps) {
    let v;
    if (flt) v = dv.getFloat32(p, le);
    else if (bps === 2) v = dv.getInt16(p, le) / 32768;
    else if (bps === 3) v = (le ? (dv.getUint8(p + 2) << 24 >> 8) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p)
                               : (dv.getUint8(p) << 24 >> 8) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2)) / 8388608;
    else if (bps === 4) v = dv.getInt32(p, le) / 2147483648;
    else if (bps === 1) v = dv.getInt8(p) / 128;
    else throw new Error('unsupported AIFF');
    out[c][i] = v;
  }
  return { chans: out, sr, int16: bps === 2 && !flt };
}

let _ctx = null;
const ctx = () => (_ctx = _ctx || new (window.AudioContext || window.webkitAudioContext)());

async function decode(u8, name) {
  const head = str4(u8, 0);
  if (head === 'RIFF') { try { return readWav(u8); } catch (e) { if (!/compressed/.test(e.message)) throw e; } }
  if (head === 'FORM') return readAiff(u8);
  let buf;
  try { buf = await ctx().decodeAudioData(u8.slice().buffer); }
  catch (e) { throw new Error(`couldn't read ${name || 'this file'} as audio`); }
  return { chans: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice()), sr: buf.sampleRate, int16: false };
}

async function resample(chans, sr, outSr) {
  if (sr === outSr) return chans;
  const frames = Math.max(1, Math.round(chans[0].length * outSr / sr));
  const oc = new OfflineAudioContext(chans.length, frames, outSr);
  const b = oc.createBuffer(chans.length, chans[0].length, sr);
  chans.forEach((d, c) => b.copyToChannel(d, c));
  const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
  const r = await oc.startRendering();
  return Array.from({ length: chans.length }, (_, c) => r.getChannelData(c).slice());
}

// left and right carry the same thing → one channel is enough
function fakeStereo(chans, int16) {
  if (chans.length !== 2) return false;
  const [l, r] = chans, tol = int16 ? 0 : 1 / 32768;
  for (let i = 0; i < l.length; i++) if (Math.abs(l[i] - r[i]) > tol) return false;
  return true;
}

// trim silence at the start (keeps 1 ms) and the end (keeps 10 ms, short fade)
function trimBounds(chans, sr) {
  const n = chans[0].length, startThr = 0.001, endThr = 0.0005;
  const peak = i => { let m = 0; for (const c of chans) m = Math.max(m, Math.abs(c[i])); return m; };
  let a = 0; while (a < n && peak(a) < startThr) a++;
  if (a >= n) return { a: 0, b: n, silent: true };
  let b = n - 1; while (b > a && peak(b) < endThr) b--;
  a = Math.max(0, a - Math.round(sr * 0.001));
  b = Math.min(n, b + 1 + Math.round(sr * 0.010));
  return { a, b, silent: false };
}

function encodeWav16(chans, sr, int16Source) {
  const ch = chans.length, frames = chans[0].length, bytes = 44 + frames * ch * 2;
  const u8 = new Uint8Array(bytes), dv = new DataView(u8.buffer);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) u8[o + i] = s.charCodeAt(i); };
  w4(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); w4(8, 'WAVE'); w4(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  w4(36, 'data'); dv.setUint32(40, frames * ch * 2, true);
  let seed = 22222;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0, p = 44; i < frames; i++) for (let c = 0; c < ch; c++, p += 2) {
    let v = chans[c][i] * 32768;
    v = int16Source ? Math.round(v) : Math.round(v + rnd() - rnd()); // TPDF dither only when it wasn't 16-bit already
    dv.setInt16(p, v > 32767 ? 32767 : v < -32768 ? -32768 : v, true);
  }
  return u8;
}

// turn any audio file into a pad-ready WAV. opts: {trim, fold}
async function prepare(u8, name, opts = {}) {
  const trim = opts.trim !== false, fold = opts.fold !== false;
  const src = await decode(u8, name);
  let { chans, sr } = src; const notes = [];
  if (chans.length > 2) { chans = chans.slice(0, 2); notes.push('kept the first 2 of ' + src.chans.length + ' channels'); }
  let int16 = src.int16;
  if (!RATES.includes(sr)) {
    const to = sr > 44100 ? 48000 : 44100;
    chans = await resample(chans, sr, to); notes.push(`resampled ${sr / 1000}k → ${to / 1000}k`); sr = to; int16 = false;
  }
  if (fold && fakeStereo(chans, int16)) { chans = [chans[0]]; notes.push('stereo was really mono → mono'); }
  let peak = 0; for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (peak > 1) { const g = 0.999 / peak; for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g; int16 = false; notes.push('was over 0 dB, brought down'); }
  if (trim) {
    const n0 = chans[0].length, t = trimBounds(chans, sr);
    if (t.silent) notes.push('this sound is silent');
    else if (t.a > 0 || t.b < chans[0].length) {
      const cut = (n0 - (t.b - t.a)) / sr;
      chans = chans.map(c => c.slice(t.a, t.b));
      const f = Math.min(chans[0].length, Math.round(sr * 0.010));
      if (t.b < n0) for (const c of chans) for (let i = 0; i < f; i++) c[c.length - 1 - i] *= i / f;
      if (cut >= 0.005) notes.push(`trimmed ${cut < 1 ? Math.round(cut * 1000) + ' ms' : cut.toFixed(1) + ' s'} of silence`);
    }
  }
  const bytes = encodeWav16(chans, sr, int16);
  return { bytes, ch: chans.length, sr, frames: chans[0].length, seconds: chans[0].length / sr, notes };
}

// an 8-character card name (letters/digits only) that isn't taken yet
function name8(orig, taken) {
  let base = String(orig).replace(/\.[^.]*$/, '');
  const m = base.match(/(\d+)\s*$/);
  let num = m ? m[1] : '';
  let stem = m ? base.slice(0, m.index) : base;
  stem = stem.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join('');
  if (num.length > 4) num = num.slice(-4);
  const room = 8 - num.length;
  if (stem.length > room) {
    const c = stem.split('');
    for (let i = c.length - 1; i > 0 && c.length > room; i--) if (/[aeiou]/.test(c[i])) c.splice(i, 1);
    for (let i = c.length - 1; i > 0 && c.length > room; i--) if (/[a-z]/.test(c[i]) && /[a-z]/.test(c[i - 1])) c.splice(i, 1);
    stem = c.join('').slice(0, room);
  }
  if (!stem) stem = 'SND';
  let cand = stem + num;
  for (let i = 2; taken.has(cand.toLowerCase()); i++) {
    const suf = String(i); cand = (stem + num).slice(0, 8 - suf.length - 1) + '_' + suf;
    if (cand.length > 8) cand = cand.slice(-8);
  }
  taken.add(cand.toLowerCase());
  return cand.toUpperCase(); // all caps: the FAT short name and the name in the kit then match exactly
}

// pad-legal card file name: 1–8 letters/digits/_/-, then .wav
const legalName = n => /^[A-Za-z0-9_-]{1,8}\.wav$/i.test(n);

window.PadAudio = { RATES, MB, wavInfo, padReady, describe, readWav, readAiff, decode, prepare, name8, legalName, ctx, fakeStereo };
})();
