# CellGuard — Rick feedback incremental patch

This patch contains only changed files. Copy files over the repository root, preserving paths.

Implemented:
- `maxFreeCapacityCKBPerOutput` defaults to `null`, disabling misleading high-unoccupied-capacity warnings; set a decimal CKB value explicitly to opt in.
- Version 2 `requiredCellDeps` accepts exact `out_point` plus `dep_type`, and fails missing/mismatched dependencies.
- Regression tests covering both behaviors.

Verification: `npm test`: 88 passed, 0 failed (Node.js).

Not implemented:
- committed-vs-preflight classification for spent inputs (requires chain transaction hash lookup and explicit historical mode)
- input/output capacity-flow constraints (requires authoritative input resolution; cannot be implemented securely using output-only analysis)
- since policies, per-transaction policy selection, complete English localization, or a genuine CrowdCell 474-CKB leak fixture.

Do not treat this incremental patch as production-ready or as validation of the user's actual CrowdCell transaction.
