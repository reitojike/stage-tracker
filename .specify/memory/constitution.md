# stage-tracker Constitution

## Core Principles

### I. Living Spec Is the Current Product Authority

Current user-visible product behavior is documented in the relevant Living Spec under
`specs/**/spec.md`. A Living Spec is kept aligned with the implemented behavior and is
the first product-level reference for the behavior it owns.

### II. Separate Responsibilities by Artifact

Living Specs describe current behavior and user-visible rules. Architecture documents
describe current structure and boundaries. Runbooks describe current procedures.
Tests and CI enforce mechanical correctness. GitHub Issues and Git history preserve
change intent and historical context. No artifact silently assumes another artifact's
responsibility.

### III. Standard-First, Not Standard-Always

Use GitHub Spec Kit, framework capabilities, and established tools before introducing
project-local machinery. A standard workflow or artifact may be intentionally omitted
when the current task does not need it; the omission must not become a general rule for
future work.

### IV. Keep Safety Deterministic

Correctness, security, data integrity, and release safety that can be checked by a
machine MUST remain in executable configuration, tests, or CI. Prose guidance may
explain the boundary but MUST NOT be the only enforcement mechanism.

### V. Prefer Bounded Ownership

Project-owned helpers and configuration MUST have a demonstrated project need and the
smallest scope that satisfies it. Foundation compatibility layers, custom routing, and
speculative abstractions MUST NOT be introduced without a repeated real-work need that
cannot be met by the standard or an established tool.

## Artifact Boundaries

The repository's current navigation points to the relevant standard Spec Kit surface,
Living Spec, architecture, runbook, test, or history artifact. Legacy material may be
retained temporarily for domains that have not yet completed their own authority
cutover, but it MUST be labeled as temporary or historical rather than presented as a
second current authority.

## Development Workflow

Each task chooses the standard workflow artifacts that materially help its work. A
normal feature, bug fix, or database migration evaluates the applicable Spec Kit
workflow in real use. Quality and safety verification remains required at the level
appropriate to the changed artifacts.

## Governance

This constitution is project-level guidance for artifact authority, responsibility
boundaries, standard adoption, and deterministic safety. It does not replace a
feature's GitHub Issue, current architecture, tests, or operational runbook.

Amendments MUST state the affected principles, preserve the artifact boundaries, and
update the version and amendment date. A new principle or materially expanded guidance
increments the minor version; a backward-incompatible redefinition increments the
major version; wording-only clarification increments the patch version.

**Version**: 1.0.0 | **Ratified**: 2026-09-15 | **Last Amended**: 2026-09-15
