#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "install must run as root" >&2
  exit 1
fi

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
user=growth-agent
home_dir=/var/lib/growth-agent
app_dir=/srv/mini-claw/app

if ! id "$user" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$home_dir" --shell /usr/sbin/nologin "$user"
fi
if ! grep -q "^$user:" /etc/subuid 2>/dev/null; then
  usermod --add-subuids 200000-265535 "$user"
fi
if ! grep -q "^$user:" /etc/subgid 2>/dev/null; then
  usermod --add-subgids 200000-265535 "$user"
fi

install -d -o "$user" -g "$user" -m 0700 "$home_dir" "$home_dir/config" "$home_dir/state" "$home_dir/artifacts"
install -d -o "$user" -g "$user" -m 0700 "$home_dir/rednote/data" "$home_dir/rednote/images"
install -d -o "$user" -g "$user" -m 0750 "$home_dir/.config/systemd/user"
install -d -o root -g "$user" -m 0750 /srv/mini-claw "$app_dir" "$app_dir/dist"

if [ ! -f "$repo/packages/growth-agent/dist/daemon.js" ]; then
  echo "build output missing; run make build first" >&2
  exit 1
fi

pnpm --dir "$repo" --filter @mini-claw/growth-agent deploy --force --prod --offline "$app_dir"
install -o root -g "$user" -m 0750 "$repo/packages/growth-agent/dist/daemon.js" "$app_dir/dist/daemon.js"
rm -rf "$app_dir/.pi"
cp -R "$repo/.pi" "$app_dir/.pi"
chown -R root:"$user" "$app_dir/.pi"
chmod -R go-w "$app_dir/.pi"
install -o root -g "$user" -m 0640 "$repo/packages/growth-agent/config/default.example.yaml" "$home_dir/config/default.example.yaml"
install -o "$user" -g "$user" -m 0644 "$repo/scripts/service/mini-claw.service" "$home_dir/.config/systemd/user/mini-claw.service"
install -o "$user" -g "$user" -m 0644 "$repo/scripts/service/mini-claw-rednote.service" "$home_dir/.config/systemd/user/mini-claw-rednote.service"

if [ ! -f "$home_dir/config/local.yaml" ]; then
  install -o "$user" -g "$user" -m 0600 "$repo/packages/growth-agent/config/default.example.yaml" "$home_dir/config/local.yaml"
fi
if [ ! -f "$home_dir/config/secrets.env" ]; then
  install -o "$user" -g "$user" -m 0600 /dev/null "$home_dir/config/secrets.env"
fi
if [ ! -f "$home_dir/config/rednote.env" ]; then
  install -o "$user" -g "$user" -m 0600 /dev/null "$home_dir/config/rednote.env"
fi

loginctl enable-linger "$user"
systemctl --user --machine="$user@.host" daemon-reload
systemctl --user --machine="$user@.host" enable mini-claw.service
echo "Installed. Configure $home_dir/config before starting."
