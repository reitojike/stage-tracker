# Migration-era decision locator

**Status: historical record, not current authority.** Current behavior and
operational contracts belong to Living Specs, architecture, runbooks, executable
configuration, source, and tests.

The full decision log is preserved at the exact pre-compaction commit:
[`decisions.md at 891807ba2977466477b0292bd22ee51c2d80a3d9`](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md).
Links in this resolver identify historical records; they do not reinstate them as
current requirements.

| Historical identifier | Historical record locator                                                                                                                               | Current owner, where applicable                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D1 = D                | [PO decision and rationale](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L1038)        | [Runtime stack](../architecture/runtime-stack.md); [remote environment runbook](../runbooks/gate-a-remote-environment.md) |
| A8                    | [Runtime-first ordering rationale](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L1115) | [Runtime stack](../architecture/runtime-stack.md); [remote environment runbook](../runbooks/gate-a-remote-environment.md) |
| P5                    | [FK `ON DELETE` decision](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L156)           | Current schema, migrations, and DB tests                                                                                  |
| A1                    | [Button variant / size decision](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L25)     | [Shared UX/UI contract](../ux-ui.md) and `packages/ui`                                                                    |
| A2                    | [Undefined token finding](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L26)            | [Shared UX/UI contract](../ux-ui.md) and current styles                                                                   |
| P2                    | [Primary navigation decision](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L122)       | Current navigation and [UX/UI contract](../ux-ui.md)                                                                      |
| A14                   | [Index consolidation finding](https://github.com/reitojike/stage-tracker/blob/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2/decisions.md#L61)        | Migration and current DB test                                                                                             |

Other removed decision text is available in the full immutable record above.
