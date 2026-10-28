CellGuard: files to ADD to your GitHub repository
================================================
Repo: https://github.com/tydeptrai21042004/CellGuard

1. Add these TWO files with their exact paths:
  .github/workflows/generate-public-testnet-policy.yml
  scripts/generate-public-testnet-policy.mjs

   Do NOT rename them. Do NOT change .github/workflows/real-testnet-audit.yml.

2. Commit and push those two files to main.

3. In GitHub Actions, select "CellGuard generate public Testnet policy",
   choose "Use workflow from: main" and click "Run workflow".
   There are NO input fields for this first workflow.
   When successful, it creates AND commits:
   configs/public-testnet-consolidation-v3.json

   If generation fails, inspect its logs; do NOT fabricate the JSON.
   If commit/push fails with a permissions error, download the policy
   artifact from that run and upload the actual JSON manually to the path
   above, or enable GitHub Actions Contents write permission.

4. In GitHub Actions, select "CellGuard manually triggered chain audit",
   choose "Use workflow from: main", and enter:

   tx_hash:
   0x6fb7350b37463df3e31fcfd5558651193fb8ff5dd3c824e0b1afe31892b90448

   profile_path:
   configs/public-testnet-consolidation-v3.json

   expected_status: pass
   required_codes: [LEAVE COMPLETELY EMPTY]
   min_confirmations: 6
   network: testnet

5. The public transaction is real and committed, but the RPC-backed audit
   and the generator have NOT been successfully executed against live RPC
   in this environment. If the generation workflow fails, inspect the
   exact error rather than assuming a pass.

6. This audit is a transaction-specific public consolidation demo,
   NOT evidence of a deployed CrowdCell contract or independently validated
   application-specific safety rules. Review generated policy before
   representing it as security evidence to third parties.
