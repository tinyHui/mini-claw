#!/usr/bin/env bash
set -euo pipefail

REPO="${MINI_CLAW_REPO:-tinyHui/mini-claw}"
APP_ROOT="${MINI_CLAW_APP_ROOT:-$HOME/mini-claw}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
ENV_FILE="${MINI_CLAW_ENV_FILE:-$APP_ROOT/.env}"
SERVICE_NAME="${MINI_CLAW_SERVICE_NAME:-mini-claw}"
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
runs database migrations, and restarts the user systemd service.
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

	if have_cmd node && have_cmd pnpm && have_cmd pi; then
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

install_service() {
	local node_path
	local service_dir="$HOME/.config/systemd/user"
	local service_file="$service_dir/${SERVICE_NAME}.service"

	have_cmd systemctl || fail "systemctl is required for service installation"
	node_path="$(command -v node)"
	[ -n "$node_path" ] || fail "node is not available"

	mkdir -p "$service_dir"
	sed \
		-e "s|__APP_DIR__|$CURRENT_LINK|g" \
		-e "s|__ENV_FILE__|$ENV_FILE|g" \
		-e "s|__NODE_PATH__|$node_path|g" \
		-e "s|__HOME__|$HOME|g" \
		"$CURRENT_LINK/scripts/pi/mini-claw.service.template" >"$service_file"

	systemctl --user daemon-reload
	systemctl --user enable "$SERVICE_NAME"
	systemctl --user restart "$SERVICE_NAME"

	log "Service restarted: systemctl --user status $SERVICE_NAME"
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
	install_service

	log "Deployed Mini-Claw $VERSION"
	log "Manual auth remains manual: run 'pi /login' if Pi is not authenticated"
}

main "$@"
