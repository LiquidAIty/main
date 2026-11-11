"""Read-only HTTP readiness checks; health never substitutes for a saved-Card turn."""
# Entity: Oracle Deployment
# Relationship: Checks existing private process health and optional public authentication rejection without calling models, writing graphs or exposing credentials.
from __future__ import annotations
import argparse
import json
import urllib.error
import urllib.request


def read(url: str) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            data = response.read(65536)
            return response.status, json.loads(data) if data[:1] == b'{' else {}
    except urllib.error.HTTPError as error:
        return error.code, {}
    except (OSError, ValueError):
        return 0, {}


def local_readiness() -> list[tuple[str, bool, int]]:
    results = []
    for name, url in (
        ('backend', 'http://127.0.0.1:4000/api/health'),
        ('python-rails', 'http://127.0.0.1:8003/health'),
        ('knowgraph', 'http://127.0.0.1:8001/health'),
        ('mcp-catalog', 'http://127.0.0.1:8765/health/ready'),
        ('hermes-webapp', 'http://127.0.0.1:9120/api/health'),
        ('worldview-provider', 'http://127.0.0.1:4174/health'),
    ):
        status, body = read(url)
        ok = status == 200 and bool(body)
        if name in {'backend', 'python-rails', 'knowgraph'}:
            ok = ok and body.get('status') == 'ok'
        elif name == 'mcp-catalog':
            ok = ok and body.get('ok') is True and body.get('catalogReady') is True
        elif name == 'hermes-webapp':
            ok = ok and body.get('ok') is True and body.get('auth_required') is True
        elif name == 'worldview-provider':
            ok = ok and body.get('ok') is True and body.get('service') == 'worldview' and {'celestrak-proxy', 'rocket-launches-proxy'} <= set(body.get('providers') or [])
        results.append((name, ok, status))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public', help='Explicit HTTPS origin to check, without credentials')
    args = parser.parse_args()
    checks = []
    for name, ok, status in local_readiness():
        checks.append(ok)
        print(f'{"READY" if ok else "FAIL"} {name} HTTP={status}; process contract only')
    if args.public:
        from urllib.parse import urlsplit
        origin = args.public.rstrip('/')
        parsed = urlsplit(origin)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
            parser.error('--public must be an HTTPS origin without path or credentials')
        for name, path, expected in (
            ('public-hermes', '/api/health', 200),
            ('public-product', '/product/api/health', 200),
            ('anonymous-worldview-denied', '/worldview-native/api/launches', 401),
            ('anonymous-hermes-denied', '/api/auth/me', 401),
        ):
            status, body = read(origin + path)
            ok = status == expected
            if name == 'public-hermes':
                ok = ok and body.get('ok') is True and body.get('auth_required') is True
            elif name == 'public-product':
                ok = ok and body.get('status') == 'ok'
            checks.append(ok)
            print(f'{"PASS" if ok else "FAIL"} {name} HTTP={status}')
    print('UNPROVEN provider/model access, paid-provider quota, valid-cookie refresh, saved-Card tools, Holographic, graph persistence and visual acceptance')
    return 0 if all(checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
