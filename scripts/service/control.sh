#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "service control must run as root" >&2
  exit 1
fi

action=${1:-}
machine=growth-agent@.host
case "$action" in
  start|stop|restart|status)
    systemctl --user --machine="$machine" "$action" mini-claw.service
    ;;
  logs)
    journalctl --machine="$machine" --user-unit=mini-claw.service -f
    ;;
  *)
    echo "usage: control.sh start|stop|restart|status|logs" >&2
    exit 2
    ;;
esac
