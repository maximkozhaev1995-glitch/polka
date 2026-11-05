#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "::error::No command provided to the isolated test runner."
  exit 2
fi

pg_bin=/usr/lib/postgresql/16/bin
chromium=$(node -p 'require("playwright").chromium.executablePath()')
if [[ ! -x "$pg_bin/initdb" || ! -x "$pg_bin/pg_ctl" || ! -x "$chromium" ]]; then
  echo "::error::Test PostgreSQL or Playwright Chromium is missing. Check the CI dependency installation step."
  exit 2
fi

# The child gets a new network namespace. Only loopback connects the test,
# its temporary PostgreSQL cluster, and the local browser fixtures.
printf 'Running with loopback only and live models disabled: %s\n' "$*"
if sudo unshare --net -- bash -euo pipefail -c '
  uid=$1 gid=$2 home=$3 command_path=$4 pg_bin=$5 chromium=$6
  shift 6
  ip link set lo up
  if [[ $(ip -o link show | cut -d: -f2 | xargs) != lo ]]; then
    echo "::error::Network isolation failed. Expected only loopback."
    exit 2
  fi
  exec setpriv --reuid "$uid" --regid "$gid" --clear-groups --no-new-privs -- \
    env -i HOME="$home" PATH="$command_path" LANG=C.UTF-8 CI=true RUN_CLAUDE=0 \
    MIXORA_TEST_PG_BIN="$pg_bin" MIXORA_CHROMIUM="$chromium" "$@"
' bash "$(id -u)" "$(id -g)" "$HOME" "$PATH" "$pg_bin" "$chromium" "$@"; then
  exit 0
else
  status=$?
  echo "::error::Isolated check failed (exit $status): $*. See the preceding command output."
  exit "$status"
fi
