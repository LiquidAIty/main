"""Build the one checksum-pinned LumiBot MCP-2 compatibility wheel; no installation."""
# Entity: Trading
# Relationship: Applies the isolated vendor patch to the verified upstream wheel and rebuilds RECORD deterministically for both Windows and Oracle packaging.
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile


def build(upstream: Path | None = None, output: Path | None = None) -> Path:
    owner = Path(__file__).resolve().parent
    spec = json.loads((owner / 'mcp2.patch.json').read_text(encoding='utf-8'))
    if upstream:
        raw = upstream.read_bytes()
    else:
        with urllib.request.urlopen('https://pypi.org/pypi/lumibot/' + spec['upstreamVersion'] + '/json', timeout=30) as response:
            metadata = json.load(response)
        candidate = next(row for row in metadata['urls'] if row['filename'].endswith('.whl')
                         and row['digests']['sha256'] == spec['wheelSha256'])
        if not candidate['url'].startswith('https://files.pythonhosted.org/'):
            raise ValueError('Unexpected upstream wheel host')
        with urllib.request.urlopen(candidate['url'], timeout=60) as response:
            raw = response.read()
    if hashlib.sha256(raw).hexdigest() != spec['wheelSha256']:
        raise ValueError('Upstream wheel SHA-256 mismatch; no patch applied')
    source = zipfile.ZipFile(io.BytesIO(raw))
    modified = {}
    for edit in spec['edits']:
        name = edit['file']
        body = modified.get(name, source.read(name).decode('utf-8'))
        if body.count(edit['before']) != 1:
            raise ValueError(f'Patch context is not unique: {name}')
        modified[name] = body.replace(edit['before'], edit['after'], 1)
    original_dist = 'lumibot-' + spec['upstreamVersion'] + '.dist-info/'
    target_dist = 'lumibot-' + spec['version'] + '.dist-info/'
    target_dir = output or owner / 'dist'
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / ('lumibot-' + spec['version'] + '-py3-none-any.whl')
    records = []
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as wheel:
        for info in sorted(source.infolist(), key=lambda item: item.filename):
            if info.filename == original_dist + 'RECORD':
                continue
            body = modified[info.filename].encode('utf-8') if info.filename in modified else source.read(info.filename)
            name = info.filename.replace(original_dist, target_dist, 1)
            entry = zipfile.ZipInfo(name, date_time=info.date_time)
            entry.create_system = info.create_system
            entry.external_attr = info.external_attr
            entry.compress_type = zipfile.ZIP_DEFLATED
            wheel.writestr(entry, body)
            digest = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b'=').decode()
            records.append([name, 'sha256=' + digest, str(len(body))])
        record_name = target_dist + 'RECORD'
        records.append([record_name, '', ''])
        record = io.StringIO(newline='')
        csv.writer(record, lineterminator='\n').writerows(records)
        entry = zipfile.ZipInfo(record_name, date_time=(2026, 11, 7, 0, 0, 0))
        entry.create_system = 3
        entry.compress_type = zipfile.ZIP_DEFLATED
        wheel.writestr(entry, record.getvalue().encode())
    source.close()
    print(target)
    print('sha256=' + hashlib.sha256(target.read_bytes()).hexdigest())
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, help='Optional already-downloaded, checksum-verified upstream wheel')
    parser.add_argument('--output', type=Path)
    options = parser.parse_args()
    build(options.upstream, options.output)
