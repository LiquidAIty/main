# syntax=docker/dockerfile:1.7
ARG HERMES_BASE_IMAGE=local/hermes-controlled:oracle-prep
ARG APP_NODE_IMAGE=node:22.23.2-bookworm-slim
ARG PROVIDER_NODE_IMAGE=node:24.14.0-bookworm-slim
ARG PYTHON_IMAGE=python:3.11-slim-trixie
ARG CADDY_IMAGE=caddy:2

FROM ${PROVIDER_NODE_IMAGE} AS worldview-deps
WORKDIR /opt/liquidaity/agent-products/gods-eye-view
COPY agent-products/gods-eye-view/package.json agent-products/gods-eye-view/package-lock.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --ignore-scripts --include=dev

FROM ${APP_NODE_IMAGE} AS app-build
WORKDIR /opt/liquidaity
ENV NX_DAEMON=false
COPY package.json package-lock.json nx.json tsconfig*.json ./
COPY apps/backend/ apps/backend/
COPY client/ client/
COPY prisma/ prisma/
COPY HermesLatest/apps/shared/ HermesLatest/apps/shared/
COPY agent-products/nrgsim/client/ agent-products/nrgsim/client/
COPY agent-products/gods-eye-view/ agent-products/gods-eye-view/
COPY --from=worldview-deps /opt/liquidaity/agent-products/gods-eye-view/node_modules/ agent-products/gods-eye-view/node_modules/
RUN npm ci --include=dev
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
COPY agent-products/nrgsim/package.json agent-products/nrgsim/package-lock.json agent-products/nrgsim/
RUN npm ci --prefix agent-products/nrgsim --ignore-scripts
RUN npm run prisma:generate
RUN npm --workspace apps/backend run build -- --configuration=production
ARG VITE_LIQUIDAITY_API_ORIGIN=/product
ARG VITE_WORLDVIEW_RUNTIME_BASE_URL=/worldview-native/
# Deliberately public browser tokens, never model/server credentials.
ARG CESIUM_ION_TOKEN=
ARG GOOGLE_MAPS_API_KEY=
ENV VITE_LIQUIDAITY_API_ORIGIN=${VITE_LIQUIDAITY_API_ORIGIN} \
    VITE_WORLDVIEW_RUNTIME_BASE_URL=${VITE_WORLDVIEW_RUNTIME_BASE_URL} \
    CESIUM_ION_TOKEN=${CESIUM_ION_TOKEN} GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}
RUN npm --workspace client run build

FROM ${APP_NODE_IMAGE} AS backend
WORKDIR /opt/liquidaity/apps/backend
ENV NODE_ENV=production LIQUIDAITY_REPO_ROOT=/opt/liquidaity PORT=4000
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=app-build /opt/liquidaity/node_modules/ /opt/liquidaity/node_modules/
COPY --from=app-build /opt/liquidaity/apps/backend/ ./
COPY package.json LiquidAIty.idd /opt/liquidaity/
USER node
CMD ["node", "dist/src/main.js"]

# Keep CPython 3.11 and its venv together. Validate relocation and shared-library
# resolution inside the actual Hermes Debian runtime before installing packages.
FROM ${PYTHON_IMAGE} AS python311
FROM ${HERMES_BASE_IMAGE} AS python-runtime
USER root
COPY --from=python311 /usr/local/ /opt/python311/
ENV LD_LIBRARY_PATH=/usr/local/lib:/opt/python311/lib PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN /opt/python311/bin/python3.11 -c "import bz2, ctypes, decimal, lzma, multiprocessing, ssl, sqlite3, sys; assert sys.version_info[:2] == (3,11); assert sys.prefix == '/opt/python311'; ctypes.CDLL('libpython3.11.so.1.0'); assert sqlite3.sqlite_version_info == (3,53,4), sqlite3.sqlite_version; print('CPython 3.11 relocation, stdlib ABI and shared SQLite3.53.4 verified')" \
 && /opt/hermes/.venv/bin/python -c "import sqlite3; assert sqlite3.sqlite_version_info >= (3,51,3), sqlite3.sqlite_version; c=sqlite3.connect(':memory:'); c.execute('CREATE VIRTUAL TABLE docs USING fts5(content, tokenize=trigram)'); c.execute('INSERT INTO docs VALUES (?)',('hermes',)); assert c.execute('SELECT count(*) FROM docs WHERE docs MATCH ?',('erm',)).fetchone()[0]==1; c.close(); print('Hermes sealed SQLite',sqlite3.sqlite_version,'upstream WAL floor and FTS5 trigram verified')"
WORKDIR /opt/liquidaity
RUN test ! -e /opt/hermes/.hermes && test ! -L /opt/hermes/.hermes \
 && ln -s /opt/hermes /opt/liquidaity/HermesLatest \
 && ln -s /opt/data /opt/hermes/.hermes

FROM python-runtime AS application-python
COPY package.json LiquidAIty.idd ./
COPY GraphitiLatest/ GraphitiLatest/
COPY EngraphisLatest/ EngraphisLatest/
COPY apps/python-models/requirements.txt apps/python-models/requirements.txt
COPY agent-products/lumibot/ agent-products/lumibot/
RUN /opt/python311/bin/python3.11 agent-products/lumibot/build.py \
 && /opt/python311/bin/python3.11 -m venv apps/python-models/.venv \
 && apps/python-models/.venv/bin/python -m pip install --no-cache-dir 'https://download-r2.pytorch.org/whl/cpu/torch-2.14.0%2Bcpu-cp311-cp311-manylinux_2_28_x86_64.whl#sha256=673dbf5c9bbadfffab7a386b6dd7a0c219f1408a328b7b4e86d0ae551cdafa42' \
 && apps/python-models/.venv/bin/python -m pip install --no-cache-dir -r apps/python-models/requirements.txt \
 && apps/python-models/.venv/bin/python -m pip check
COPY apps/python-models/ apps/python-models/
COPY agent-products/nrgsim/services/ agent-products/nrgsim/services/
COPY agent-products/kronos/model/ agent-products/kronos/model/
COPY agent-products/kronos/LICENSE agent-products/kronos/LICENSE
COPY deploy/oci/patch_kronos_import.py deploy/oci/patch_kronos_import.py
RUN /opt/python311/bin/python3.11 deploy/oci/patch_kronos_import.py agent-products/kronos/model/kronos.py
RUN apps/python-models/.venv/bin/python -c "import fastapi, mcp, graphiti_core, engraphis, torch; from importlib.metadata import version; assert version('lumibot') == '4.6.48+mcp2.1'; assert version('mcp').split('.')[0] == '2'; assert torch.__version__ == '2.14.0+cpu'; assert torch.version.cuda is None; assert torch.tensor([1.,2.]).sum().item()==3.; print('Python rails imports and pinned Torch CPU operator verified')" \
 && mkdir -p db/users /opt/data /var/lib/liquidaity/workspaces /var/lib/liquidaity/project-code /var/lib/liquidaity/run-inputs \
 && chown -R 10000:10000 db /var/lib/liquidaity
ENV HERMES_HOME=/opt/data LIQUIDAITY_REPO_ROOT=/opt/liquidaity
# Only hermes-ui starts Hermes. Rails and MCP retain their existing processes.
ENTRYPOINT []
USER 10000:10000
CMD ["/opt/liquidaity/apps/python-models/.venv/bin/python", "-X", "utf8", "-m", "uvicorn", "app.main:app", "--app-dir", "/opt/liquidaity/apps/python-models", "--host", "127.0.0.1", "--port", "8003"]

FROM ${HERMES_BASE_IMAGE} AS hermes-ui
COPY --from=app-build /opt/liquidaity/client/dist/ /opt/liquidaity/client/dist/
COPY apps/hermes-liquidaity-plugin/ /opt/hermes/plugins/liquidaity/
COPY deploy/oci/normalize_hermes_scripts.py /opt/liquidaity/deploy/oci/normalize_hermes_scripts.py
RUN /opt/hermes/.venv/bin/python /opt/liquidaity/deploy/oci/normalize_hermes_scripts.py \
 && /command/s6-rc-compile /tmp/hermes-service-check /package/admin/s6-overlay/etc/s6-rc/sources /etc/s6-overlay/s6-rc.d
ENV HERMES_WEBAPP_DIST=/opt/liquidaity/client/dist
# Inherit s6 entrypoint and package/runtime authority unchanged.
CMD ["gateway", "run"]

FROM ${PROVIDER_NODE_IMAGE} AS worldview
WORKDIR /opt/liquidaity/agent-products/gods-eye-view
COPY --from=app-build /opt/liquidaity/node_modules/ /opt/liquidaity/node_modules/
COPY --from=worldview-deps /opt/liquidaity/agent-products/gods-eye-view/node_modules/ node_modules/
COPY agent-products/gods-eye-view/ ./
COPY deploy/oci/worldview-server.mjs /opt/liquidaity/deploy/oci/worldview-server.mjs
RUN mkdir -p .gev-cache && chown node:node .gev-cache
ENV NODE_ENV=production WORLDVIEW_PORT=4174
USER node
CMD ["node", "/opt/liquidaity/deploy/oci/worldview-server.mjs"]

FROM ${CADDY_IMAGE} AS caddy-binary
FROM ${PROVIDER_NODE_IMAGE} AS proxy-test
COPY --from=caddy-binary /usr/bin/caddy /usr/bin/caddy
WORKDIR /test
COPY deploy/oci/Caddyfile deploy/oci/test-proxy.mjs ./
CMD ["node", "--test", "test-proxy.mjs"]
