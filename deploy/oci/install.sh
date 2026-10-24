#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly APP_ROOT=/opt/liquidaity
readonly ENV_FILE=/etc/liquidaity/liquidaity.env
readonly STATE_ROOT=/var/lib/liquidaity
readonly SERVICE_USER=liquidaity
readonly SERVICE_GROUP=liquidaity
readonly DEPLOY_ROOT="$APP_ROOT/deploy/oci"
START_SERVICES=true

if [[ "${1:-}" == "--no-start" ]]; then
  START_SERVICES=false
elif [[ $# -ne 0 ]]; then
  printf 'usage: %s [--no-start]\n' "$0" >&2
  exit 2
fi

fail() {
  printf 'install_failed: %s\n' "$1" >&2
  exit 1
}

[[ ${EUID:-$(id -u)} -eq 0 ]] || fail "root_required"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail "ubuntu_amd64_required"
[[ -r /etc/os-release ]] || fail "os_release_unavailable"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || fail "ubuntu_required"

for command in bash caddy chown chmod curl docker getent git grep groupadd install mktemp node npm python3 runuser sed systemctl systemd-analyze useradd usermod; do
  command -v "$command" >/dev/null 2>&1 || fail "missing_command:$command"
done
docker compose version >/dev/null 2>&1 || fail "docker_compose_v2_required"
docker compose up --help | grep -q -- '--wait' || fail "docker_compose_wait_support_required"
[[ "$(command -v node)" == /usr/bin/node ]] || fail "node_must_be_/usr/bin/node"
[[ "$(command -v docker)" == /usr/bin/docker ]] || fail "docker_must_be_/usr/bin/docker"
[[ "$(node --version)" == v22.23.2 ]] || fail "node_22_23_2_required"
[[ "$(npm --version)" == 10.9.8 ]] || fail "npm_10_9_8_required"
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
  || fail "python_3_11_or_newer_required"

[[ "$PWD" == "$APP_ROOT" ]] || fail "run_from_/opt/liquidaity"
for path in package.json package-lock.json docker-compose.yml apps/backend/package.json \
  client/package.json apps/python-models/requirements.txt services/knowgraph/requirements.txt \
  deploy/oci/Caddyfile; do
  [[ -f "$APP_ROOT/$path" ]] || fail "repository_file_missing:$path"
done
grep -q '"node_modules/lightningcss-linux-x64-gnu"' "$APP_ROOT/package-lock.json" \
  || fail "linux_frontend_optional_dependency_missing_from_lockfile"
[[ -r "$ENV_FILE" ]] || fail "environment_file_missing:$ENV_FILE"

resolved_env=""
while IFS= read -r env_line || [[ -n "$env_line" ]]; do
  trimmed_line="${env_line#"${env_line%%[![:space:]]*}"}"
  case "$trimmed_line" in
    ""|\#*) continue ;;
  esac
  resolved_env+="$trimmed_line"$'\n'
done < "$ENV_FILE"
case "$resolved_env" in
  *"<"*">"*|*"CHANGE_ME"*|*"example.com"*|*"public-fqdn"*|*"auth0-tenant"*)
  fail "environment_contains_unresolved_placeholders"
  ;;
esac

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

required_values=(
  LIQUIDAITY_DOMAIN LIQUIDAITY_PUBLIC_BASE_URL CORS_ALLOWED_ORIGINS AUTH_BOOTSTRAP_TOKEN DATABASE_URL
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD NEO4J_USER NEO4J_PASSWORD NEO4J_URI
  LIQUIDAITY_INTERNAL_MCP_SECRET HERMES_DASHBOARD_SESSION_TOKEN
  MCP_PUBLIC_RESOURCE_URL MCP_AUTH0_ISSUER_URL MCP_AUTH0_AUDIENCE
  MCP_AUTH0_CLIENT_ID MCP_AUTH0_REQUIRED_SCOPE
)
for name in "${required_values[@]}"; do
  [[ -n "${!name:-}" ]] || fail "missing_required_config:$name"
done
case "$LIQUIDAITY_DOMAIN" in
  ""|*[!A-Za-z0-9.-]*) fail "invalid_liquidaity_domain" ;;
esac
[[ "$LIQUIDAITY_PUBLIC_BASE_URL" == "https://$LIQUIDAITY_DOMAIN" ]] \
  || fail "public_base_url_mismatch"
[[ "$MCP_PUBLIC_RESOURCE_URL" == "https://$LIQUIDAITY_DOMAIN/mcp" ]] \
  || fail "mcp_public_resource_url_mismatch"
[[ "$MCP_AUTH0_AUDIENCE" == "$MCP_PUBLIC_RESOURCE_URL" ]] \
  || fail "mcp_auth0_audience_mismatch"
[[ "$CORS_ALLOWED_ORIGINS" == *"https://$LIQUIDAITY_DOMAIN"* ]] \
  || fail "public_origin_missing_from_cors"
[[ "${MCP_TRANSPORT:-}" == streamable-http && "${MCP_HTTP_PORT:-}" == 8765 ]] \
  || fail "mcp_loopback_transport_mismatch"
[[ "${MCP_OAUTH_ENFORCED:-}" == true ]] || fail "mcp_oauth_must_be_enforced"
[[ "${HERMES_GATEWAY_URL:-}" == ws://127.0.0.1:9119/api/ws ]] \
  || fail "card_runtime_gateway_url_mismatch"
[[ "${HERMES_HOME:-}" == /opt/liquidaity/HermesLatest/.hermes ]] \
  || fail "card_runtime_home_mismatch"
[[ ${#HERMES_DASHBOARD_SESSION_TOKEN} -eq 64 ]] \
  || fail "invalid_card_runtime_session_token"
case "$HERMES_DASHBOARD_SESSION_TOKEN" in
  *[!a-f0-9]*) fail "invalid_card_runtime_session_token" ;;
esac
[[ ${#LIQUIDAITY_INTERNAL_MCP_SECRET} -ge 32 ]] || fail "internal_mcp_secret_too_short"

if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
  groupadd --system "$SERVICE_GROUP"
fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --gid "$SERVICE_GROUP" --create-home --home-dir "$STATE_ROOT" \
    --shell /usr/sbin/nologin "$SERVICE_USER"
else
  usermod --gid "$SERVICE_GROUP" "$SERVICE_USER"
fi
getent group docker >/dev/null 2>&1 && usermod -aG docker "$SERVICE_USER"

install -d -o root -g "$SERVICE_GROUP" -m 0750 /etc/liquidaity
chown root:"$SERVICE_GROUP" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 \
  "$STATE_ROOT" "$STATE_ROOT/workspaces" "$STATE_ROOT/workspaces/main" \
  "$STATE_ROOT/project-code" "$STATE_ROOT/run-inputs" "$STATE_ROOT/log" "$STATE_ROOT/deploy"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 \
  "$APP_ROOT/db" "$APP_ROOT/services/knowgraph/uploads" "$APP_ROOT/HermesLatest/.hermes"
chown -R "$SERVICE_USER":"$SERVICE_GROUP" "$APP_ROOT"

run_as_service() {
  runuser -u "$SERVICE_USER" -- env HOME="$STATE_ROOT" "$@"
}

cd "$APP_ROOT"
run_as_service npm ci
run_as_service npm run prisma:generate
run_as_service npm --workspace apps/backend run build -- --configuration=production
run_as_service npm --workspace client run build

prepare_python_environment() {
  local environment=$1
  local requirements=$2
  if [[ ! -x "$environment/bin/python" ]]; then
    run_as_service python3 -m venv "$environment"
  fi
  run_as_service "$environment/bin/python" -m pip install \
    --disable-pip-version-check -r "$requirements"
}

prepare_python_environment "$APP_ROOT/apps/python-models/.venv" \
  "$APP_ROOT/apps/python-models/requirements.txt"
prepare_python_environment "$APP_ROOT/services/knowgraph/.venv" \
  "$APP_ROOT/services/knowgraph/requirements.txt"

# The Card runtime is controlled upstream. This package uses its verified public entrypoint but does not
# build or mutate it. A supported Linux environment and retained profile state must be migrated.
[[ -x "$APP_ROOT/HermesLatest/.venv/bin/python" ]] || fail "card_runtime_linux_environment_required"
[[ -s "$APP_ROOT/HermesLatest/.hermes/config.yaml" ]] || fail "card_runtime_profile_state_required"

rendered_caddy=$(mktemp)
trap 'rm -f "$rendered_caddy"' EXIT
sed "s/__LIQUIDAITY_DOMAIN__/$LIQUIDAITY_DOMAIN/g" "$DEPLOY_ROOT/Caddyfile" > "$rendered_caddy"
install -o root -g root -m 0644 "$rendered_caddy" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile

for unit in "$DEPLOY_ROOT"/systemd/*.service "$DEPLOY_ROOT"/systemd/*.target; do
  install -o root -g root -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done
if systemctl list-unit-files liquidaity-hermes.service >/dev/null 2>&1; then
  systemctl disable --now liquidaity-hermes.service || true
  rm -f /etc/systemd/system/liquidaity-hermes.service
fi
systemd-analyze verify /etc/systemd/system/liquidaity-*.service \
  /etc/systemd/system/liquidaity.target
systemctl daemon-reload
systemctl enable liquidaity.target caddy.service

docker compose --env-file "$ENV_FILE" -f "$APP_ROOT/docker-compose.yml" config --quiet

if [[ "$START_SERVICES" == true ]]; then
  systemctl start liquidaity-infrastructure.service
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT to_regclass('ag_catalog.agent_card_revisions') IS NOT NULL" \
    | grep -qx t || fail "restored_postgres_authority_required"
  systemctl start liquidaity.target
  systemctl restart caddy.service
  bash "$DEPLOY_ROOT/health-check.sh"
fi

printf 'LiquidAIty OCI host installation completed.\n'
