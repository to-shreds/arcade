#!/usr/bin/env python3
"""Build a verified, reproducible static web release without credentials or test output."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'offline-manifest.json').read_text())
paths = {entry['path'] for entry in manifest['files']}
for entry in manifest['files']:
    path = root / entry['path']
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise SystemExit(f"Unsafe archive entry: {entry['path']}")
    data = path.read_bytes()
    if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise SystemExit(f"Stale offline manifest: {entry['path']}")
paths.update(['offline-manifest.json', 'README.md', 'CHANGELOG.md', 'HANDOFF.md'])
paths.update(str(path.relative_to(root)) for path in (root / 'licenses').rglob('*') if path.is_file())
paths.update(str(path.relative_to(root)) for path in (root / 'docs').glob('arcade-stress-test-*.md'))
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(paths):
        item = zipfile.ZipInfo(name, date_time=(2026, 10, 8, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = 0o100644 << 16
        archive.writestr(item, (root / name).read_bytes())
    item = zipfile.ZipInfo('START-HERE.txt', date_time=(2026, 10, 8, 0, 0, 0))
    item.compress_type = zipfile.ZIP_DEFLATED
    item.external_attr = 0o100644 << 16
    archive.writestr(item, 'Family Arcade 2.6.0 web release\n\nExtract this folder and serve it over HTTP or HTTPS. For a local preview:\n  python3 -m http.server 8080\nThen open http://localhost:8080/ in a browser.\n\nInternet rooms use the existing public Arcade Worker. Nearby pairing uses the\nArcade Connect Devices flow. Prepare Make Available Offline before losing\nInternet access. Camera permissions require HTTPS or localhost.\n\nFull source and deployment configuration:\nhttps://github.com/to-shreds/arcade\nLive Arcade:\nhttps://to-shreds.github.io/arcade/\n\nSee README.md and docs/arcade-stress-test-2.6.0.md for supported play and tests. TV requires Internet and a TorBox account.\n')
with zipfile.ZipFile(args.output) as archive:
    assert archive.testzip() is None
    for entry in manifest['files']:
        data = archive.read(entry['path'])
        assert len(data) == entry['bytes']
        assert hashlib.sha256(data).hexdigest() == entry['sha256']
print(json.dumps({'path': str(args.output.resolve()), 'files': len(paths) + 1, 'bytes': args.output.stat().st_size, 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(), 'release': manifest['version']}))
