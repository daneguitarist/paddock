// PADDOCK kit file reader / writer for the Alesis SamplePad Pro (.KIT, 8832 bytes)
// Layout learned from a kit saved by the pad itself (USER_001.KIT "Funk") and from
// LesserChance's samplepad-editor (CC BY 4.0), which documented the block offsets.
// Unknown bytes are always carried through untouched when editing an existing kit.

const PAD_ORDER = ['pad_01','pad_02','pad_03','pad_04','pad_05','pad_06','pad_07','pad_08',
  'ext_1a','ext_1b','ext_2','kick','hh_ope','hh_mid','hh_clo','hh_chk','hh_spl'];
const HDR = 128, BLK = 256, NPADS = PAD_ORDER.length, KIT_SIZE = HDR + BLK * NPADS * 2; // 8832

// default MIDI notes per position (same as the pad's factory kits)
const DEFAULT_NOTE = {pad_01:49,pad_02:51,pad_03:48,pad_04:45,pad_05:46,pad_06:36,pad_07:38,pad_08:42,
  ext_1a:38,ext_1b:40,ext_2:43,kick:36,hh_ope:46,hh_mid:23,hh_clo:42,hh_chk:44,hh_spl:21};

const MODES = ['POLY','MONO','LOOP','STOP','TMP','CLK'];

// offsets inside a 256-byte pad block
const O = {loc:0x07, inLen:0x0f, inName:0x10, inIdxHi:0x20, inIdx:0x21, padCount:0x23, nParams:0x25,
  level:0x29, tune:0x2d, pan:0x31, reverb:0x35, note:0x39, mode:0x3d, sens:0x41, p0d:0x45, mgrp:0x49,
  aFlag:0x80, aFlag2:0x81, aVmin:0x82, aVmax:0x83, aLen:0x87, aDisp:0x88, aFile:0x90,
  bFlag:0xa0, bFlag2:0xa1, bVmin:0xa2, bVmax:0xa3, bLen:0xa7, bDisp:0xa8, bFile:0xb0};

// the 9 parameter groups [id, value, a, b] that start at 0x28 in both blocks
const PARAM_GROUPS = [[0x00,8,0x00,0x0a],[0x01,0,0x04,0x08],[0x02,0,0x04,0x08],[0x03,3,0x00,0x0a],
  [0x08,0,0x00,0x7f],[0x09,0,0x00,0x05],[0x0c,16,0x00,0x08],[0x0d,0,0x00,0x09],[0x0e,0,0x00,0x10]];

const s8 = v => (v > 127 ? v - 256 : v);
const u8 = v => (v < 0 ? 256 + v : v) & 255;
const asc = (b, off, len) => { let s=''; for (let i=0;i<len;i++){ const c=b[off+i]; if(!c) break; s+=String.fromCharCode(c);} return s; };
const put = (b, off, str, len, pad) => { for (let i=0;i<len;i++) b[off+i] = i < str.length ? str.charCodeAt(i) & 255 : pad; };

function checksum(bytes) { let s = 0; for (let i = 9; i < bytes.length; i++) s += bytes[i]; return s % 256; }

function blankBlock(isBlock2) {
  const b = new Uint8Array(BLK);
  put(b, 0, 'KITI', 4, 0); b[4] = 1;
  if (!isBlock2) { b[O.inLen] = 7; put(b, O.inName, '22AcBd1', 16, 0); }
  b[O.padCount] = NPADS; b[O.nParams] = PARAM_GROUPS.length;
  PARAM_GROUPS.forEach((g, i) => b.set(g, 0x28 + 4 * i));
  if (isBlock2) { b[O.aFlag]=0xff; b[O.aFlag2]=0xff; b[O.aVmax]=0x7f; b[O.bFlag]=0xff; b[O.bFlag2]=0xff; b[O.bVmax]=0x7f; }
  return b;
}

function blankHeader(name) {
  const h = new Uint8Array(HDR);
  put(h, 0, 'KITH', 4, 0); h[5] = 0x80; h[0x0b] = NPADS;
  h[0x47] = name.length; put(h, 0x48, name, 32, 0);
  return h;
}

// a pad as the page edits it
function defaultPad(pos) {
  return { pos, loc: 'int', inName: '22AcBd1', inIdx: 0, level: 8, tune: 0, pan: 0, reverb: 3,
    note: DEFAULT_NOTE[pos], mode: 0, sens: 16, p0d: 0, mgrp: 0,
    a: '', aVmin: 0, aVmax: 127, b: '', bVmin: 0, bVmax: 127 };
}

function parseKit(bytes) {
  bytes = new Uint8Array(bytes);
  if (bytes.length !== KIT_SIZE) throw new Error(`not a SamplePad Pro kit (size ${bytes.length}, expected ${KIT_SIZE})`);
  if (asc(bytes, 0, 4) !== 'KITH') throw new Error('not a kit file (no KITH header)');
  const okSum = checksum(bytes) === bytes[8];
  const header = bytes.slice(0, HDR);
  const kit = { name: asc(bytes, 0x48, bytes[0x47]), checksumOk: okSum, raw: { header, b1: {}, b2: {} }, pads: {} };
  PAD_ORDER.forEach((pos, i) => {
    const b1 = bytes.slice(HDR + BLK * i, HDR + BLK * (i + 1));
    const b2 = bytes.slice(HDR + BLK * (NPADS + i), HDR + BLK * (NPADS + i + 1));
    kit.raw.b1[pos] = b1; kit.raw.b2[pos] = b2;
    kit.pads[pos] = {
      pos, loc: b1[O.loc] ? 'card' : 'int',
      inName: asc(b1, O.inName, b1[O.inLen]), inIdx: (b1[O.inIdxHi] << 8) | b1[O.inIdx],
      level: b1[O.level], tune: s8(b1[O.tune]), pan: s8(b1[O.pan]), reverb: b1[O.reverb],
      note: b1[O.note], mode: b1[O.mode], sens: b1[O.sens], p0d: b1[O.p0d], mgrp: b1[O.mgrp],
      a: b2[O.aFlag] === 0xaa ? asc(b2, O.aFile, b2[O.aLen]) : '', aVmin: b2[O.aVmin], aVmax: b2[O.aVmax],
      b: b2[O.bFlag] === 0xaa ? asc(b2, O.bFile, b2[O.bLen]) : '', bVmin: b2[O.bVmin], bVmax: b2[O.bVmax],
    };
  });
  return kit;
}

function clampInt(v, lo, hi) { v = Math.round(Number(v) || 0); return Math.max(lo, Math.min(hi, v)); }

// build the 8832 bytes. `kit.raw` (from parseKit) is used as the base when present so unknown
// bytes survive; otherwise clean templates are generated.
function buildKit(kit) {
  const name = String(kit.name || 'KIT').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 8) || 'KIT';
  const out = new Uint8Array(KIT_SIZE);
  const header = kit.raw ? kit.raw.header.slice() : blankHeader(name);
  header[0x47] = name.length; put(header, 0x48, name, 32, 0);
  out.set(header, 0);
  PAD_ORDER.forEach((pos, i) => {
    const p = Object.assign(defaultPad(pos), kit.pads[pos] || {});
    const b1 = kit.raw && kit.raw.b1[pos] ? kit.raw.b1[pos].slice() : blankBlock(false);
    const b2 = kit.raw && kit.raw.b2[pos] ? kit.raw.b2[pos].slice() : blankBlock(true);
    const card = p.loc === 'card';
    const vals = { level: clampInt(p.level,0,10), tune: u8(clampInt(p.tune,-4,4)), pan: u8(clampInt(p.pan,-4,4)),
      reverb: clampInt(p.reverb,0,10), note: clampInt(p.note,0,127), mode: clampInt(p.mode,0,5),
      sens: clampInt(p.sens,0,255), p0d: clampInt(p.p0d,0,255), mgrp: clampInt(p.mgrp,0,16) };
    for (const b of [b1, b2]) {
      b[O.loc] = card ? 1 : 0;
      for (const k in vals) b[O[k]] = vals[k];
    }
    // internal sound (block 1 only). Kept even for card pads, like the pad does.
    const inName = String(p.inName || '').slice(0, 16);
    b1[O.inLen] = inName.length; put(b1, O.inName, inName, 16, 0);
    const idx = clampInt(p.inIdx, 0, 65535); b1[O.inIdxHi] = idx >> 8; b1[O.inIdx] = idx & 255;
    // card sample layers (block 2): file name keeps its case, the display copy is uppercase
    const layer = (file, flag, flag2, vmin, vmax, len, disp, f, lo, hi) => {
      file = card ? String(file || '').replace(/\.WAV$/i, '').slice(0, 8) : '';
      b2[flag] = file ? 0xaa : 0xff;
      b2[flag2] = card ? 0xaa : 0xff;
      b2[vmin] = clampInt(lo, 0, 127); b2[vmax] = clampInt(hi, 0, 127);
      b2[len] = file.length; put(b2, disp, file.toUpperCase(), 8, file ? 0x20 : 0); put(b2, f, file, 8, 0);
    };
    layer(p.a, O.aFlag, O.aFlag2, O.aVmin, O.aVmax, O.aLen, O.aDisp, O.aFile, p.aVmin, p.aVmax);
    layer(p.b, O.bFlag, O.bFlag2, O.bVmin, O.bVmax, O.bLen, O.bDisp, O.bFile, p.bVmin, p.bVmax);
    if (!card && kit.raw && kit.raw.b2[pos]) { // an untouched internal pad keeps its original layer bytes
      const r = kit.raw.b2[pos];
      for (const o of [O.aFlag, O.aFlag2, O.bFlag, O.bFlag2]) b2[o] = r[o];
    }
    out.set(b1, HDR + BLK * i);
    out.set(b2, HDR + BLK * (NPADS + i));
  });
  out[8] = checksum(out);
  return out;
}

function newKit(name) {
  const pads = {}; PAD_ORDER.forEach(p => pads[p] = defaultPad(p));
  return { name: name || 'NEW', pads };
}

const KitFile = { PAD_ORDER, DEFAULT_NOTE, MODES, KIT_SIZE, parseKit, buildKit, newKit, defaultPad, checksum };
if (typeof module !== 'undefined') module.exports = KitFile; else window.KitFile = KitFile;
