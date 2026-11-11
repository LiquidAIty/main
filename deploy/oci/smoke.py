"""Offline image import/artifact checks without a Gateway, model, database or state mount."""
# Entity: Oracle Deployment
# Relationship: Exercises built image entrypoints and packaged dependencies with no network and disposable tmpfs instead of production volumes.
from __future__ import annotations
import argparse
import re
import subprocess


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', default='oracle-prep')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', args.tag):
        parser.error('invalid image tag')
    checks = [
        ('product-api', 'node', ['--check', '/opt/liquidaity/apps/backend/dist/src/main.js']),
        ('product-api', 'node', ['-e',
         "const fs=require('node:fs');const path=require('node:path');const root='/opt/liquidaity/node_modules/.prisma/client';const engine=fs.readdirSync(root).find(n=>n.endsWith('debian-openssl-3.0.x.so.node'));if(!engine)throw new Error('Prisma OpenSSL3 engine missing');require(path.join(root,engine));console.log('Prisma native OpenSSL3 engine loads; no database connection')"]),
        ('python-rails', '/opt/liquidaity/apps/python-models/.venv/bin/python', ['-c',
         "import sys,sqlite3,fastapi,mcp,graphiti_core,engraphis,torch; from importlib.metadata import version; from pathlib import Path; assert sys.version_info[:2]==(3,11); assert sqlite3.sqlite_version_info==(3,53,4); assert version('lumibot')=='4.6.48+mcp2.1'; assert torch.__version__=='2.14.0+cpu' and torch.version.cuda is None; assert torch.tensor([1.,2.]).sum().item()==3.; assert not Path('/opt/data/state.db').exists(); print('rails imports, Torch CPU, shared SQLite3.53.4 and separate CPython verified')"]),
        ('python-rails', '/opt/hermes/.venv/bin/python', ['-c',
         "import sys,sqlite3; assert sqlite3.sqlite_version_info>=(3,51,3); sys.path.insert(0,'/opt/hermes'); from pathlib import Path; from hermes_cli._launchers import runtime_command; c=runtime_command(Path('/opt/hermes'),['--version'],home='/opt/data'); assert c and Path(c[0]).is_file(); print('existing Hermes runtime resolves; not executed; sealed SQLite',sqlite3.sqlite_version)"]),
        ('python-rails', '/opt/liquidaity/apps/python-models/.venv/bin/python', ['-c',
         "import sys;sys.path.insert(0,'/opt/liquidaity/agent-products/kronos');from model import KronosPredictor;print('Kronos package imports; no model weights or inference')"]),
        ('python-rails', '/opt/liquidaity/apps/python-models/.venv/bin/python', ['-c',
         "from lumibot.traders import Trader;print('Pinned LumiBot Trader imports; no broker or strategy started')"]),
        ('hermes-ui', '/opt/hermes/.venv/bin/python', ['-c',
         "from pathlib import Path; assert Path('/opt/liquidaity/client/dist/index.html').is_file(); assert Path('/opt/hermes/plugins/liquidaity/plugin.yaml').is_file(); assert not Path('/opt/data/state.db').exists(); print('UI and plugin artifacts present; no profile state baked in')"]),
        ('knowgraph', 'python', ['-c', "import graphiti_core,fastapi,pypdf; print('KnowGraph dependencies import')"]),
        ('worldview', 'node', ['--input-type=module', '-e',
         "import assert from 'node:assert/strict';import {createWorldViewServer} from '/opt/liquidaity/deploy/oci/worldview-server.mjs';const server=createWorldViewServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const base='http://127.0.0.1:'+server.address().port;const body=await(await fetch(base+'/health')).json();assert.equal(body.ok,true);assert.equal(body.providers.length,19);assert.equal((await fetch(base+'/src/app/mount.js')).status,404);assert.equal((await fetch(base+'/.env')).status,404);console.log('Node24 WorldView HTTP registration and source denial pass; upstream providers not called')}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}"]),
    ]
    failures = 0
    for image, executable, command in checks:
        print('CHECK ' + image, flush=True)
        result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                                 '--tmpfs', '/tmp', '--tmpfs', '/opt/data:uid=10000,gid=10000,mode=0700', '--entrypoint', executable,
                                 f'local/{image}:{args.tag}', *command], check=False)
        if result.returncode:
            failures += 1
    proxy = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                            '--tmpfs', '/tmp', '--tmpfs', '/root/.config', '--tmpfs', '/root/.local',
                            f'local/proxy-test:{args.tag}'], check=False)
    failures += int(proxy.returncode != 0)
    print('NOT RUN model calls, authenticated saved-Card execution, graph persistence, host deployment')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
