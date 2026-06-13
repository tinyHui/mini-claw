#!/usr/bin/env bash
set -euo pipefail

REPO="${MINI_CLAW_REPO:-tinyHui/mini-claw}"
APP_ROOT="${MINI_CLAW_APP_ROOT:-$HOME/mini-claw}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
ENV_FILE="${MINI_CLAW_ENV_FILE:-$APP_ROOT/.env}"
VERSION=""
RUN_BOOTSTRAP=1

log() {
	printf '[mini-claw deploy] %s\n' "$*"
}

fail() {
	printf '[mini-claw deploy] ERROR: %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<USAGE
Usage: $0 [--version vX.Y.Z] [--repo owner/name] [--skip-bootstrap]

Downloads a Mini-Claw release from GitHub, installs dependencies on this Pi,
runs database migrations, and reloads Mini-Claw through pm2.
USAGE
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--version)
			VERSION="${2:-}"
			[ -n "$VERSION" ] || fail "--version requires a value"
			shift 2
			;;
		--repo)
			REPO="${2:-}"
			[ -n "$REPO" ] || fail "--repo requires owner/name"
			shift 2
			;;
		--skip-bootstrap)
			RUN_BOOTSTRAP=0
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			fail "Unknown argument: $1"
			;;
	esac
done

have_cmd() {
	command -v "$1" >/dev/null 2>&1
}

sudo_cmd() {
	if [ "$(id -u)" -eq 0 ]; then
		"$@"
	else
		sudo "$@"
	fi
}

load_nvm_if_present() {
	export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
	if [ -s "$NVM_DIR/nvm.sh" ]; then
		# shellcheck source=/dev/null
		. "$NVM_DIR/nvm.sh"
		nvm use "${NODE_VERSION:-22}" >/dev/null
	fi
}

latest_version() {
	curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
		| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
		| head -n 1
}

run_bootstrap_if_needed() {
	if [ "$RUN_BOOTSTRAP" -eq 0 ]; then
		return
	fi

	if have_cmd node && have_cmd pnpm && have_cmd pi && have_cmd pm2 && have_cmd codex; then
		log "Core tools already available; skipping bootstrap"
		load_nvm_if_present
		return
	fi

	if [ -x "$CURRENT_LINK/scripts/pi/bootstrap.sh" ]; then
		"$CURRENT_LINK/scripts/pi/bootstrap.sh"
	elif [ -x "./scripts/pi/bootstrap.sh" ]; then
		"./scripts/pi/bootstrap.sh"
	else
		log "Bootstrap script is not available yet; using downloaded release after extraction"
	fi
}

download_release() {
	local version="$1"
	local dest="$2"
	local artifact="mini-claw-${version}.tar.gz"
	local url="https://github.com/${REPO}/releases/download/${version}/${artifact}"

	log "Downloading $url"
	curl -fL "$url" -o "$dest"
}

install_dependencies() {
	log "Installing production dependencies"
	pnpm install --frozen-lockfile --prod=false
}

run_migrations() {
	if [ -f "miniclaw.db" ]; then
		log "Running database migrations"
	else
		log "Creating database with Drizzle migrations"
	fi
	pnpm db:migrate
}

configure_pm2_systemd() {
	local pm2_service="pm2-$USER"

	have_cmd systemctl || fail "systemctl is required for pm2 startup"
	have_cmd pm2 || fail "pm2 is not available"

	if sudo_cmd systemctl cat "$pm2_service" >/dev/null 2>&1; then
		log "Refreshing existing pm2 systemd startup service: $pm2_service"
	else
		log "Creating pm2 systemd startup service: $pm2_service"
	fi

	sudo_cmd env "PATH=$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"
	sudo_cmd systemctl daemon-reload
}

reload_pm2_apps() {
	have_cmd pm2 || fail "pm2 is not available"

	log "Starting/reloading Mini-Claw pm2 apps"
	export MINI_CLAW_PM2_APP_ROOT="$CURRENT_LINK"
	export MINI_CLAW_ENV_FILE="$ENV_FILE"
	pm2 startOrReload ecosystem.config.cjs --update-env
	pm2 save

	log "pm2 is managing Mini-Claw: pm2 status"
	log "systemd is managing pm2: systemctl status pm2-$USER"
}

enable_pm2_systemd() {
	local pm2_service="pm2-$USER"

	log "Enabling pm2 systemd startup service: $pm2_service"
	sudo_cmd systemctl enable --now "$pm2_service"
}

main() {
	if [ -z "$VERSION" ]; then
		have_cmd curl || fail "curl is required to discover the latest release"
		VERSION="$(latest_version)"
		[ -n "$VERSION" ] || fail "Could not determine latest release for $REPO"
	fi

	mkdir -p "$RELEASES_DIR"
	local_tmp="$(mktemp -d)"
	trap 'rm -rf "$local_tmp"' EXIT

	archive="$local_tmp/mini-claw-${VERSION}.tar.gz"
	release_dir="$RELEASES_DIR/$VERSION"

	download_release "$VERSION" "$archive"
	rm -rf "$release_dir"
	mkdir -p "$release_dir"
	tar -xzf "$archive" -C "$release_dir" --strip-components=1

	if [ "$RUN_BOOTSTRAP" -eq 1 ]; then
		"$release_dir/scripts/pi/bootstrap.sh"
	else
		load_nvm_if_present
	fi

	if [ ! -f "$ENV_FILE" ]; then
		cp "$release_dir/.env.example" "$ENV_FILE"
		log "Created $ENV_FILE; fill it before starting Mini-Claw"
	fi

	ln -sfn "$release_dir" "$CURRENT_LINK"
	cd "$CURRENT_LINK"
	ln -sfn "$ENV_FILE" .env

	install_dependencies
	run_migrations
	configure_pm2_systemd
	reload_pm2_apps
	enable_pm2_systemd

	log "Deployed Mini-Claw $VERSION"
	log "Manual auth remains manual: run 'pi /login' if Pi is not authenticated"
}

main "$@"
