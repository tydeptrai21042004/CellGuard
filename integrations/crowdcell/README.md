# CrowdCell bridge (minimal Testnet finalize pilot)

See [`docs/16_CROWDCELL_LIVE_INTEGRATION.md`](../../docs/16_CROWDCELL_LIVE_INTEGRATION.md).

**No mainnet support. No embedded private keys. No external broadcast by CLI.**

- `bridge.mjs`: CCC->RPC format conversion, synthetic offline preview (never approves), strict campaign-preservation policy validation, live RPC/VM/pool preflight (fails closed), optional guarded CCC keeper send helper.
- `cli.mjs`: `preview` vs `live` read-only command.

A real merged integration into CrowdCell requires its source repository and an author-reviewed profile for the currently deployed contract and campaign.
