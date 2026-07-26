#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "uninstall must run as root" >&2
  exit 1
fi

user=growth-agent
if id "$user" >/dev/null 2>&1; then
  systemctl --user --machine="$user@.host" disable --now mini-claw.service 2>/dev/null || true
  systemctl --user --machine="$user@.host" disable --now mini-claw-rednote.service 2>/dev/null || true
  rm -f /var/lib/growth-agent/.config/systemd/user/mini-claw.service
  rm -f /var/lib/growth-agent/.config/systemd/user/mini-claw-rednote.service
  systemctl --user --machine="$user@.host" daemon-reload 2>/dev/null || true
fi

rm -rf /srv/mini-claw/app
echo "Removed application and units. Preserved /var/lib/growth-agent."
