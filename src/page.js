// PADDOCK page logic. Uses window.KitFile (kit.js), window.PadAudio (audio.js), window.BUILTINS.
(function () {
'use strict';
const K = window.KitFile, A = window.PadAudio, MB = A.MB;
const BUILTINS = window.BUILTINS || [];
const PB = window.PadBuiltins;
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const SLOTS = 20, KIT_MB = 48, MAX_FILES = 512;
const LABEL = { pad_01: 'Pad 1', pad_02: 'Pad 2', pad_03: 'Pad 3', pad_04: 'Pad 4', pad_05: 'Pad 5', pad_06: 'Pad 6', pad_07: 'Pad 7', pad_08: 'Pad 8',
  kick: 'Kick pedal', ext_1a: 'Ext 1A', ext_1b: 'Ext 1B', ext_2: 'Ext 2',
  hh_ope: 'Hat open', hh_mid: 'Hat mid', hh_clo: 'Hat closed', hh_chk: 'Hat chick', hh_spl: 'Hat splash' };
const MAIN = [['pad_01', 'wide'], ['pad_02', 'wide'], ['pad_03', 'big'], ['pad_04', 'big'], ['pad_05', 'big'], ['pad_06', 'big'], ['pad_07', 'big'], ['pad_08', 'big']];
const EXTRA = ['kick', 'ext_1a', 'ext_1b', 'ext_2'];
const HATS = ['hh_ope', 'hh_mid', 'hh_clo', 'hh_chk', 'hh_spl'];
const ORDER = MAIN.map(m => m[0]).concat(EXTRA, HATS);
const MODE_HELP = ['each hit overlaps the last', 'each hit cuts off the last', 'loops until you hit it again', 'stops every sound playing',
  'tap it to set the click tempo', 'starts / stops the click'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
const pad3 = n => String(n).padStart(3, '0');
// (1.0.1) the pad's own kits are 1-10, so card slot 1 (USER_001.KIT) is kit 11 on the pad, slot 2 is kit 12...
const FIRST_CARD_KIT = 11;
const padKit = n => n + FIRST_CARD_KIT - 1;
const kitFile = n => `USER_${pad3(n)}.KIT`;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const $ = id => document.getElementById(id);
const mbText = b => b < MB ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / MB).toFixed(b < 10 * MB ? 1 : 0) + ' MB';

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

const S = {
  root: null, kitsDir: null, lib: new Map(), taken: new Set(), names: {},
  saved: {}, work: {}, slot: 1, sel: 'pad_07', filter: 'all', q: '',
  backedUp: false, busy: false, seq: 0, otherKits: 0,
  builtins: BUILTINS.length ? BUILTINS : store.get('paddock.builtins') || null,
};
window.PADDOCK = S;

// ---------- the sound library ----------
const baseOf = f => f.replace(/\.wav$/i, '');
function cardItemByBase(base) {
  base = base.toLowerCase();
  for (const it of S.lib.values()) if (it.src === 'card' && it.file && baseOf(it.file).toLowerCase() === base) return it;
  return null;
}
function ensureTarget(it) {
  if (it.target) return it.target;
  if (it.src === 'card' && it.legal && it.ready) return (it.target = baseOf(it.file));
  return (it.target = A.name8(it.disp, S.taken));
}
function needsWrite(it) { return it.src === 'new' || (it.src === 'card' && !(it.legal && it.ready)); }
function itemSize(it) { return it.bytes ? it.bytes.length : it.size || 0; }
function keyFor(base) {
  if (!base) return null;
  const it = cardItemByBase(base);
  if (it) return it.replacedBy || it.key;
  const key = 'm:' + base.toLowerCase();
  if (!S.lib.has(key)) S.lib.set(key, { key, src: 'missing', disp: base, target: base, size: 0 });
  return key;
}

async function scanCard(root) {
  S.lib.clear(); S.taken.clear(); S.names = {}; S.saved = {}; S.work = {}; S.backedUp = false; S.otherKits = 0;
  try {
    const pd = await root.getDirectoryHandle('PADDOCK');
    const f = await (await pd.getFileHandle('names.json')).getFile();
    S.names = JSON.parse(await f.text()).names || {};
  } catch (e) { /* first visit */ }
  const files = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === 'file' && /\.wav$/i.test(name) && !name.startsWith('._')) files.push([name, handle]);
  }
  files.forEach(([n]) => S.taken.add(baseOf(n).toLowerCase()));
  setStatus(`reading ${files.length} sounds…`);
  let done = 0;
  const one = async ([name, handle]) => {
    const f = await handle.getFile();
    let head = new Uint8Array(await f.slice(0, 4096).arrayBuffer());
    let info = A.wavInfo(head);
    if (info && info.dataOff < 0 && f.size > 4096) info = A.wavInfo(new Uint8Array(await f.slice(0, 262144).arrayBuffer()));
    const orig = S.names[baseOf(name).toLowerCase()];
    const it = { key: 'c:' + name.toLowerCase(), src: 'card', file: name, handle, size: f.size, info,
      ready: A.padReady(info), legal: A.legalName(name), disp: orig ? baseOf(orig) : baseOf(name), copyOf: orig || null };
    S.lib.set(it.key, it);
    if (++done % 20 === 0) setStatus(`reading sounds… ${done}/${files.length}`);
  };
  for (let i = 0; i < files.length; i += 12) await Promise.all(files.slice(i, i + 12).map(one));
  // an original that PADDOCK already made a short copy of is shown once, as the copy
  for (const it of S.lib.values()) if (it.copyOf) {
    const o = S.lib.get('c:' + it.copyOf.toLowerCase());
    if (o && o !== it) { o.hidden = true; o.replacedBy = it.key; }
  }
  try { S.kitsDir = await root.getDirectoryHandle('KITS'); } catch (e) { S.kitsDir = null; }
  if (S.kitsDir) {
    for await (const [name, handle] of S.kitsDir.entries()) {
      if (handle.kind !== 'file' || !/\.kit$/i.test(name)) continue;
      const m = name.match(/^USER_(\d{3})\.KIT$/i);
      const n = m ? +m[1] : 0;
      if (!(n >= 1 && n <= SLOTS)) { S.otherKits++; continue; }
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      try { S.saved[n] = { kit: K.parseKit(bytes), bytes, file: name }; }
      catch (e) { S.saved[n] = { error: e.message, bytes, file: name }; }
    }
  }
}

function toWork(kit) {
  const w = { name: kit.name, raw: kit.raw, pads: {} };
  for (const pos of K.PAD_ORDER) {
    const p = Object.assign({}, kit.pads[pos]);
    p.aKey = p.loc === 'card' ? keyFor(p.a) : null;
    p.bKey = p.loc === 'card' ? keyFor(p.b) : null;
    w.pads[pos] = p;
  }
  return w;
}
function blankWork(name) {
  const w = { name, pads: {} };
  for (const pos of K.PAD_ORDER) w.pads[pos] = Object.assign(K.defaultPad(pos), { loc: 'card', reverb: 0, aKey: null, bKey: null });
  return w;
}
function copyWork(src, name) {
  const w = JSON.parse(JSON.stringify({ name, pads: src.pads }));
  w.raw = src.raw; return w;
}
const work = () => S.work[S.slot];
function getWork(n) {
  if (!S.work[n] && S.saved[n] && S.saved[n].kit) S.work[n] = toWork(S.saved[n].kit);
  return S.work[n];
}

function kitBytes(w) {
  const kit = { name: w.name, raw: w.raw, pads: {} };
  for (const pos of K.PAD_ORDER) {
    const p = w.pads[pos];
    const nm = key => { const it = key && S.lib.get(key); return it ? ensureTarget(it) : ''; };
    kit.pads[pos] = Object.assign({}, p, { a: p.loc === 'card' ? nm(p.aKey) : '', b: p.loc === 'card' ? nm(p.bKey) : '' });
  }
  return K.buildKit(kit);
}
function isDirty(n) {
  const w = S.work[n];
  if (!w) return false;
  const s = S.saved[n];
  if (!s || !s.kit) return true;
  const a = kitBytes(w), b = s.bytes;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}
function usedKeys(w) {
  const keys = new Set();
  if (!w) return keys;
  for (const pos of K.PAD_ORDER) {
    const p = w.pads[pos];
    if (p.loc !== 'card') continue;
    if (p.aKey) keys.add(p.aKey);
    if (p.bKey) keys.add(p.bKey);
  }
  return keys;
}
function kitMB(w) {
  let mb = 0;
  for (const pos of K.PAD_ORDER) {
    const p = w.pads[pos];
    if (p.loc !== 'card') continue;
    for (const k of [p.aKey, p.bKey]) { const it = k && S.lib.get(k); if (it) mb += Math.ceil(itemSize(it) / MB); }
  }
  return mb;
}

// ---------- listening ----------
const bufCache = new Map();
let reverbNode = null;
async function itemBytes(it) {
  if (it.bytes) return it.bytes;
  if (it.handle) return new Uint8Array(await (await it.handle.getFile()).arrayBuffer());
  throw new Error(`${it.disp} isn't on the card`);
}
async function bufferFor(key) {
  if (bufCache.has(key)) return bufCache.get(key);
  const it = S.lib.get(key);
  const d = await A.decode(await itemBytes(it), it.disp);
  const ctx = A.ctx();
  const b = ctx.createBuffer(d.chans.length, Math.max(1, d.chans[0].length), d.sr);
  d.chans.forEach((c, i) => b.copyToChannel(c, i));
  bufCache.set(key, b);
  if (bufCache.size > 60) bufCache.delete(bufCache.keys().next().value);
  return b;
}
function reverb(ctx) {
  if (reverbNode) return reverbNode;
  const len = Math.round(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  reverbNode = ctx.createConvolver(); reverbNode.buffer = ir; reverbNode.connect(ctx.destination);
  return reverbNode;
}
const voices = {};
async function play(key, pad, voiceId) {
  if (!key) return;
  const ctx = A.ctx();
  if (ctx.state !== 'running') await ctx.resume();
  let b;
  try { b = await bufferFor(key); } catch (e) { toast(e.message); return; }
  if (voiceId && voices[voiceId] && (!pad || pad.mode !== 0)) { try { voices[voiceId].stop(); } catch (e) {} }
  const src = ctx.createBufferSource(); src.buffer = b;
  const g = ctx.createGain(), pan = ctx.createStereoPanner();
  g.gain.value = pad ? Math.pow(pad.level / 10, 1.6) : 0.8;
  pan.pan.value = pad ? pad.pan / 4 : 0;
  if (pad && pad.tune) src.playbackRate.value = Math.pow(2, pad.tune / 12);
  if (pad && pad.mode === 2) src.loop = true;
  src.connect(g); g.connect(pan); pan.connect(ctx.destination);
  if (pad && pad.reverb) { const s = ctx.createGain(); s.gain.value = pad.reverb / 10 * 0.35; pan.connect(s); s.connect(reverb(ctx)); }
  src.start();
  if (voiceId) voices[voiceId] = src;
  if (pad && pad.mode === 2) setTimeout(() => { try { src.stop(); } catch (e) {} }, 4000);
}
function stopAll() { for (const k in voices) { try { voices[k].stop(); } catch (e) {} } }
function hitPad(pos, hard) {
  const w = work(); if (!w) return;
  const p = w.pads[pos];
  flash(pos);
  if (p.mode === 3) { stopAll(); return; }
  if (p.loc !== 'card') return;
  play(hard && p.bKey ? p.bKey : p.aKey || p.bKey, p, pos);
}
function flash(pos) {
  const e = document.querySelector(`.pad[data-pos="${pos}"]`);
  if (!e) return;
  e.classList.remove('hit'); void e.offsetWidth; e.classList.add('hit');
  setTimeout(() => e.classList.remove('hit'), 140);
}

// ---------- rendering ----------
function render() { renderTop(); renderSlots(); renderPads(); renderEditor(); renderLibrary(); renderMem(); }

function renderTop() {
  const n = S.lib.size ? [...S.lib.values()].filter(i => i.src === 'card').length : 0;
  const kits = Object.keys(S.saved).length;
  $('cardline').replaceChildren(h('b', { text: S.root ? (S.root.name || 'card') : '' }), h('br'),
    `${n} sounds on the card · ${kits} kit${kits === 1 ? '' : 's'}`);
}

function renderSlots() {
  const box = $('slots'); box.replaceChildren();
  for (let n = 1; n <= SLOTS; n++) {
    const s = S.saved[n], w = S.work[n];
    const name = w ? w.name : s && s.kit ? s.kit.name : s && s.error ? 'unreadable kit' : 'empty';
    box.append(h('button', { class: 'slot' + (n === S.slot ? ' on' : '') + (!s && !w ? ' empty' : ''), onclick: () => { S.slot = n; render(); } },
      h('span', { class: 'n', text: String(padKit(n)), title: kitFile(n) }), h('span', { class: 'nm', text: name }),
      isDirty(n) ? h('span', { class: 'dot', title: 'unsaved changes' }) : null));
  }
}

function padLabel(p) {
  if (p.loc !== 'card') return { text: p.inName || 'built-in', cls: 'int' };
  if (!p.aKey && !p.bKey) return { text: 'empty', cls: 'none' };
  const it = S.lib.get(p.aKey || p.bKey);
  return { text: it ? it.disp : '?', cls: it && it.src === 'missing' ? 'missing' : '' };
}
function padEl(pos, size) {
  const w = work(), p = w ? w.pads[pos] : null;
  const e = h('div', { class: 'pad' + (size ? ' ' + size : '') + (pos === S.sel ? ' sel' : ''), 'data-pos': pos, tabindex: 0 });
  if (!p) { e.append(h('div', { class: 'lbl', text: LABEL[pos] })); return e; }
  const l = padLabel(p), tags = [];
  if (p.loc !== 'card') tags.push(h('span', { class: 'tag int', text: 'built-in' }));
  if (p.loc === 'card' && p.bKey) tags.push(h('span', { class: 'tag b', text: 'hard hits: B' }));
  if (p.mode) tags.push(h('span', { class: 'tag', text: K.MODES[p.mode] || 'mode ' + p.mode }));
  if (p.mgrp) tags.push(h('span', { class: 'tag', text: 'group ' + p.mgrp }));
  e.append(h('div', { class: 'lbl' }, h('span', { text: LABEL[pos] }), h('span', { text: noteName(p.note) })),
    h('div', { class: 'snd ' + l.cls, text: l.text, title: l.text }), h('div', { class: 'tags' }, tags),
    h('i', { class: 'lvl', style: `width:${p.level * 10}%` }));
  e.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; S.sel = pos; hitPad(pos, ev.shiftKey); renderPadsSel(); renderEditor(); });
  e.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); S.sel = pos; hitPad(pos); renderPadsSel(); renderEditor(); } });
  dropTarget(e, (key) => assign(pos, 'a', key), (files) => importFiles(files, pos));
  return e;
}
function renderPadsSel() { document.querySelectorAll('.pad').forEach(e => e.classList.toggle('sel', e.dataset.pos === S.sel)); }

function renderPads() {
  const w = work();
  $('mainPads').replaceChildren(...MAIN.map(([pos, size]) => padEl(pos, size)));
  $('extraPads').replaceChildren(h('h4', { text: 'Pedal & extra pad inputs' }), ...EXTRA.map(pos => padEl(pos)));
  $('hatPads').replaceChildren(h('h4', { text: 'Hi-hat pedal positions (only used with a hi-hat pedal)' }), ...HATS.map(pos => padEl(pos)));
  const lcd = $('lcd');
  if (!w) {
    lcd.replaceChildren(h('div', { text: `KIT ${padKit(S.slot)}  —  EMPTY` }), h('small', { text: `${kitFile(S.slot)} isn't on the card yet` }));
  } else {
    const inp = h('input', { class: 'kitname', value: w.name, maxLength: 8, spellcheck: false, title: 'kit name (letters and numbers, up to 8)' });
    inp.addEventListener('input', () => {
      const v = inp.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
      if (v !== inp.value) inp.value = v;
      w.name = v || 'KIT'; renderSlots(); $('bootName').textContent = w.name;
    });
    lcd.replaceChildren(h('div', {}, 'KIT ', inp), h('small', { text: `kit ${padKit(S.slot)} on the pad · ${kitFile(S.slot)}${isDirty(S.slot) ? ' · not saved yet' : ''}` }));
  }
  $('bootName').textContent = w ? w.name : 'it';
}

function renderMem() {
  const w = work(), mb = w ? kitMB(w) : 0;
  const bar = $('membar');
  bar.firstChild.style.width = Math.min(100, mb / KIT_MB * 100) + '%';
  bar.classList.toggle('full', mb > KIT_MB);
  $('memtext').textContent = w ? (mb > KIT_MB ? `about ${mb} MB of sounds: too big, the pad holds ${KIT_MB} MB per kit`
    : `about ${mb} of ${KIT_MB} MB · smaller kits load faster at power-on`) : '';
  $('memtext').className = 'memtext' + (mb > KIT_MB ? ' bad' : '');
}

function slider(label, min, max, val, fmt, on) {
  const out = h('output', { text: fmt(val) });
  const inp = h('input', { type: 'range', min, max, step: 1, value: val });
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); on(+inp.value); });
  return h('div', { class: 'ctl' }, h('label', { text: label }), inp, out);
}
function changed() { renderPads(); renderSlots(); renderMem(); }

function layerBox(pos, layer) {
  const p = work().pads[pos], key = layer === 'a' ? p.aKey : p.bKey, it = key && S.lib.get(key);
  const box = h('div', { class: 'layer' },
    h('div', { class: 't', text: layer === 'a' ? 'Sound' : 'Hard hits play (optional)' }),
    h('div', { class: 'row' },
      h('button', { class: 'small', text: '▶', disabled: !it, title: 'listen', onclick: () => play(key, p, pos) }),
      h('span', { class: 'nm' + (it ? '' : ' none'), text: it ? it.disp + (it.src === 'missing' ? ' (not on the card!)' : '') : 'drag a sound here' }),
      it ? h('button', { class: 'small', text: '✕', title: 'remove', onclick: () => assign(pos, layer, null) }) : null));
  dropTarget(box, k => assign(pos, layer, k), files => importFiles(files, pos, layer));
  return box;
}

function builtinOptions(p) {
  const seen = new Map();
  for (const b of S.builtins || []) seen.set(b.i, b.name);
  for (const n in S.saved) { const k = S.saved[n].kit; if (k) for (const pos in k.pads) { const q = k.pads[pos]; if (q.loc === 'int' && !seen.has(q.inIdx)) seen.set(q.inIdx, q.inName); } }
  if (!seen.has(p.inIdx)) seen.set(p.inIdx, p.inName);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]);
}

function renderEditor() {
  const ed = $('editor'), w = work();
  if (!w) {
    const others = Object.keys(S.saved).map(Number).filter(n => S.saved[n].kit || S.work[n]);
    const sel = h('select', {}, others.map(n => h('option', { value: n, text: `kit ${padKit(n)} ${(getWork(n) || {}).name}` })));
    ed.replaceChildren(h('h2', { text: `Kit ${padKit(S.slot)} is empty` }),
      h('p', { class: 'help', text: 'Start a kit here. It goes onto the card when you press Save.' }),
      h('button', { class: 'go', text: 'Start a blank kit', onclick: () => { S.work[S.slot] = blankWork('KIT' + padKit(S.slot)); render(); } }),
      others.length ? h('div', { style: 'margin-top:12px;display:flex;gap:6px' }, sel,
        h('button', { text: 'Copy that kit here', onclick: () => { const src = getWork(+sel.value); S.work[S.slot] = copyWork(src, (src.name + padKit(S.slot)).slice(0, 8)); render(); } })) : null);
    return;
  }
  const pos = S.sel, p = w.pads[pos];
  const card = p.loc === 'card';
  const kids = [h('h2', { text: LABEL[pos] }), h('div', { class: 'sub', text: `sends MIDI note ${p.note} (${noteName(p.note)}) · click a pad to hear it, shift-click for a hard hit` }),
    h('div', { class: 'srcpick' },
      h('button', { class: card ? 'on' : '', text: 'Card sound', onclick: () => { p.loc = 'card'; changed(); renderEditor(); renderLibrary(); } }),
      h('button', { class: card ? '' : 'on', text: 'Built-in sound', onclick: () => { p.loc = 'int'; changed(); renderEditor(); renderLibrary(); } }))];
  if (card) {
    kids.push(layerBox(pos, 'a'), layerBox(pos, 'b'));
    if (p.bKey) {
      const split = p.bVmin || 100;
      kids.push(slider('Hard from', 1, 127, split, v => v, v => { p.bVmin = v; p.bVmax = 127; p.aVmin = 0; p.aVmax = v - 1; changed(); }),
        h('p', { class: 'help', text: 'Hits at or above this velocity (1–127) play the second sound.' }));
    }
  } else {
    const opts = builtinOptions(p);
    const sel = h('select', {}, opts.map(([i, n]) => { const d = PB.describe(n); return h('option', { value: i, text: `${i}  ${n}${d ? '  (' + d + ')' : ''}`, selected: i === p.inIdx }); }));
    sel.addEventListener('change', () => { p.inIdx = +sel.value; p.inName = opts.find(o => o[0] === p.inIdx)[1]; changed(); });
    kids.push(h('div', { class: 'builtin' }, sel),
      h('p', { class: 'help', text: S.builtins ? `All ${S.builtins.length} of the pad's own sounds. They only play on the pad itself, so you can't hear them here.` :
        'These are the built-in sounds your kits already use. They only play on the pad itself.' }),
      S.builtins ? null : h('button', { class: 'small', text: 'Find all built-in sound names on the card', title: 'reads the pad\'s update file (LDSP_UPD.DAT) on the card; takes a few seconds over USB', onclick: findBuiltins }));
  }
  kids.push(
    slider('Level', 0, 10, p.level, v => v, v => { p.level = v; changed(); }),
    slider('Tune', -4, 4, p.tune, v => (v > 0 ? '+' : '') + v, v => { p.tune = v; changed(); }),
    slider('Pan', -4, 4, p.pan, v => v < 0 ? 'L' + -v : v > 0 ? 'R' + v : 'CTR', v => { p.pan = v; changed(); }),
    slider('Reverb', 0, 10, p.reverb, v => v, v => { p.reverb = v; changed(); }));
  const mode = h('select', {}, K.MODES.map((m, i) => h('option', { value: i, text: m, selected: i === p.mode })));
  const modeHelp = h('p', { class: 'help', text: MODE_HELP[p.mode] || '' });
  if (p.mode >= K.MODES.length) mode.append(h('option', { value: p.mode, text: 'mode ' + p.mode, selected: true }));
  mode.addEventListener('change', () => { p.mode = +mode.value; modeHelp.textContent = MODE_HELP[p.mode] || ''; changed(); });
  const grp = h('select', {}, [h('option', { value: 0, text: 'none', selected: !p.mgrp })].concat(
    Array.from({ length: 16 }, (_, i) => h('option', { value: i + 1, text: 'group ' + (i + 1), selected: p.mgrp === i + 1 }))));
  grp.addEventListener('change', () => { p.mgrp = +grp.value; changed(); });
  kids.push(h('div', { class: 'ctl' }, h('label', { text: 'Mode' }), mode, h('span')), modeHelp,
    h('div', { class: 'ctl' }, h('label', { text: 'Mute group' }), grp, h('span')),
    h('p', { class: 'help', text: 'Pads in the same mute group cut each other off (like an open and closed hi-hat).' }),
    h('button', { class: 'small', text: 'Use this level & reverb on every pad', onclick: () => {
      for (const q of Object.values(w.pads)) { q.level = p.level; q.reverb = p.reverb; } changed(); toast('Level and reverb copied to every pad.'); } }));
  const num = (label, val, min, max, on, help) => {
    const i = h('input', { type: 'number', min, max, value: val, style: 'width:80px' });
    i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Math.round(+i.value || 0))); i.value = v; on(v); changed(); });
    return h('div', { class: 'ctl' }, h('label', { text: label }), i, h('span', { class: 'dim', style: 'font-size:12px', text: help || '' }));
  };
  kids.push(h('details', {}, h('summary', { text: 'More settings' }),
    num('MIDI note', p.note, 0, 127, v => { p.note = v; }),
    num('Sens (raw)', p.sens, 0, 255, v => { p.sens = v; }, 'pad\'s own'),
    h('p', { class: 'help', text: 'Sensitivity is stored in the kit as a raw number (kits the pad saves itself use 16). Leave it unless you know what you want.' }),
    card ? num('A vel min', p.aVmin, 0, 127, v => { p.aVmin = v; }) : null,
    card ? num('A vel max', p.aVmax, 0, 127, v => { p.aVmax = v; }) : null,
    card && p.bKey ? num('B vel min', p.bVmin, 0, 127, v => { p.bVmin = v; }) : null,
    card && p.bKey ? num('B vel max', p.bVmax, 0, 127, v => { p.bVmax = v; }) : null));
  ed.replaceChildren(...kids);
}

function itemSub(it) {
  if (it.src === 'missing') return { text: 'a kit uses this but it isn\'t on the card', cls: 'bad' };
  if (it.src === 'new') return { text: `new · ${it.ch === 1 ? 'mono' : 'stereo'} ${it.sr / 1000}k · ${mbText(it.bytes.length)} · will be ${ensureTarget(it)}.WAV`, cls: 'fix' };
  const parts = [A.describe(it.info), mbText(it.size)];
  if (!it.ready) return { text: `${parts[0]} · gets converted when used`, cls: 'fix' };
  if (!it.legal) return { text: `${parts.join(' · ')} · long name, saved as ${ensureTarget(it)}.WAV when used`, cls: 'fix' };
  return { text: (it.copyOf ? `on card as ${it.file} · ` : '') + parts.join(' · '), cls: '' };
}
function visibleItems() {
  const used = usedKeys(work()), q = S.q.trim().toLowerCase();
  return [...S.lib.values()].filter(it => !it.hidden)
    .filter(it => S.filter === 'used' ? used.has(it.key) : S.filter === 'new' ? it.src === 'new' : it.src !== 'missing' || used.has(it.key))
    .filter(it => !q || q.split(',').some(alt => alt.trim() && alt.trim().split(/\s+/).every(t => (it.disp + ' ' + (it.file || '')).toLowerCase().includes(t))))
    .sort((a, b) => natural(a.disp, b.disp));
}
function renderLibrary() {
  const used = usedKeys(work()), items = visibleItems();
  const list = $('list');
  list.replaceChildren(...items.map(it => {
    const sub = itemSub(it);
    const row = h('div', { class: 'item' + (used.has(it.key) ? ' used' : ''), draggable: it.src !== 'missing', title: 'drag onto a pad · double-click to put it on the selected pad' },
      h('button', { class: 'pl', text: '▶', disabled: it.src === 'missing', onclick: ev => { ev.stopPropagation(); play(it.key, null, 'lib'); } }),
      h('div', { class: 'nm' }, h('div', { text: it.disp }), h('small', { class: sub.cls, text: sub.text })));
    row.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/x-paddock', it.key); ev.dataTransfer.effectAllowed = 'copy'; });
    row.addEventListener('dblclick', () => { if (work()) assign(S.sel, 'a', it.key); });
    return row;
  }));
  if (!items.length) list.append(h('div', { class: 'dim', text: S.filter === 'new' ? 'No new sounds yet. Drop some audio files on the page.' : 'Nothing matches.' }));
}

// ---------- editing ----------
function assign(pos, layer, key) {
  const w = work(); if (!w) return;
  const p = w.pads[pos];
  if (key) p.loc = 'card';
  if (layer === 'b' && key && !p.aKey) layer = 'a';
  if (layer === 'a') p.aKey = key; else p.bKey = key;
  if (layer === 'a' && !key && p.bKey) { p.aKey = p.bKey; p.bKey = null; }
  if (p.bKey) { if (!(p.bVmin > 0)) { p.bVmin = 100; p.bVmax = 127; p.aVmin = 0; p.aVmax = 99; } }
  else { p.aVmin = 0; p.aVmax = 127; p.bVmin = 0; p.bVmax = 127; }
  S.sel = pos;
  if (key) play(key, p, pos);
  render();
}

function dropTarget(el, onKey, onFiles) {
  el.addEventListener('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', ev => {
    ev.preventDefault(); ev.stopPropagation(); el.classList.remove('over'); document.body.classList.remove('dragging');
    if (!work()) { toast('Start a kit here first.'); return; }
    const key = ev.dataTransfer.getData('text/x-paddock');
    if (key) onKey(key); else if (ev.dataTransfer.files.length) onFiles([...ev.dataTransfer.files]);
  });
}

async function importFiles(files, pos, layer) {
  files = files.filter(f => !/\.(kit|txt|json|pdf|jpg|png)$/i.test(f.name));
  if (!files.length) return;
  setStatus(`adding ${files.length} sound${files.length > 1 ? 's' : ''}…`);
  const added = [], bad = [];
  for (const f of files) {
    try {
      const r = await A.prepare(new Uint8Array(await f.arrayBuffer()), f.name, { trim: true, fold: true });
      const it = { key: 'n:' + (++S.seq), src: 'new', disp: f.name.replace(/\.[^.]*$/, ''), bytes: r.bytes, size: r.bytes.length,
        ch: r.ch, sr: r.sr, info: A.wavInfo(r.bytes), ready: true, legal: true, notes: r.notes };
      ensureTarget(it);
      S.lib.set(it.key, it); added.push(it);
    } catch (e) { bad.push(`${f.name}: ${e.message}`); }
  }
  setStatus(`added ${added.length} sound${added.length === 1 ? '' : 's'}` + (bad.length ? `, ${bad.length} couldn't be read` : ''), bad.length ? 'err' : '');
  if (bad.length) log(bad.join('\n'));
  if (added.length && pos) assign(pos, layer || 'a', added[0].key);
  else { if (added.length && S.filter !== 'all') S.filter = 'new'; render(); setChips(); }
  const notes = added.flatMap(a => a.notes.length ? [`${a.disp}: ${a.notes.join(', ')}`] : []);
  if (notes.length) log(notes.join('\n'));
}

// names → roles → pads
const ROLES = [
  ['kick', /kick|bassdrum|bass ?drum|\bbd\b|boom/],
  ['hatc', /(hat|hh).*(cl|closed|chk|pedal)|closed ?hat/],
  ['hato', /(hat|hh).*(op|open)|open ?hat/],
  ['hat', /hat|\bhh/],
  ['snare', /snare|\bsn\b|snr/],
  ['clap', /clap|snap/],
  ['crash', /crash|china|cym|splash/],
  ['ride', /ride/],
  ['tom', /tom|darbuka|djembe|udu|conga|bongo|tam\d|\btam\b/],
  ['rim', /rim|stick|click/],
];
function roleOf(name) {
  const n = name.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2');
  for (const [r, re] of ROLES) if (re.test(n) || re.test(name.toLowerCase())) return r;
  return 'other';
}
function autoPlace() {
  const w = work();
  if (!w) { toast('Start a kit here first.'); return; }
  const items = visibleItems().filter(it => it.src !== 'missing');
  if (!items.length) { toast('No sounds in the list to place. Search for some first (try "cajon").'); return; }
  const by = {};
  for (const it of items) (by[roleOf(it.disp)] = by[roleOf(it.disp)] || []).push(it);
  const take = r => (by[r] && by[r].length ? by[r].shift() : null);
  const plan = {};
  const put = (pos, it) => { if (it && !plan[pos]) plan[pos] = it; };
  put('pad_06', take('kick')); put('pad_07', take('snare') || take('clap'));
  put('pad_08', take('hatc') || take('hat')); put('pad_05', take('hato') || take('hat'));
  put('pad_01', take('crash')); put('pad_02', take('ride') || take('crash'));
  put('pad_03', take('tom')); put('pad_04', take('tom'));
  const rest = ['tom', 'rim', 'snare', 'clap', 'kick', 'hat', 'hatc', 'hato', 'crash', 'ride', 'other'].flatMap(r => by[r] || []);
  for (const [pos] of MAIN) if (!plan[pos] && rest.length) plan[pos] = rest.shift();
  let n = 0;
  for (const [pos] of MAIN) {
    const p = w.pads[pos], it = plan[pos];
    if (!it) continue;
    Object.assign(p, { loc: 'card', aKey: it.key, bKey: null, aVmin: 0, aVmax: 127, bVmin: 0, bVmax: 127 });
    const r = roleOf(it.disp);
    if (pos === 'pad_05' || pos === 'pad_08') { p.mode = r.startsWith('hat') ? 1 : p.mode; p.mgrp = r.startsWith('hat') ? 1 : 0; }
    n++;
  }
  if (plan.pad_06 && w.pads.kick.loc === 'card' && !w.pads.kick.aKey) Object.assign(w.pads.kick, { aKey: plan.pad_06.key });
  render();
  toast(n ? `Placed ${n} sound${n > 1 ? 's' : ''}: kicks bottom left, snare in the middle, hats on the right. Tweak away.` : 'Nothing placed.');
}

// ---------- saving ----------
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
async function writeFile(dir, name, bytes) {
  const fh = await dir.getFileHandle(name, { create: true });
  const wr = await fh.createWritable();
  await wr.write(bytes); await wr.close();
  const f = await fh.getFile();
  if (f.size !== bytes.length) throw new Error(`${name} came out ${f.size} bytes instead of ${bytes.length}`);
  return fh;
}
function prog(frac) { $('prog').classList.toggle('hidden', frac == null); if (frac != null) $('prog').firstChild.style.width = Math.round(frac * 100) + '%'; }

async function save() {
  const w = work();
  if (!w || S.busy) return;
  const n = S.slot;
  const keys = [...usedKeys(w)].map(k => S.lib.get(k));
  const missing = keys.filter(it => it.src === 'missing');
  const toWrite = keys.filter(it => it && needsWrite(it));
  const files = [...S.lib.values()].filter(i => i.src === 'card').length;
  if (files + toWrite.length > MAX_FILES) { setStatus(`The card would have more than ${MAX_FILES} sounds in its main folder, which the pad can't handle.`, 'err'); return; }
  if (kitMB(w) > KIT_MB) { setStatus(`This kit has about ${kitMB(w)} MB of sounds; the pad only loads ${KIT_MB} MB per kit. Try "Make this kit load faster" or use shorter sounds.`, 'err'); return; }
  if (S.root.requestPermission) {
    const perm = await S.root.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { setStatus('PADDOCK needs your OK to write to the card. Nothing was changed.', 'err'); return; }
  }
  S.busy = true; $('saveBtn').disabled = true; $('log').textContent = '';
  try {
    const total = toWrite.length + 3; let step = 0;
    const tick = () => prog(++step / total);
    prog(0);
    const pd = await S.root.getDirectoryHandle('PADDOCK', { create: true });
    if (!S.backedUp) {
      const bd = await (await pd.getDirectoryHandle('backups', { create: true })).getDirectoryHandle(stamp(), { create: true });
      let c = 0;
      for (const k in S.saved) { await writeFile(bd, S.saved[k].file, S.saved[k].bytes); c++; }
      S.backedUp = true;
      log(`backed up ${c} kit${c === 1 ? '' : 's'} to PADDOCK\\backups\\${bd.name}`);
    }
    tick();
    for (const it of toWrite) {
      const name = ensureTarget(it) + '.WAV';
      setStatus(`writing ${name}…`);
      let bytes;
      if (it.src === 'new') bytes = it.bytes;
      else if (it.ready) bytes = await itemBytes(it);
      else bytes = (await A.prepare(await itemBytes(it), it.disp, { trim: false, fold: true })).bytes;
      const fh = await writeFile(S.root, name, bytes);
      S.names[baseOf(name).toLowerCase()] = it.src === 'new' ? it.disp : it.file;
      if (it.src === 'new') {
        Object.assign(it, { src: 'card', file: name, handle: fh, size: bytes.length, bytes: null, info: A.wavInfo(bytes.subarray(0, 4096)), ready: true, legal: true, copyOf: it.disp });
      } else {
        const copy = { key: 'c:' + name.toLowerCase(), src: 'card', file: name, handle: fh, size: bytes.length, info: A.wavInfo(bytes.subarray(0, 4096)),
          ready: true, legal: true, disp: it.disp, copyOf: it.file, target: baseOf(name) };
        S.lib.set(copy.key, copy); it.hidden = true; it.replacedBy = copy.key;
        for (const wk of Object.values(S.work)) for (const p of Object.values(wk.pads)) {
          if (p.aKey === it.key) p.aKey = copy.key;
          if (p.bKey === it.key) p.bKey = copy.key;
        }
      }
      log(`wrote ${name} (${mbText(bytes.length)})`);
      tick();
    }
    if (toWrite.length) await writeFile(pd, 'names.json', new TextEncoder().encode(JSON.stringify({ app: 'PADDOCK', names: S.names }, null, 1)));
    tick();
    if (!S.kitsDir) S.kitsDir = await S.root.getDirectoryHandle('KITS', { create: true });
    const bytes = kitBytes(w), file = kitFile(n);
    setStatus(`writing ${file}…`);
    const fh = await writeFile(S.kitsDir, file, bytes);
    const back = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error(`${file} didn't read back the same. Try saving again.`);
    const kit = K.parseKit(back);
    S.saved[n] = { kit, bytes: back, file };
    w.raw = kit.raw;
    tick(); prog(null);
    log(`wrote KITS\\${file} and read it back: identical`);
    setStatus(`And they're off! "${w.name}" is saved as kit ${padKit(n)}${toWrite.length ? ` with ${toWrite.length} new sound file${toWrite.length > 1 ? 's' : ''}` : ''}.` +
      (missing.length ? ` (${missing.length} sound${missing.length > 1 ? 's' : ''} this kit points to ${missing.length > 1 ? 'aren\'t' : 'isn\'t'} on the card.)` : ''), 'ok');
    render();
  } catch (e) {
    prog(null);
    setStatus('Save stopped: ' + e.message + ' Your old kit is still in PADDOCK\\backups.', 'err');
  } finally { S.busy = false; $('saveBtn').disabled = false; }
}

async function lighten() {
  const w = work(); if (!w || S.busy) return;
  S.busy = true; let saved = 0, made = 0; $('log').textContent = '';
  try {
    const keys = [...usedKeys(w)].map(k => S.lib.get(k)).filter(it => it && it.src !== 'missing');
    for (const it of keys) {
      setStatus(`looking at ${it.disp}…`);
      const before = itemSize(it);
      const r = await A.prepare(await itemBytes(it), it.disp, { trim: true, fold: true });
      if (r.bytes.length > before * 0.9 || before - r.bytes.length < 16384) continue;
      saved += before - r.bytes.length; made++;
      if (it.src === 'new') { it.bytes = r.bytes; it.size = r.bytes.length; it.ch = r.ch; it.sr = r.sr; it.notes = r.notes; continue; }
      const nu = { key: 'n:' + (++S.seq), src: 'new', disp: it.disp + ' lite', bytes: r.bytes, size: r.bytes.length, ch: r.ch, sr: r.sr,
        info: A.wavInfo(r.bytes), ready: true, legal: true, notes: r.notes };
      ensureTarget(nu); S.lib.set(nu.key, nu);
      for (const p of Object.values(w.pads)) { if (p.aKey === it.key) p.aKey = nu.key; if (p.bKey === it.key) p.bKey = nu.key; bufCache.delete(nu.key); }
      log(`${it.disp}: ${mbText(before)} → ${mbText(r.bytes.length)} (${r.notes.join(', ')})`);
    }
    setStatus(made ? `Made ${made} lighter cop${made > 1 ? 'ies' : 'y'}, ${mbText(saved)} smaller. Your originals stay on the card. Press Save to put them on it.` :
      'This kit is already as light as it gets without changing the sound.', made ? 'ok' : '');
    render();
  } catch (e) { setStatus(e.message, 'err'); }
  finally { S.busy = false; }
}

async function findBuiltins() {
  const known = new Map();
  for (const n in S.saved) { const k = S.saved[n].kit; if (k) for (const pos in k.pads) { const q = k.pads[pos]; if (q.loc === 'int' && q.inName) known.set(q.inIdx, q.inName); } }
  if (known.size < 3) { toast('Your kits need to use a few built-in sounds first, so PADDOCK can check the list.'); return; }
  for (const f of ['LDSP_UPD.DAT', 'LDSP2UPD.DAT']) {
    let u8;
    try { setStatus(`reading ${f}… (a few seconds over USB)`); u8 = new Uint8Array(await (await (await S.root.getFileHandle(f)).getFile()).arrayBuffer()); }
    catch (e) { continue; }
    const list = PB.extract(u8, known);
    if (list) { S.builtins = list; store.set('paddock.builtins', list); setStatus(`Found ${list.length} built-in sounds.`, 'ok'); renderEditor(); return; }
  }
  setStatus('Couldn\'t find the built-in sound list on this card. You can still pick the ones your kits use.', 'err');
}

// ---------- bits ----------
function setStatus(t, cls) { const s = $('status'); s.textContent = t; s.className = 'status' + (cls ? ' ' + cls : ''); }
function log(t) { const l = $('log'); l.textContent += (l.textContent ? '\n' : '') + t; l.scrollTop = 1e9; }
let toastT;
function toast(t) {
  let e = document.querySelector('.toast');
  if (!e) { e = h('div', { class: 'toast' }); document.body.append(e); }
  e.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => e.remove(), 4200);
}
function setChips() { document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b.dataset.f === S.filter)); }

async function openRoot(root) {
  S.root = root;
  $('welcome').classList.add('hidden'); $('app').classList.remove('hidden');
  await scanCard(root);
  const kits = Object.keys(S.saved).map(Number).sort((a, b) => a - b);
  S.slot = kits.length ? kits[0] : 1;
  getWork(S.slot);
  const bad = Object.values(S.saved).filter(s => s.error);
  if (!S.kitsDir && !S.lib.size) {
    setStatus('This folder has no KITS folder and no WAV files, so it doesn\'t look like a SamplePad card. Click the card name at the top right to pick another one.', 'err');
    render(); return;
  }
  setStatus(`Card read: ${[...S.lib.values()].filter(i => i.src === 'card').length} sounds, ${kits.length} kit${kits.length === 1 ? '' : 's'}.` +
    (bad.length ? ` ${bad.length} kit file${bad.length > 1 ? 's' : ''} couldn't be read and won't be touched.` : '') +
    (S.otherKits ? ` (${S.otherKits} other kit file${S.otherKits > 1 ? 's' : ''} left alone.)` : ''));
  render();
}
S.openRoot = openRoot;
Object.assign(S, { importFiles: (f, p, l) => importFiles(f, p, l), assign: (...a) => assign(...a), save: () => save(), autoPlace: () => autoPlace(), lighten: () => lighten(), kitBytes: w => kitBytes(w), getWork: n => getWork(n), render: () => render() });

function init() {
  if (!window.showDirectoryPicker) { $('noFsa').classList.remove('hidden'); $('openBtn').disabled = true; }
  $('openBtn').onclick = async () => {
    try { await openRoot(await window.showDirectoryPicker({ id: 'samplepad', mode: 'read' })); }
    catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  };
  $('cardline').onclick = () => { if (S.root && !S.busy) $('openBtn').click(); };
  $('search').addEventListener('input', ev => { S.q = ev.target.value; renderLibrary(); });
  $('chips').addEventListener('click', ev => { const f = ev.target.dataset.f; if (f) { S.filter = f; setChips(); renderLibrary(); } });
  $('addBtn').onclick = () => $('fileIn').click();
  $('fileIn').onchange = ev => { importFiles([...ev.target.files]); ev.target.value = ''; };
  $('autoBtn').onclick = autoPlace;
  $('saveBtn').onclick = save;
  $('lightBtn').onclick = lighten;
  $('revertBtn').onclick = () => {
    const s = S.saved[S.slot];
    S.work[S.slot] = s && s.kit ? toWork(s.kit) : undefined;
    setStatus('Back to what\'s on the card.'); render();
  };
  document.addEventListener('dragover', ev => { if (ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', ev => { if (!ev.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', ev => {
    document.body.classList.remove('dragging');
    if (!ev.dataTransfer.files.length) return;
    ev.preventDefault();
    if (S.root) importFiles([...ev.dataTransfer.files]);
  });
  document.addEventListener('keydown', ev => {
    if (!S.root || ev.target.closest('input,select,textarea') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const d = '12345678'.indexOf(ev.key);
    if (d >= 0) { const pos = MAIN[d][0]; S.sel = pos; hitPad(pos, ev.shiftKey); renderPadsSel(); renderEditor(); }
  });
  window.addEventListener('beforeunload', ev => { for (let n = 1; n <= SLOTS; n++) if (isDirty(n)) { ev.preventDefault(); ev.returnValue = ''; return; } });
  $('midiBtn').onclick = async () => {
    if (!navigator.requestMIDIAccess) { toast('This browser has no MIDI. Use Chrome or Edge.'); return; }
    try {
      const m = await navigator.requestMIDIAccess();
      const hook = () => { let c = 0; m.inputs.forEach(i => { i.onmidimessage = onMidi; c++; }); return c; };
      m.onstatechange = hook;
      const c = hook();
      $('midiBtn').textContent = c ? `listening to ${c} MIDI input${c > 1 ? 's' : ''}` : 'no MIDI found yet (plug the pad in normally)';
    } catch (e) { toast('MIDI not allowed: ' + e.message); }
  };
}
function onMidi(e) {
  const [st, note, vel] = e.data;
  if ((st & 0xf0) !== 0x90 || !vel) return;
  const w = work(); if (!w) return;
  const pos = ORDER.find(p => w.pads[p].note === note);
  if (!pos) return;
  S.sel = pos; flash(pos); renderPadsSel(); renderEditor();
}

init();
})();
