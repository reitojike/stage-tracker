# Validation-only Codex Cloud Review instructions

This file exists only on the unmerged validation branch for `reitojike/ai-dev-foundation#104`.

## Code Review Rules

### Issue #104 behavioral sentinel

For the changed file `validation/codex-cloud-104/probe.ts`, the exported constant `codexCloudRule104` MUST have the exact string value `RULE_APPLIED`.

If that constant has any other value, treat it as a deliberate **P1 validation defect** and report a review finding. There is no exception for this validation branch: the mismatch is intentionally the defect being probed.
