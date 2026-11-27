// Round-trip check for kit.js:  node test/roundtrip.js path/to/USER_001.KIT
// Reads a kit the pad saved, writes it back two ways (on top of the original bytes, and from
// scratch), and both must come out byte-for-byte identical.
const fs = require('fs'); const K = require('../src/kit.js');
if (!process.argv[2]) { console.log('usage: node test/roundtrip.js USER_001.KIT'); process.exit(1); }
const raw = fs.readFileSync(process.argv[2]);
const kit = K.parseKit(raw);
console.log('kit', JSON.stringify(kit.name), 'checksum ok:', kit.checksumOk);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
console.log('rewritten on top of the original:', same(K.buildKit(kit), raw) ? 'identical' : 'DIFFERENT');
const fresh = K.buildKit({ name: kit.name, pads: JSON.parse(JSON.stringify(kit.pads)) });
const diffs = []; for (let i = 0; i < raw.length; i++) if (raw[i] !== fresh[i]) diffs.push('0x' + i.toString(16));
console.log('written from scratch:', diffs.length ? 'DIFFERENT at ' + diffs.slice(0, 20).join(' ') : 'identical');
