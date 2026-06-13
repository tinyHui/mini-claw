#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22}"
PNPM_VERSION="${PNPM_VERSION:-10}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
APP_ROOT="${MINI_CLAW_APP_ROOT:-$HOME/mini-claw}"
ENV_FILE="${MINI_CLAW_ENV_FILE:-$APP_ROOT/.env}"
WORKSPACE_DIR="${MINI_CLAW_WORKSPACE:-$HOME/mini-claw-workspace}"
SESSION_DIR="${MINI_CLAW_SESSION_DIR:-$HOME/.mini-claw/sessions}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log() {
	printf '[mini-claw bootstrap] %s\n' "$*"
}

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

install_system_packages() {
	if ! have_cmd apt-get; then
		log "apt-get not found; skipping system package installation"
		return
	fi

	local packages=(
		ca-certificates
		curl
		g++
		git
		make
		sudo
		build-essential
		pkg-config
		python3
		libsqlite3-dev
	)
	local missing=()
	local package

	for package in "${packages[@]}"; do
		if ! dpkg -s "$package" >/dev/null 2>&1; then
			missing+=("$package")
		fi
	done

	if [ "${#missing[@]}" -eq 0 ]; then
		log "System packages already installed"
		return
	fi

	log "Installing missing system packages: ${missing[*]}"
	sudo_cmd apt-get update
	sudo_cmd apt-get install -y "${missing[@]}"
}

install_nvm() {
	if [ -s "$NVM_DIR/nvm.sh" ]; then
		log "nvm already installed at $NVM_DIR"
		return
	fi

	log "Installing nvm"
	mkdir -p "$NVM_DIR"
	curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
}

load_nvm() {
	# shellcheck source=/dev/null
	. "$NVM_DIR/nvm.sh"
}

install_node_and_pnpm() {
	load_nvm
	log "Installing and selecting Node.js $NODE_VERSION"
	nvm install "$NODE_VERSION"
	nvm alias default "$NODE_VERSION"
	nvm use "$NODE_VERSION"

	log "Enabling pnpm through Corepack"
	corepack enable
	corepack prepare "pnpm@$PNPM_VERSION" --activate
}

package_dependency_version() {
	local package_name="$1"
	local package_file

	for package_file in "$RELEASE_ROOT/package.json" "$APP_ROOT/current/package.json" "./package.json"; do
		if [ -f "$package_file" ]; then
			node -e '
const fs = require("node:fs");
const packageFile = process.argv[1];
const packageName = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
const version = pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName] || "";
process.stdout.write(version.replace(/^[~^]/, ""));
' "$package_file" "$package_name"
			return
		fi
	done
}

npm_package_spec() {
	local install_package="$1"
	local version_package="${2:-$install_package}"
	local version

	version="$(package_dependency_version "$version_package")"
	if [ -n "$version" ]; then
		printf '%s@%s' "$install_package" "$version"
	else
		printf '%s' "$install_package"
	fi
}

install_global_cli() {
	local command_name="$1"
	local install_package="$2"
	local version_package="${3:-$install_package}"
	local package_spec

	if have_cmd "$command_name"; then
		log "$command_name already installed at $(command -v "$command_name")"
		return
	fi

	package_spec="$(npm_package_spec "$install_package" "$version_package")"
	log "Installing $package_spec globally for $command_name"
	npm install -g "$package_spec"
}

install_global_tools() {
	install_global_cli pi @mariozechner/pi-coding-agent
	install_global_cli pm2 pm2
	install_global_cli codex @openai/codex @openai/codex-sdk
}

prepare_directories() {
	log "Creating app, workspace, and session directories"
	mkdir -p "$APP_ROOT" "$WORKSPACE_DIR" "$SESSION_DIR"

	if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
		cat >"$WORKSPACE_DIR/SOUL.md" <<'SOUL'
# Mini-Claw System Prompt

Replace this file with the operating instructions you want Pi to use.
SOUL
		log "Created placeholder $WORKSPACE_DIR/SOUL.md; edit it before starting the service"
	fi
}

prepare_env_file() {
	if [ -f "$ENV_FILE" ]; then
		log "Environment file already exists at $ENV_FILE"
		return
	fi

	if [ -f "$RELEASE_ROOT/.env.example" ]; then
		cp "$RELEASE_ROOT/.env.example" "$ENV_FILE"
	elif [ -f "$APP_ROOT/current/.env.example" ]; then
		cp "$APP_ROOT/current/.env.example" "$ENV_FILE"
	elif [ -f ".env.example" ]; then
		cp ".env.example" "$ENV_FILE"
	else
		mkdir -p "$(dirname "$ENV_FILE")"
		touch "$ENV_FILE"
	fi

	log "Created $ENV_FILE; fill TELEGRAM_BOT_TOKEN before starting Mini-Claw"
}

main() {
	install_system_packages
	install_nvm
	install_node_and_pnpm
	install_global_tools
	prepare_directories
	prepare_env_file

	log "Bootstrap complete"
	log "Manual steps remaining: edit $ENV_FILE and run 'pi /login'"
}

main "$@"
