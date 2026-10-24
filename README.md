## NEW in v0.5: application-level transaction invariants

CellGuard now supports **V3 capacity-flow policies**, exact role-based lock accounting, required transaction dependencies, input-aware net-gain checks, configurable `since` comparisons, read-only RPC preflight, and **committed-transaction historical policy auditing**. The synthetic 474 CKB finalizer-leak regression is included, along with pledge/finalize/refund policy examples.

### Update: Rick’s confirmed campaign-capacity rule (October 2026)

Rick clarified that his old v1.1 finalize bug **shrunk the typed campaign Cell from C to its occupied minimum M and paid C−M (≈474 CKB) to the finalizer**. The correct finalize output must retain **at least C**, and miner fees must come from the finalizer’s own Cells. The old transaction hash is unavailable; **this is synthetic evidence only**.

CellGuard now offers the opt-in v3 `preserve-typed-cell` capacity-flow rule, keyed by **exact type script** and enforcing one input + one output and `capacity_out >= capacity_in`, with **no fee allowance**. Read-only live and historical RPC paths retain input type metadata; omitted type evidence fails closed. The output includes a `capacityFlow.protectedCells` breakdown. This rule adds protection against untyped lookalike outputs with the same lock hiding campaign shrinkage; it is not a claim of actual CrowdCell code execution or independent verification of `error 17`.

See **[Rick’s capacity-preservation protocol](docs/14_RICK_CAMPAIGN_CAPACITY_PRESERVATION.md)** and `examples/profiles/crowdcell-preserve.example.json`. Do not use the older beneficiary-transfer `finalize.example.json` as proof of this specific invariant.

Start with **[V3 documentation and CLI examples](docs/10_V05_CAPACITY_FLOW.md)**. The example lock scripts and OutPoints are synthetic and **must not be used as real CrowdCell contract identifiers**. The test suite uses mocked RPC; it does not demonstrate the real CrowdCell defect on Testnet. No transaction is broadcast.

## Previously added in v0.4: live, read-only CKB verification

CellGuard now has an optional Node/Vercel backend (`/api/verify`) that queries CKB mainnet/testnet for input-cell liveness, exact fees, VM script execution / witness acceptance, `test_tx_pool_accept` (no broadcast), and existing transaction confirmation status. Offline policy inspection remains available without a network connection. **Node preflight is not independent consensus proof or on-chain finality.**

For complete deployment, API security, CLI and real browser E2E instructions, see [docs/09_LIVE_CKB_RPC_AND_E2E.md](docs/09_LIVE_CKB_RPC_AND_E2E.md).

```bash
npm run check
npm run dev
# Optional real-browser UI tests: npm run test:e2e (requires Python Playwright and Chromium)
```

---

# CellGuard — Browser Transaction Policy Terminal

A **terminal-style web interface plus real Node CLI** for offline CKB transaction-output inspection and application policy preflight. Browser prompt commands never execute system shell commands. `cli/cellguard.mjs` is an actual command-line tool intended for CI checks.

**Current release: v0.5.0 · static browser app with an optional read-only Node/Vercel RPC endpoint · no npm dependencies.**

> **Security scope:** Offline inspection does not establish chain validity. Optional read-only CKB RPC preflight and historical lookup can report node-observed input state, fees, script execution and commitment, but do **not** sign, broadcast, provide independent consensus proofs, or certify CrowdCell contract safety. Included example fixtures remain synthetic.

## Quick start

Requires Node.js 20+ only for local development and automated tests. No install step.

```bash
npm run dev
# visit http://localhost:3000

npm run check
```

### Terminal UI commands

| Command | Behavior |
| --- | --- |
| `inspect safe` | Analyze the synthetic passing-transfer fixture |
| `inspect risk` | Analyze a fixture with capacity/data/lock policy failures |
| `inspect type` | Analyze a synthetic output with a type script |
| `inspect json` | Analyze the JSON currently in the workbench editors |
| `load safe`, `load risk`, `load type` | Load a fixture into the editor without running the check |
| `load strict` | Apply strict v2 demo policy to current transaction |
| `diff` | Compare indexed outputs against the comparison JSON editor |
| `undo` | Restore editors from before the last automated replacement |
| `policy` | Open editable transaction and policy JSON |
| `help`, `examples`, `status`, `report` | Display command help and local state |
| `clear` | Clear the rendered report without changing editor inputs |

Use **open editor** to paste raw transaction JSON, upload a local `.json` file (max 1 MiB), and edit the policy. Click **inspect JSON** or press **Ctrl/⌘+Enter** inside an editor. Use **copy JSON** or **export report** to extract a result. All operations take place locally in the browser.

The offline `inspect` command requires transaction JSON, not a bare hash. Online **lookup hash** uses the read-only server and a configured CKB RPC; optional historical policy audit also requires a reviewed profile. Neither mode fabricates script groups or cycle counts.

## Native CLI / GitHub Actions

Run the same deterministic analyzer directly with Node, suitable for pull-request regression guards:

```bash
node cli/cellguard.mjs --transaction examples/safe-tx.json --policy examples/strict-policy.json
node cli/cellguard.mjs --transaction examples/safe-tx.json --policy examples/strict-policy.json --format json
node cli/cellguard.mjs --transaction examples/risk-tx.json --compare examples/safe-tx.json
```

Exit codes: `0` = configured checks pass; `1` = policy violation or warnings with `--fail-on-warning`; `2` = invalid input/configuration; `3` = inconclusive/untrusted verification in CI mode. Exit `0` does **not** establish independent chain validity or finality. See `docs/08_CELLGUARD_V03_USAGE.md` for v2 rule semantics and limitations.

## Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel select **Add New → Project → Import**.
3. Leave **Root Directory** as `.`, choose **Other** for framework, set **Output Directory** to `site`.
4. Leave Build Command unset and deploy; `vercel.json` supplies static settings and security headers.

The offline browser view requires no provider secrets. The optional `/api/verify` Node Function uses configured read-only CKB RPC endpoints; its CSP permits `connect-src 'self'` only, so the frontend talks to its own backend. Configure edge rate limits before a public high-traffic deployment. For more detailed deployment steps see [`docs/01_TRIEN_KHAI_VERCEL.md`](docs/01_TRIEN_KHAI_VERCEL.md).

## Raw transaction input

The inspector supports the CKB raw transaction **output portion** (v2 can additionally validate raw shape), for example:

```json
{
  "outputs": [
    {
      "capacity": "0x16b969d00",
      "lock": {
        "code_hash": "0x1111111111111111111111111111111111111111111111111111111111111111",
        "hash_type": "type",
        "args": "0x2222222222222222222222222222222222222222"
      },
      "type": null
    }
  ],
  "outputs_data": ["0x"]
}
```

Capacity values are hexadecimal shannons. Occupied capacity = `8 + lock script serialized field bytes + optional type script serialized field bytes + output data bytes` CKB. Outputs are limited to 512 and the web input to 1 MiB per JSON document.

**Note:** all hashes/args in synthetic examples are arbitrary testing values. The samples do not demonstrate correct inputs, witnesses, verified script execution, or chain inclusion.

## Application policy

`version: 1` keeps the original policy fields for compatibility and supports two optional **exact script allowlists**. Unknown keys are rejected so misspelled settings cannot silently disable intended rules.

```json
{
  "version": 1,
  "maxOutputs": 20,
  "maxDataBytesPerOutput": 256,
  "maxTotalDataBytes": 2048,
  "maxTotalOutputCapacityCKB": "1000",
  "maxFreeCapacityCKBPerOutput": "25",
  "allowedLockCodeHashes": [],
  "allowedTypeCodeHashes": [],
  "allowedLockScripts": [
    {
      "code_hash": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "hash_type": "type",
      "args": "0x2222222222222222222222222222222222222222"
    }
  ],
  "allowedTypeScripts": [],
  "denyTypeScripts": false
}
```

- `allowedLockScripts` and `allowedTypeScripts` compare **all three** of `code_hash`, `hash_type`, and `args`; no implicit args wildcard is accepted.
- `allowed*CodeHashes` are legacy code-hash-only policies and intentionally less restrictive. When both full-script and code-hash lists are configured, **both must match**.
- Empty lists mean **no allowlist restriction**. An empty type allowlist does not require a type script; `denyTypeScripts: true` forbids type scripts.
- All decimal CKB budget values must be nonnegative strings with at most eight fractional places.
- A finding marked `warning` (e.g. excess free capacity) does not imply a consensus error.

### Policy version 2

Policy v1 remains backward-compatible. Policy v2 adds strict raw transaction shape validation and opt-in recipient intent rules, type-script requirements, total-free-capacity budgets and exact output-count/amount bounds. The strict v2 preset in the UI is **a synthetic example**, not a general-purpose safe policy. See [`docs/08_CELLGUARD_V03_USAGE.md`](docs/08_CELLGUARD_V03_USAGE.md) and [`examples/strict-policy.json`](examples/strict-policy.json).

JSON input now rejects duplicate keys and enforces bounded size, depth and tokens. Unknown transaction fields are a **warning** for policy v1 and an **error** in v2 strict mode.

## Project files

```text
site/
  index.html                # Accessible terminal UI, report and JSON editors
  assets/
    styles.css              # Responsive neon-green terminal theme
    main.mjs                # Browser interactions; no eval, shell or RPC
    lib/
      terminal.mjs          # Allowlisted terminal-command parser
      ckb.mjs               # BigInt and CKB capacity parsing
      policy.mjs            # Strict policy validation and exact script rules
      analyzer.mjs          # Pure offline report generator
      fixtures.mjs          # Three synthetic samples
      strict-json.mjs       # Duplicate-key-rejecting bounded parser
      diff.mjs              # Indexed output comparison
cli/
  cellguard.mjs            # Native Node CI runner; offline or read-only RPC, no wallet
examples/                   # Synthetic transaction and strict-policy JSON
scripts/
  serve.mjs                 # Local HTTP dev server
  check-build.mjs           # Static checks
.github/workflows/ci.yml   # GitHub Actions Node 22 checks
tests/                     # Unit, security regression, deployment and command tests
vercel.json                # No-build static site + CSP
```

## Verification and roadmap

Run `npm run check` to verify the deterministic analyzer, v2 policy constraints, duplicate-key parser, CLI, negative tests, command parser, asset syntax, and Vercel configuration. CI executes the same checks without installing dependencies.

The opt-in read-only RPC integration is implemented, with a bounded streaming parser and per-instance concurrent-request limit. It still requires externally configured edge rate limits for public traffic, actual Testnet evidence with verified deployment identities, and independent builder execution. See [Testnet evidence and remaining technical debt](docs/15_TESTNET_EVIDENCE_AND_DEBT.md).

More documents are in `docs/`. The repository is an MIT-licensed experimental developer tool, not an audit certificate or funding approval.

### Rick's CrowdCell review: role requirements and reproducible evidence

CellGuard v3 profiles now support `roleRequirements` for exact input/output lock-role presence, aggregate capacity and count bounds. The `finalize`, `pledge` and `refund` example profiles include basic role requirements, and `npm run test:policies` runs **21 exact synthetic safety scenarios** including a 474 CKB finalizer diversion, required dep, `since` and missing source/recipient cases. `npm run check` runs the regression suite.

The new [policy and Testnet audit guide](docs/12_RICK_POLICY_ROLES_REORG_AND_CHAIN_EVIDENCE.md) covers historical reorg protection and how to run a **manual GitHub Actions historical RPC audit** of a real transaction with a real, non-example profile. Local fixture metadata must not be presented as Testnet evidence; real profile hashes and business rules must be independently checked before claiming application safety.
