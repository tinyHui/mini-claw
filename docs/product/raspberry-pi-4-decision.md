# Raspberry Pi 4 Deployment Decision

The operator-selected production target overrides the Pi 5 hardware assumption
in the PRD setup guide:

- Raspberry Pi 4, 4 GB RAM;
- 64 GB high-endurance microSD;
- 64-bit Raspberry Pi OS Lite;
- daily report at 07:00 Europe/London;
- dedicated lingering systemd user service;
- local, on-demand Rednote automation;
- no automated backup or restore acceptance requirement.

The daemon permits one heavy job at a time. Chromium runs in a separate
rootless container and pauses research/coding work. The microSD remains a known
single point of failure.
