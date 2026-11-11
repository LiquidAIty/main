"""Build the AMD64 images sequentially, with no runtime volumes or service startup."""
# Entity: Oracle Deployment
# Relationship: Builds the unchanged Hermes base and first-party image targets in dependency order without deploying or copying private runtime state.
from __future__ import annotations
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', default='oracle-prep')
    parser.add_argument('--skip-hermes-base', action='store_true', help='Use a previously built controlled base with the same tag')
    parser.add_argument('--target', choices=['all', 'backend', 'application-python', 'hermes-ui', 'worldview', 'knowgraph', 'proxy-test'], default='all')
    args = parser.parse_args()
    import re
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', args.tag):
        parser.error('tag must be a Docker tag without shell syntax')
    base = f'local/hermes-controlled:{args.tag}'
    def build(dockerfile: str, target: str | None, image: str, context='.', extra=()) -> None:
        command = ['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--load', '-f', dockerfile, '-t', image]
        if target:
            command += ['--target', target]
        subprocess.run([*command, *extra, context], cwd=ROOT, check=True)
    needs_hermes = args.target in {'all', 'application-python', 'hermes-ui'}
    if needs_hermes and not args.skip_hermes_base:
        build('HermesLatest/Dockerfile', 'runtime', base, 'HermesLatest')
    targets = [('backend', 'product-api'), ('hermes-ui', 'hermes-ui'), ('worldview', 'worldview'),
               ('application-python', 'python-rails'), ('knowgraph', 'knowgraph'), ('proxy-test', 'proxy-test')]
    for target, image in targets:
        if args.target not in {'all', target}:
            continue
        if target == 'knowgraph':
            build('services/knowgraph/Dockerfile', None, f'local/{image}:{args.tag}')
        else:
            build('deploy/oci/Dockerfile', target, f'local/{image}:{args.tag}', extra=(
                '--build-arg', f'HERMES_BASE_IMAGE={base}',
                '--build-arg', 'CESIUM_ION_TOKEN', '--build-arg', 'GOOGLE_MAPS_API_KEY'))
    print('Images built. No deployment, database access, model call or saved-Card execution was performed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
