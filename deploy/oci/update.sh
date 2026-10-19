#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly APP_ROOT=/opt/liquidaity
readonly STATE_ROOT=/var/lib/liquidaity
readonly ENV_FILE=/etc/liquidaity/liquidaity.env
readonly BRANCH=${LIQUIDAITY_DEPLOY_BRANCH:-main}

fail() {
  printf 'update_failed: %s\n' "$1" >&2
  exit 1
}

[[ ${EUID:-$(id -u)} -eq 0 ]] || fail "root_required"
[[ -d "$APP_ROOT/.git" ]] || fail "deployment_checkout_missing"
[[ -r "$ENV_FILE" ]] || fail "environment_file_missing"
cd "$APP_ROOT"

[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "deployment_branch_mismatch"
git diff --quiet || fail "tracked_worktree_not_clean"
git diff --cached --quiet || fail "index_not_clean"
[[ -z "$(git ls-files --others --exclude-standard)" ]] || fail "untracked_owner_data_present"

previous_revision=$(git rev-parse HEAD)
install -d -o liquidaity -g liquidaity -m 0750 "$STATE_ROOT/deploy"
printf '%s\n' "$previous_revision" > "$STATE_ROOT/deploy/previous-revision"
chown liquidaity:liquidaity "$STATE_ROOT/deploy/previous-revision"
chmod 0640 "$STATE_ROOT/deploy/previous-revision"

git pull --ff-only --no-rebase origin "$BRANCH"
new_revision=$(git rev-parse HEAD)

rollback() {
  local failed_line=$1
  trap - ERR
  set +e
  printf 'Update failed at line %s; rolling back application source to %s.\n' \
    "$failed_line" "$previous_revision" >&2
  systemctl stop caddy.service liquidaity.target
  git switch --detach "$previous_revision"
  bash "$APP_ROOT/deploy/oci/install.sh" --no-start
  systemctl start liquidaity.target
  systemctl start caddy.service
  bash "$APP_ROOT/deploy/oci/health-check.sh"
  printf 'Rollback completed at %s; branch %s remains available for operator repair.\n' \
    "$previous_revision" "$BRANCH" >&2
  exit 1
}
trap 'rollback "$LINENO"' ERR

systemctl stop caddy.service liquidaity.target
bash "$APP_ROOT/deploy/oci/install.sh" --no-start
systemctl start liquidaity.target
systemctl start caddy.service
bash "$APP_ROOT/deploy/oci/health-check.sh"

trap - ERR
printf 'LiquidAIty updated from %s to %s.\n' "$previous_revision" "$new_revision"
