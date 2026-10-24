#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_ROOT=/opt/liquidaity
readonly ENV_FILE=/etc/liquidaity/liquidaity.env

fail() {
  printf 'health_check_failed: %s\n' "$1" >&2
  exit 1
}

[[ -r "$ENV_FILE" ]] || fail "environment_file_unreadable"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

for command in curl docker systemctl timeout; do
  command -v "$command" >/dev/null 2>&1 || fail "missing_command:$command"
done

check_service() {
  systemctl is-active --quiet "$1" || fail "service_inactive:$1"
}

check_url() {
  local name=$1
  local url=$2
  curl --fail --silent --show-error --max-time 15 --output /dev/null "$url" \
    || fail "url_unavailable:$name"
}

check_service liquidaity-infrastructure.service
check_service liquidaity-card-runtime.service
check_service liquidaity-python-rails.service
check_service liquidaity-knowgraph.service
check_service liquidaity-backend.service
check_service liquidaity-mcp.service

check_url backend http://127.0.0.1:4000/api/health
check_url python-rails http://127.0.0.1:8003/health
check_url knowgraph http://127.0.0.1:8001/health
check_url mcp-ready http://127.0.0.1:8765/health/ready

# The external Card runtime exposes its gateway listener, not a separate health route.
timeout 5 bash -c '</dev/tcp/127.0.0.1/9119' \
  || fail "card_runtime_gateway_listener_unavailable"

docker exec postgres pg_isready \
  -U "${POSTGRES_USER:?missing_required_config:POSTGRES_USER}" \
  -d "${POSTGRES_DB:?missing_required_config:POSTGRES_DB}" >/dev/null \
  || fail "postgres_not_ready"

neo4j_response=$(curl --fail --silent --show-error --max-time 15 \
  --user "${NEO4J_USER:?missing_required_config:NEO4J_USER}:${NEO4J_PASSWORD:?missing_required_config:NEO4J_PASSWORD}" \
  --header 'Content-Type: application/json' \
  --data '{"statements":[{"statement":"RETURN 1 AS ready"}]}' \
  http://127.0.0.1:7474/db/neo4j/tx/commit) \
  || fail "neo4j_not_ready"
printf '%s' "$neo4j_response" | node -e '
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  try {
    const response = JSON.parse(body);
    if (!Array.isArray(response.errors) || response.errors.length !== 0) process.exit(1);
  } catch {
    process.exit(1);
  }
});
' \
  || fail "neo4j_query_failed"

[[ -s "$APP_ROOT/client/dist/index.html" ]] || fail "frontend_artifact_missing"
if [[ -n "${LIQUIDAITY_PUBLIC_BASE_URL:-}" ]]; then
  check_url public-frontend "${LIQUIDAITY_PUBLIC_BASE_URL%/}/"
fi

printf 'LiquidAIty health check passed.\n'
