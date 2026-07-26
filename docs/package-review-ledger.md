# Pi Package Review Ledger

No package is production-approved merely because it appears in
`.pi/settings.json`. Complete the PRD Section 9.2 review and Section 16.1 gates
on the target ARM64 host before changing a row to `accepted`.

| Package | Pin | Status | Required outcome |
|---|---:|---|---|
| @earendil-works/pi-coding-agent | 0.82.1 | pinned; compatibility pending | SDK-created sessions and clean shutdown |
| @llblab/pi-telegram | 0.24.11 | pending | SDK/headless transport or port transport layer |
| pi-schedule-prompt | 0.4.1 | pending | enqueue through durable daemon scheduler |
| @nqbao/pi-sandbox | 0.1.3 | pending | fail closed under bubblewrap |
| pi-scraper | 0.13.1 | pending | typed partial source failures |
| pi-mcp-adapter | 2.15.0 | pending | raw write tools remain unreachable |
| DataWhisker/x-mcp-server | commit pending | pending | official API, ARM64, lifecycle, and tool isolation |
| xpzouying/xiaohongshu-mcp | digest pending | pending | ARM64, loopback only, on-demand lifecycle |
