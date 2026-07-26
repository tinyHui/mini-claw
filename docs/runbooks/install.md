# Raspberry Pi 4 Installation

Target: 64-bit Raspberry Pi OS Lite, Raspberry Pi 4 with 4 GB RAM, and a
64 GB high-endurance microSD card.

1. Install reviewed host prerequisites: Node.js 24, pnpm, git, bubblewrap,
   sqlite3, jq, ffmpeg, rootless Podman, and zram support.
2. Run `scripts/dev/preflight.sh`; resolve every failure.
3. On the Raspberry Pi checkout, run `pnpm install --frozen-lockfile` and
   `make check`. Dependencies are installed and native/ARM64 compatibility is
   verified on that target host, not on a mounted remote development volume.
4. Build with `make build`.
5. Run `sudo make service-install`.
6. Create `/var/lib/growth-agent/config/local.yaml` from the example and
   `/var/lib/growth-agent/config/secrets.env` with mode `0600`.
7. Set `TELEGRAM_BOT_TOKEN` and a numeric `TELEGRAM_OWNER_ID`. Do not copy the
   repository `.env`; migrate only reviewed values manually.
8. Start and inspect the service with `make service-start`,
   `make service-status`, and `make service-logs`.

For foreground development on the Raspberry Pi, run `make dev`. This uses
pnpm/tsx watch mode and restarts the daemon after TypeScript changes.

The install helper does not install OS/npm/Pi dependencies and does not import
credentials. Uninstall preserves `/var/lib/growth-agent`.
