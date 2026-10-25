# LiquidAIty on one OCI Ubuntu VM

This package prepares the existing root LiquidAIty application for one Ubuntu LTS AMD64 Oracle Cloud
Infrastructure Compute VM. It does not provision OCI resources, networking, DNS, TLS certificates, or
secrets. Caddy is the only public listener. Every application service binds to loopback, and the existing
root `docker-compose.yml` remains the sole owner of PostgreSQL/AGE and Neo4j.

## Fixed host layout

| Purpose | Path |
| --- | --- |
| Application checkout | `/opt/liquidaity` |
| Production environment | `/etc/liquidaity/liquidaity.env` |
| Durable host state | `/var/lib/liquidaity` |
| Service account | `liquidaity:liquidaity` |
| Frontend artifact | `/opt/liquidaity/client/dist` |

Use an encrypted OCI block volume for `/var/lib/liquidaity` and for Docker's data root, or place both on
an encrypted block volume sized from the retained workstation data plus backup headroom. The owner must
choose the region, shape, volume size, public IP, DNS name, SSH CIDR, firewall policy, and backup target.

## Verified process graph

| Owner | Command | Listener |
| --- | --- | --- |
| Caddy | system package service, this `Caddyfile` | public TCP 80/443 |
| Backend | `/usr/bin/node dist/src/main.js` in `apps/backend` | `127.0.0.1:4000` |
| Python rails | `apps/python-models/.venv/bin/python -X utf8 -m uvicorn app.main:app --app-dir apps/python-models --host 127.0.0.1 --port 8003` | `127.0.0.1:8003` |
| KnowGraph | `services/knowgraph/.venv/bin/python -X utf8 -m uvicorn app:app --app-dir services/knowgraph --host 127.0.0.1 --port 8001` | `127.0.0.1:8001` |
| MCP | `apps/python-models/.venv/bin/python -X utf8 apps/python-models/app/mcp_host.py` | `127.0.0.1:8765` |
| PostgreSQL/AGE | root Compose service `postgres` | `127.0.0.1:5433` |
| Neo4j | root Compose service `neo4j` | `127.0.0.1:7474`, `127.0.0.1:7687` |

There is no production Vite server and no per-Card process. Codebase Memory remains an external host
prerequisite because this repository does not own a production CBM daemon command. When that executable is
absent, the MCP catalog must report the CBM family unavailable; this package does not invent another daemon.

## Public boundary

Caddy exposes only `/api` and descendants to the backend, `/mcp` and the exact OAuth protected-resource
metadata paths to the MCP host, and the built SPA for every other browser path. Python rails, KnowGraph,
The Card runtime, databases, MCP health/catalog diagnostics, WorldSignals, Shadowbroker, and other optional products
remain private. Caddy preserves SSE flushing, WebSocket upgrades, forwarded host/scheme/client IP, immutable
asset caching, and SPA fallback. Its 32 MB body ceiling covers the current 20 MB JSON limit and the current
25 MiB PDF upload plus multipart framing.

## Host prerequisites and owner inputs

Install Ubuntu LTS AMD64, Caddy 2, Docker Engine with Compose v2, Git, Node `22.23.2`, npm `10.9.8`,
Python 3.11 or newer with `venv`, and standard systemd utilities. Put the checkout at `/opt/liquidaity`.
Migrate the supported Linux Card runtime environment and retained external state; this package deliberately does
not build or modify controlled upstream source. Install the external `codebase-memory-mcp` runtime if the
production CodeGraph family is required.

Create `/etc/liquidaity/liquidaity.env` from `env.example`. Replace every placeholder. Generate the database,
bootstrap, MCP-internal, and 64-hex Card runtime secrets on the host. Supply the final domain, Auth0 issuer,
audience, client ID, scope, CORS origin, and optional provider credentials. Never commit the production file.

Open only inbound TCP 22 from the owner-selected SSH CIDR and TCP 80/443 from the intended public audience.
Do not expose 4000, 8001, 8003, 8765, 5433, 7474, or 7687 in the OCI NSG, security list, or host firewall.

## Fresh-database limitation

Current backend startup applies migrations beginning at `025_async_kanban_card_runs.sql`; earlier retained
schema authority is not bootstrapped by current startup. A blank PostgreSQL/AGE volume is therefore not a
safe production initialization path. Migrate the retained PostgreSQL/AGE authority from the workstation.
`install.sh` refuses to start application services until `ag_catalog.agent_card_revisions` exists. Restore
the retained Neo4j authority as well. No migration was changed by this package.

## Current Linux frontend lockfile blocker

The current lockfile declares `lightningcss-linux-x64-gnu` as an optional dependency of `lightningcss` but
contains only the Windows x64 package record. A fresh Linux `npm ci` therefore omits the Linux native binary,
and the production client build fails while loading the Tailwind/PostCSS stack. `install.sh` detects that
missing lockfile record before changing services. The lockfile requires a separate, owner-approved Linux
optional-dependency correction; this OCI package does not change manifests, dependencies, or lockfiles.

## Install

1. Place the repository at `/opt/liquidaity` and the completed environment file at the fixed path.
2. Restore the retained database volumes and state described below. Infrastructure may be started manually
   with the exact root Compose file while performing the restore.
3. Run `sudo bash /opt/liquidaity/deploy/oci/install.sh` from `/opt/liquidaity`.
4. Run `sudo bash /opt/liquidaity/deploy/oci/health-check.sh`.

The installer fails on missing prerequisites, unresolved placeholders, build errors, missing Card runtime state,
an unrestored PostgreSQL authority, invalid Caddy/systemd configuration, or failed health. It uses `npm ci`,
generates Prisma, builds backend and frontend, creates the two first-party Python environments from their
current requirements, installs Caddy/systemd configuration, starts infrastructure first, then starts the
application target. It never initializes over retained application state.

## Persistent authorities

| Authority | Production location / owner |
| --- | --- |
| PostgreSQL/AGE | Docker volume `sim-pg-data` |
| Neo4j content and logs | Compose volumes resolved by `docker compose config --volumes` |
| ThinkGraph | `/opt/liquidaity/db/thinkgraph.sqlite` and any SQLite WAL/SHM siblings |
| KnowGraph uploads | `/opt/liquidaity/services/knowgraph/uploads` |
| KnowGraph graph content | Neo4j volume |
| Card runtime profiles and sessions | `/opt/liquidaity/HermesLatest/.hermes` |
| Project workspaces | `/var/lib/liquidaity/workspaces` |
| Builder code workspaces | `/var/lib/liquidaity/project-code` |
| Canonical Run inputs | `/var/lib/liquidaity/run-inputs` |
| Run/artifact catalog and lineage | PostgreSQL/AGE, with file locators backed up from their retained paths |
| Environment and credentials | `/etc/liquidaity/liquidaity.env` |

The repository checkout contains retained state directories, so updates must never use `git clean`, delete
untracked data, or replace volumes. Keep all listed paths owned by `liquidaity:liquidaity`, except the
environment file, which is `root:liquidaity` mode `0640`.

## Backup and restore

The commands below are an operator procedure, not proof that a backup or restore has been run.

1. Stop the public edge and application services: `sudo systemctl stop caddy liquidaity.target`.
2. Create a mode-0700 backup directory on the encrypted backup destination.
3. Export PostgreSQL while the container is available:
   `docker exec postgres pg_dumpall -U "$POSTGRES_USER" > "$BACKUP_DIR/postgres.sql"`.
4. Stop Neo4j and copy its retained data: `docker compose --env-file /etc/liquidaity/liquidaity.env -f /opt/liquidaity/docker-compose.yml stop neo4j`, then `docker cp neo4j:/data "$BACKUP_DIR/neo4j-data"` and `docker cp neo4j:/logs "$BACKUP_DIR/neo4j-logs"`.
5. Archive `db/thinkgraph.sqlite*`, `services/knowgraph/uploads`, `HermesLatest/.hermes`,
   `/var/lib/liquidaity/workspaces`, `/var/lib/liquidaity/project-code`, `/var/lib/liquidaity/run-inputs`,
   and `/etc/liquidaity/liquidaity.env`. Protect the archive and environment file as secrets.
6. Record the exact Git revision and the Docker volume names from `docker compose config --volumes`.

Restore in this order: exact application revision; production environment; PostgreSQL/AGE; Neo4j; ThinkGraph;
KnowGraph uploads; Card runtime state; Project and Builder workspaces; Run inputs/artifacts; ownership and modes.
Start `liquidaity-infrastructure.service`, verify both databases, then start `liquidaity.target`, then Caddy,
and finally run the health check.

## Update and rollback

Run `sudo bash /opt/liquidaity/deploy/oci/update.sh` only from a clean `main` deployment checkout. It records the
prior revision, performs `git pull --ff-only`, stops through the same systemd owners, rebuilds and installs,
starts the target, and runs health. Failure switches the checkout to the recorded prior revision, rebuilds
that revision, restarts it, and reruns health. It never uses `git reset --hard`, deletes untracked data, or
changes database volumes. A rollback leaves a detached checkout intentionally; inspect the failed revision
before returning to the deployment branch.

## What moves and what is generated

Migrate all persistent authorities listed above from the workstation. Generate fresh host-only service
secrets only when they do not replace retained identity or credentials. Generate Node build output, frontend
build output, and first-party Python virtual environments on the VM. Migrate or separately prepare the
supported Linux Card runtime and its retained state. Never commit the production environment, credentials,
database exports, provider keys, OAuth secrets, Card runtime state, Project data, uploads, or Run artifacts.
