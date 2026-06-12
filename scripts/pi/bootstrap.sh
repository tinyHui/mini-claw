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

install_pi_agent() {
	if have_cmd pi; then
		log "pi-coding-agent already installed at $(command -v pi)"
		return
	fi

	log "Installing pi-coding-agent globally"
	npm install -g @mariozechner/pi-coding-agent
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
	install_pi_agent
	prepare_directories
	prepare_env_file

	log "Bootstrap complete"
	log "Manual steps remaining: edit $ENV_FILE and run 'pi /login'"
}

main "$@"
