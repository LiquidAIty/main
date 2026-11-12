"""Preserve Linux service text when the controlled image was built from Windows."""
# Entity: Oracle Deployment
# Relationship: Normalizes only packaged Hermes service and shell-file CRLF bytes so the unchanged upstream s6 entrypoint can boot on Linux.
from pathlib import Path


def normalize(root=Path('/')):
    candidates = []
    for directory in ('etc/s6-overlay/s6-rc.d', 'etc/cont-init.d'):
        candidates.extend((root / directory).rglob('*'))
    candidates.extend((root / 'opt/hermes/docker').rglob('*.sh'))
    candidates.extend([root / 'opt/hermes/bin/hermes', root / 'etc/profile.d/hermes.sh'])
    changed = 0
    for path in candidates:
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        if b'\r\n' not in data:
            continue
        if b'\0' in data:
            raise ValueError(f'Unexpected binary service file: {path}')
        path.write_bytes(data.replace(b'\r\n', b'\n'))
        changed += 1
    return changed


if __name__ == '__main__':
    print(f'Normalized CRLF in {normalize()} packaged service files; runtime logic unchanged.')
