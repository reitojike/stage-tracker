# Migration-era database locator

**Status: historical resolver, not a current database specification.** Current DB
behavior is defined by the applied schema and migrations, current database tests,
and the relevant Living Specs.

The full historical oracle is preserved at the exact pre-compaction commit:
[`oracle-database.md at 891807ba2977466477b0292bd22ee51c2d80a3d9`](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/oracle-database.md).

## Immutable migration locator

The applied migration `20260908000100_consolidate_event_occurrences_event_id_index.sql`
refers to “§7 point 8 (A14, Issue #375 In Scope #3)”. Resolve it at [§7,
point 8 in the full oracle](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/oracle-database.md#L1141);
the A14 decision record is also available
[here](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L61),
alongside [Issue #375](https://github.com/reitojike/stage-tracker/issues/375).
The current implementation is the applied migration and current DB test; this
historical locator does not specify current schema behavior.
