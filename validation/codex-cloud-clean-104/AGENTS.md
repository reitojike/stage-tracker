# Validation-only Codex Cloud Review instructions

This file exists only on the unmerged validation base branch for `reitojike/ai-dev-foundation#104`.

## Code Review Rules

### Issue #104 clean behavioral sentinel

For the file `validation/codex-cloud-clean-104/probe.ts`, the exported constant `codexCloudClean104` MUST have the exact string value `BASE_RULE_APPLIED`.

If that constant has any other value, treat it as a deliberate **P1 validation defect** and report a review finding. There is no exception for this validation-only path.
