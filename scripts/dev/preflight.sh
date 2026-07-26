#!/bin/sh
set -eu

failed=0
for command in node pnpm git bwrap sqlite3 jq ffmpeg systemctl loginctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "missing: $command" >&2
    failed=1
  fi
done

if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -lt 24 ]; then
    echo "Node.js 24 or newer is required" >&2
    failed=1
  fi
fi

if [ "$(uname -m)" != "aarch64" ]; then
  echo "warning: production verification requires Linux aarch64" >&2
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "warning: bubblewrap and systemd service checks require Linux" >&2
fi

exit "$failed"
