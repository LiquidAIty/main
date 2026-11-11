"""Read-only source, Docker and deployment-input checks; never print secret values."""
# Entity: Oracle Deployment
# Relationship: Checks the AMD64 package and explicit host inputs without installing, starting services, inspecting database content or changing saved state.
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
STATE_KEYS = ('HERMES_STATE_DIR', 'THINKGRAPH_STATE_DIR', 'KNOWGRAPH_UPLOAD_DIR',
              'WORKSPACE_STATE_DIR', 'MODEL_CACHE_DIR', 'WORLDVIEW_CACHE_DIR')
REQUIRED = ('LIQUIDAITY_DOMAIN', 'POSTGRES_DATA_VOLUME', 'NEO4J_DATA_VOLUME',
            'NEO4J_LOGS_VOLUME', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
            'DATABASE_URL', 'NEO4J_PASSWORD', 'LIQUIDAITY_INTERNAL_MCP_SECRET', *STATE_KEYS)
# Mirrors only this package's explicit credential allowlist, not Hermes resolution.
MODEL_KEYS = {'openrouter': ('OPENROUTER_API_KEY',), 'openai-api': ('OPENAI_API_KEY',),
              'anthropic': ('ANTHROPIC_API_KEY',), 'gemini': ('GOOGLE_API_KEY', 'GEMINI_API_KEY')}


def credential_presence(provider: str, env: dict[str, str]) -> str:
    """Report package input presence, never resolve/refresh credentials or pick a model."""
    keys = MODEL_KEYS.get(provider)
    if keys is None:
        return 'UNPROVEN OAuth/custom/local provider; audit retained authentication on Linux'
    present = any(env.get(key, '').strip() and '<' not in env[key] for key in keys)
    return ('PRESENT' if present else 'MISSING') + ' runtime key; API/model call UNPROVEN'


def profile_readiness(home: Path, env: dict[str, str]) -> list[str]:
    """Read configuration only; do not import Hermes's stateful provider machinery."""
    try:
        from ruamel.yaml import YAML
        from ruamel.yaml.error import YAMLError
    except ImportError:
        return ['UNPROVEN profile parsing: run this check with the existing Hermes Python (ruamel.yaml); do not install into its sealed environment']
    yaml = YAML(typ='safe')
    paths = [home / 'config.yaml', *sorted((home / 'profiles').glob('*/config.yaml'))]
    lines = []
    for path in paths:
        name = 'default' if path.parent == home else path.parent.name
        try:
            config = yaml.load(path.read_text(encoding='utf-8'))
            if not isinstance(config, dict):
                raise ValueError('invalid configuration')
        except (OSError, ValueError, YAMLError):
            lines.append(f'FAIL profile {name}: configuration unreadable; no fallback inferred')
            continue
        model = config.get('model')
        if not isinstance(model, dict):
            lines.append(f'UNPROVEN profile {name}: no explicit structured provider/model; no fallback inferred')
            continue
        provider = model.get('provider')
        selected = model.get('default') or model.get('model') or model.get('name')
        if isinstance(selected, dict):
            provider = selected.get('provider') or provider
            selected = selected.get('model') or selected.get('default')
        # Output only typed provider/model identifiers, never URLs, tokens or arbitrary config.
        def identifier(value):
            return str(value) if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_./:+@-]{1,200}', value) else '<unspecified>'
        provider, selected = identifier(provider), identifier(selected)
        lines.append(f'PROFILE {name} parent provider={provider} model={selected}: {credential_presence(provider, env)}; retained profile credentials not resolved')
        delegation = config.get('delegation')
        if isinstance(delegation, dict) and (delegation.get('provider') or delegation.get('model')):
            child_provider = identifier(delegation.get('provider') or provider)
            child_model = identifier(delegation.get('model') or selected)
            lines.append(f'PROFILE {name} subagent provider={child_provider} model={child_model}: {credential_presence(child_provider, env)}; actual effective resolution UNPROVEN')
    return lines


def read_environment(path: Path) -> dict[str, str]:
    """Parse literal KEY=VALUE lines; never source shell commands or expand variables."""
    result = {}
    for number, raw in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError(f'env_line_invalid:{number}')
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in result:
            raise ValueError(f'env_key_invalid_or_duplicate:{number}')
        if '$' in value and not value.startswith("'"):
            raise ValueError(f'env_expansion_not_literal:{number}')
        if value[:1] in {'"', "'"}:
            if value[-1:] != value[:1] or len(value) < 2:
                raise ValueError(f'env_quote_invalid:{number}')
            value = value[1:-1]
        result[key] = value
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, help='Explicit runtime Compose env file; values are never printed')
    parser.add_argument('--host-paths', action='store_true', help='Check restored directory presence on the deployment host')
    parser.add_argument('--probe-services', action='store_true', help='Read existing loopback HTTP health only; no model or graph calls')
    args = parser.parse_args()
    failed = []
    def check(name: str, ok: bool) -> None:
        print(f'{"PASS" if ok else "FAIL"} {name}')
        if not ok:
            failed.append(name)
    for name in ('.dockerignore', 'docker-compose.yml', 'deploy/oci/Dockerfile',
                 'deploy/oci/compose.docker.yml', 'deploy/oci/Caddyfile',
                 'deploy/oci/worldview-server.mjs', 'HermesLatest/Dockerfile',
                 'HermesLatest/.dockerignore', 'agent-products/lumibot/build.py'):
        check('source:' + name, (ROOT / name).is_file())
    requirements = (ROOT / 'apps/python-models/requirements.txt').read_text(encoding='utf-8')
    check('canonical_lumibot_wheel', './agent-products/lumibot/dist/lumibot-4.6.48+mcp2.1-py3-none-any.whl' in requirements)
    dockerfile = (ROOT / 'deploy/oci/Dockerfile').read_text(encoding='utf-8')
    check('frontend_build_config', 'VITE_LIQUIDAITY_API_ORIGIN=/product' in dockerfile
          and 'VITE_WORLDVIEW_RUNTIME_BASE_URL=/worldview-native/' in dockerfile)
    try:
        docker = subprocess.run(['docker', 'version', '--format', '{{json .Server}}'],
                                capture_output=True, text=True, timeout=20)
        server = json.loads(docker.stdout) if docker.returncode == 0 else {}
        check('docker_linux_amd64', server.get('Os') == 'linux' and server.get('Arch') == 'amd64')
    except (OSError, ValueError, subprocess.TimeoutExpired):
        check('docker_linux_amd64', False)
    if args.env:
        try:
            env = read_environment(args.env)
        except (OSError, ValueError):
            check('runtime_environment_readable_and_literal', False)
            return 1
        for key in REQUIRED:
            value = env.get(key, '')
            check('configured:' + key, bool(value) and '<' not in value and 'CHANGE_ME' not in value)
        for key, value in env.items():
            if ('<' in value and '>' in value) or 'CHANGE_ME' in value:
                check('unresolved_placeholder:' + key, False)
        check('public_domain_format', bool(re.fullmatch(r'[A-Za-z0-9.-]+', env.get('LIQUIDAITY_DOMAIN', ''))))
        check('retained_mcp_secret_length', len(env.get('LIQUIDAITY_INTERNAL_MCP_SECRET', '')) >= 32)
        check('obsolete_mcp_oauth_absent', not any(key.startswith('MCP_AUTH0_') or key == 'MCP_OAUTH_ENFORCED' for key in env))
        for key in ('OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
                    'GEMINI_API_KEY', 'FIRECRAWL_API_KEY', 'CESIUM_ION_TOKEN', 'GOOGLE_MAPS_API_KEY', 'LL2_API_TOKEN'):
            value = env.get(key, '')
            print(f'PROVIDER {key}: {"present" if value and "<" not in value else "missing"}; live validation not performed')
        alpaca = bool(env.get('ALPACA_API_KEY_ID') and env.get('ALPACA_API_SECRET_KEY'))
        print(f'PROVIDER Alpaca PAPER: credentials {"present" if alpaca else "missing"}; paper-only Compose setting; broker call not run')
        print('UNPROVEN saved Card model availability, Hermes sign-in, Holographic and external MCP credentials')
        if args.host_paths:
            check('deployment_host_linux_amd64', sys.platform == 'linux' and os.uname().machine == 'x86_64')
            if sys.platform == 'linux':
                check('runtime_env_owner_only_permissions', args.env.stat().st_mode & 0o077 == 0)
            for key in STATE_KEYS:
                check('directory:' + key, Path(env.get(key, '')).is_dir())
            check('restored_hermes_config', (Path(env.get('HERMES_STATE_DIR', '')) / 'config.yaml').is_file())
            profiles = Path(env.get('HERMES_STATE_DIR', '')) / 'profiles'
            count = sum(1 for path in profiles.glob('*/config.yaml')) if profiles.is_dir() else 0
            print(f'STATE Hermes profile config files: {count}; contents and credentials withheld')
            for line in profile_readiness(Path(env.get('HERMES_STATE_DIR', '')), env):
                print(line)
                if line.startswith('FAIL '):
                    failed.append('profile_configuration')
        try:
            result = subprocess.run(['docker', 'compose', '--env-file', str(args.env.resolve()),
                                     '-f', 'docker-compose.yml', '-f', 'deploy/oci/compose.docker.yml',
                                     'config', '--quiet'], cwd=ROOT, capture_output=True, timeout=30)
            check('compose_structure', result.returncode == 0)
        except (OSError, subprocess.TimeoutExpired):
            check('compose_structure', False)
    elif args.host_paths:
        check('env_required_for_host_paths', False)
    print('UNPROVEN frontend: build/config checks are not authenticated browser acceptance')
    if args.probe_services:
        from health import local_readiness
        for name, ok, status in local_readiness():
            print(f'{"READY" if ok else "FAIL"} {name}: HTTP contract status={status}; current machine only')
            if not ok:
                failed.append(name)
    else:
        for name in ('Backend', 'Python rails', 'Hermes Webapp', 'WorldView', 'Graphiti service', 'MCP catalog'):
            print(f'UNPROVEN {name}: service probe not requested')
    print('UNPROVEN Engraphis: retained user database and actual read/write not exercised')
    print('UNPROVEN Graphiti: health/import does not prove Neo4j read/write or provider/model access')
    print('UNPROVEN Holographic/profile state: effective saved provider, plugin and persistence not exercised')
    print('UNPROVEN CodeGraph: Linux CBM executable and project/index state are not packaged; MCP catalog health is not CodeGraph proof')
    print('DEFERRED WorldMonitor: no service included; no restore or probe performed')
    print('NOT RUN remote audit, DNS changes, database restore, service startup, model calls, saved-Card execution')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
