# Migration-era historical index

This directory records the completed v2 rebuild and authority cutover. It is
historical material, not current product, architecture, or operational authority.

Current product behavior is in the relevant `specs/**/spec.md`; product scope and
future intent are in `docs/prd.md`, `docs/roadmap.md`, and GitHub Issues; UX is
in `docs/ux-ui.md`; structure and mechanics are in `docs/architecture/**`,
source, schema, migrations, and tests; procedures are in `docs/runbooks/**`.

## Remaining resolvers

- [`decisions.md`](./decisions.md) resolves historical identifiers still named
  by immutable migration comments and current historical references.
- [`oracle-database.md`](./oracle-database.md) resolves the database locator
  retained by an immutable migration comment.

The removed full records and comparison evidence remain recoverable from the
immutable [pre-compaction tree at
`891807ba2977466477b0292bd22ee51c2d80a3d9`](https://github.com/reitojike/stage-tracker/tree/891807ba2977466477b0292bd22ee51c2d80a3d9/docs/v2).
That snapshot is a historical locator only.
