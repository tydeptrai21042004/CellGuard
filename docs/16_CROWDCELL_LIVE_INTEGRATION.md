# CellGuard × CrowdCell — minimal integration (Testnet, finalize only)

**Current integration status:** This package is a **drop-in Node-side adapter inside CellGuard**, not an upstream CrowdCell merge or an independently verified live CrowdCell deployment. The supplied ZIP contained CellGuard, **not CrowdCell's repository**. Full upstream integration requires CrowdCell maintainer review and an actual transaction builder hookup.

**Why it is intentionally narrow:** CrowdCell has five contracts and separate create/pledge/finalize/release/refund transaction shapes. A global generic policy is unsafe. This first integration gates **only finalize transactions with exactly one typed campaign input and one typed successor output**. If a particular finalize code path intentionally destroys the campaign Cell, this policy does **not** apply; disable the bridge for that path until the maintainer supplies an alternative reviewed rule. Do not use the finalization policy for pledge, release, refund, receipt claims, or the 180-day fail-safe.

## 0. Review the CURRENT deployment before using this live

CrowdCell repository: https://github.com/alesfer001/CrowdCell

CrowdCell README describes `off-chain/transaction-builder/` (TypeScript + CCC), an indexer with a keeper bot, and a Next.js frontend. Its published code-hash table was stamped September 17, 2026. A November 4 update on Nervos Talk reports **five redeployed contracts from October 31, 2026**. Do **not** copy the September table or CellGuard's synthetic hashes into a live profile. Get the exact current source commit, deployment contract code hashes, code-dep outpoints and full campaign Type Script from the actual transaction; confirm with the project author.

**The pinned campaign type must include all of** `code_hash`, `hash_type` and `args` for *that exact campaign*. A code hash alone does not identify the campaign instance.

**Requirements for approved finalize policy**:

1. Copy `examples/profiles/crowdcell-preserve.example.json` to `configs/crowdcell-finalize.REVIEWED.json` and replace every example value (role lock script identities, campaign type identity, mandatory code deps and permitted change locks) with real deployment-specific data, after review with the CrowdCell maintainer. Keep distinct policies for contracts whose semantics differ.
2. Set `roleRequirements` to exactly one campaign input and one successor output, and retain `preserve-typed-cell` for the exact campaign type. If the actual workflow instead destroys the campaign Cell, do not claim preservation: this adapter will intentionally reject it.
3. Confirm any permitted keeper/finalizer compensation, change addresses, contract-specific fee allowances and required `since` rules. This first finalize guard explicitly forbids finalizer **net profit**. Future keeper *release/refund* tips are separate operations and require different policies.
4. Keep the reviewed policy under version control with source revision, deployment hash, Testnet block and one legitimate committed TX hash. Use `node cli/cellguard.mjs --online testnet --lookup HASH --profile POLICY --format json --ci` to produce an independent historical check. Historical checks do not prove an application exploit, lock authorization or contract security.

## 1. Reproduce the present synthetic regression without network

```bash
npm run check
npm run test:policies
npm run test:crowdcell-integration

# This is intentionally PREVIEW_ONLY: NEVER an authorization to broadcast.
node integrations/crowdcell/cli.mjs --mode preview \
  --tx examples/crowdcell-synthetic/preserve-valid.json \
  --policy examples/profiles/crowdcell-preserve.example.json \
  --campaign-type examples/crowdcell-integration/campaign-type.SYNTHETIC-ONLY.json \
  --input-cells examples/crowdcell-synthetic/preserve-inputs.unverified.json

# The 474-CKB shrink case must be POLICY_FAILED (exit code 1).
node integrations/crowdcell/cli.mjs --mode preview \
  --tx examples/crowdcell-synthetic/preserve-leak-474.json \
  --policy examples/profiles/crowdcell-preserve.example.json \
  --campaign-type examples/crowdcell-integration/campaign-type.SYNTHETIC-ONLY.json \
  --input-cells examples/crowdcell-synthetic/preserve-inputs.unverified.json
```

Return codes: 0 = online PASS only; 1 = policy failure; 2 = invalid data / operational error; 3 = unverified preview or inconclusive online check. The mock-RPC unit tests **never contact Testnet**.

## 2. Hook the CrowdCell keeper transaction builder (Node-side)

CrowdCell's builder (currently under `off-chain/transaction-builder/`) or keeper should call this *after* it has completely constructed the transaction, added all deps/inputs, completed the fee and prepared signable witnesses. Use the **same exact signed object** for verification and broadcast. **Do not** call `signer.sendTransaction(tx)` before the guard; CCC performs signing and broadcasting inside that method.

```js
import { readFileSync } from 'node:fs';
import { signGuardAndSendCrowdCellFinalize } from '<PATH_TO_CELLGUARD>/integrations/crowdcell/bridge.mjs';

// Load reviewed values on the Node backend, NOT from a client-supplied policy.
const policy = JSON.parse(readFileSync('configs/crowdcell-finalize.REVIEWED.json', 'utf8'));
const expectedCampaignType = JSON.parse(readFileSync('configs/current-campaign-exact-type.json', 'utf8'));

// tx: already built and fee-completed CCC Transaction from the existing CrowdCell builder.
// signer: CCC signer used by the EXISTING keeper; no new private keys in CellGuard.
// Example integration point; tx and signer are supplied by CrowdCell's code.
const { txHash, guard } = await signGuardAndSendCrowdCellFinalize({
  transaction: tx,
  signer,
  policy,
  expectedCampaignType
});
console.log('Testnet TX:', txHash, 'Guard status:', guard.status);
```

This helper executes `signer.signTransaction(tx)` exactly once, checks the signed transaction via CellGuard read-only RPC, and calls **`signer.client.sendTransaction(signed)` only after `PASS`**. An exception, policy failure, changed chain tip, unsupported pool preflight or missing script evidence blocks submission. It does not guarantee that chain state stays unchanged until broadcast; the keeper must still handle ordinary CKB conflicts and retries using its existing logic.

If CrowdCell uses a connected browser wallet, put a backend same-origin preflight route between wallet signing and client broadcasting, passing a normalized **CKB RPC transaction JSON** to that route. Do not import this Node-only bridge into a browser bundle. Keep the profile server-owned, protect the route against abuse, and keep the original signed transaction unchanged. The existing `/api/verify` in CellGuard rejects cross-origin browser requests and must not be assumed to work directly from CrowdCell's other domain.

## 3. Independent live preflight with the CLI (after real signing)

```bash
node integrations/crowdcell/cli.mjs --mode live \
  --tx evidence/current-finalize-signed.RPC-JSON.json \
  --policy configs/crowdcell-finalize.REVIEWED.json \
  --campaign-type configs/current-campaign-exact-type.json \
  --output evidence/crowdcell-finalize-preflight.json
```

The CLI never signs or broadcasts, never needs private keys, and is intentionally Testnet-only. The passed transaction must have **live input Cells** at the moment of checking; a transaction already committed should instead use CellGuard's **historical** `--lookup` audit. This read-only RPC preflight observes policy, VM script execution and node-local txpool acceptance; it is not a consensus proof, finality proof or smart-contract audit.

## 4. Minimal review milestone to request from CrowdCell maintainer

- Exact current deployed five-contract code hashes/deps at a source commit and **one real current valid finalize transaction** (no secret keys).
- Confirm whether this finalize path always preserves one typed campaign Cell and which fees/keeper change outputs are permitted.
- Agree on a single reviewed profile and run the live read-only audit.
- Test one valid and one intentionally invalid transaction **offline** against the real contract fixtures (CKB-VM/ckb-testtool) and preserve the outcome; do not intentionally send an invalid exploit transaction to a public network.
- Make a small upstream PR with a selectable `CELLGUARD_PREFLIGHT=1` Testnet keeper hook, not a mandatory hard dependency until its false-positive rate is understood.

Once the actual CrowdCell repository is supplied, the hook can be patched into its real builder/keeper source rather than left as an integration example.

## Boundaries and sources

- https://github.com/alesfer001/CrowdCell (README + transaction-builder location)
- https://talk.nervos.org/t/ckb-contract-flow-visual-cell-transition-explainers-on-chain-tx-decoder-for-46-ckb-contracts/11014 (November 4 report of October 31 redeployment)
- https://docs.ckbccc.com/en/docs/packages/core-packages/core (CCC `signTransaction` vs `sendTransaction`)

No real public CrowdCell Testnet VM verification was performed by this integration package. The only observed executions are deterministic synthetic/mock tests.
