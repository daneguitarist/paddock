#!/usr/bin/env python3
"""Put PADDOCK.html together from src/: page.html + kit.js + audio.js + builtins + page.js, all in one file.
    build.py OUT.html [builtins.json]"""
import json, sys
from pathlib import Path
src = Path(__file__).parent / 'src'
out = Path(sys.argv[1])
builtins = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else []
html = (src / 'page.html').read_text()
parts = {'/*KIT*/': (src / 'kit.js').read_text(), '/*AUDIO*/': (src / 'audio.js').read_text(),
         '/*BUILTINS*/': 'window.BUILTINS = ' + json.dumps(builtins, separators=(',', ':')) + ';',
         '/*BUILTINSJS*/': (src / 'builtins.js').read_text(),
         '/*PAGE*/': (src / 'page.js').read_text()}
for k, v in parts.items():
    assert html.count(k) == 1, k
    html = html.replace(k, v.replace('</script', '<\\/script'))
out.write_text(html, encoding='utf-8')
print(f'{out}: {len(html.encode()) / 1e3:.0f} KB, {len(builtins)} built-in sounds')
