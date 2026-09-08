import { z } from 'zod';

/**
 * Opaque, branded identifiers for the Catalog classification sub-domain
 * (AGENTS.md "Catalog classification / venue boundary", docs/v2/
 * oracle-database.md §1.12-§1.14). Defined here rather than in the shared
 * `../ids.ts` for the same directory-boundary reason as ../schedule/ids.ts
 * and ../ticket/ids.ts: this Task's directory boundary excludes that file.
 */

export const genreIdSchema = z.uuid().brand<'GenreId'>();
export type GenreId = z.infer<typeof genreIdSchema>;

export const groupIdSchema = z.uuid().brand<'GroupId'>();
export type GroupId = z.infer<typeof groupIdSchema>;
