# CellGuard v0.5 — Existing Actions Testnet evidence and remaining technical debt

## Existing workflow (unchanged)

Use **Actions → CellGuard manually triggered chain audit → Run workflow**. Its existing `real-testnet-audit.yml` performs a **read-only historical committed-transaction audit** through the CLI and configured CKB RPC. It uploads `evidence/real-chain-report.json` and `evidence/real-chain-manifest.json` on completion. This is the intended Testnet evidence path; no YAML editing is required.

Provide the real Testnet transaction hash, a **tracked and reviewed v3 deployment-specific profile**, `network=testnet`, `expected_status=pass` or `policy-failed`, and a reasonable minimum confirmation count. **For `policy-failed`, specify at least one exact `required_codes` finding.** For `pass`, leave `required_codes` blank. Do not use any `.example.json` profile. The workflow reports a failure if the observed RPC audit is missing required evidence or does not match the expected classification. An attempted run is not proof of success.

The validator checks the RPC-reported chain identity, canonical commitment, confirmation count, reported block, verified-by-node or unavailable proof classification, exact policy status, historical RPC input evidence, role-capacity accounting, expected exit code, and required negative finding codes. The manifest includes hashes of the raw report and profile, observed chain context, and the GitHub commit. It is an **RPC-backed policy audit**; the node is still the trust source, not an independently verified consensus proof.

### Running the same audit outside Actions

```sh
mkdir -p evidence
node cli/cellguard.mjs --online testnet --lookup 0xYOUR_REAL_TX_HASH \
  --profile configs/your-reviewed-testnet-policy.json \
  --format json --ci --output evidence/real-chain-report.json
```

The above command does not create the Actions manifest by itself. The existing workflow calls `scripts/validate-testnet-audit.mjs` with the configured audit environment variables. It intentionally treats a policy violation as CLI exit code **1** and an inconclusive lookup as exit code **3**, never as a successful negative finding.

## What the current workflow does not prove

- It does not obtain funds, sign/broadcast transactions, or run a new signed transaction through `test_tx_pool_accept` in its current historical-audit job. The CLI supports independent read-only *preflight* of a separately supplied signed transaction (`--transaction signed.json --online testnet --profile policy.json`), but this is not part of the unchanged workflow.
- It does not independently re-run historical CKB-VM execution or certify the actual CrowdCell type script's `error 17` response.
- It does not authenticate the CrowdCell business rule or lock/type/dependency identifiers. A maintainer-reviewed deployment policy and a current public transaction are still needed.
- A Testnet run must actually execute against a real RPC with current transaction evidence. Synthetic fixtures, unit-test mocks, and manually written manifests must not be described as real Testnet results.

## Technical changes included in this patch

1. The Vercel request reader avoids its lazy parsed `req.body` helper and uses a bounded raw stream. The same strict duplicate-key parser now applies in local Node and the deployed function.
2. The local HTTP endpoint counts raw bytes instead of repeatedly concatenating strings; the service rejects pre-parsed object payloads rather than silently bypassing strict JSON checks.
3. RPC responses are actually read with an upper byte ceiling, including chunked HTTP responses lacking `Content-Length`.
4. Up to six active verification requests per server instance are admitted; additional calls receive HTTP 429. This reduces accidental RPC exhaustion but **does not provide global distributed rate limiting**.
5. The existing Actions evidence validator now requires an exact named finding for failed policies and checks chain, block, proof and result consistency before marking the manifest as passed.
6. Mock-based security tests cover raw Vercel JSON, over-limit streaming, instance overload, and real-audit manifest validation. They do not claim to call the live CKB Testnet.

## Remaining debts requiring external evidence or deployment work

| Item | Why still open | Closing evidence |
| --- | --- | --- |
| Current CrowdCell deployment mapping | Repository examples contain intentionally synthetic identities | Maintainer-reviewed real profile and public current transaction hash |
| Testnet result | Source tests use mocked RPC | Successful real workflow run with uploaded report/manifest and real chain context |
| Independently repeated audit | An Actions run controlled only by the author is not external validation | Another builder reruns it from a reviewed SHA/profile and compares outputs |
| Negative real-contract VM test | Policy violations are not equivalent to the script's `error 17` | Actual deployed-script negative fixture and VM trace, if safely available |
| Distributed request abuse control | In-memory admission control is instance-local | Platform/edge WAF quota confirmed on deployed endpoint |
| Mandatory browser E2E in CI | Browser test currently remains optional and workflows are intentionally unchanged | Separate manual browser test transcript or future authorized CI update |
| Historical documentation | Some older docs target v0.3/v0.4 | Versioned docs cleanup as part of the next documentation release |

Keep original `.github/workflows/*.yml` files byte-identical when applying this patch. Only the code and docs supplied by the patch need to be copied into the repository.
