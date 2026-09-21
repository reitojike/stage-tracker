import { z } from 'zod';

/**
 * Opaque, branded identifiers for the Catalog classification sub-domain
 * (`specs/011-catalog-classification-filter/spec.md`). Defined here rather than in the shared
 * `../ids.ts` for the same directory-boundary reason as ../schedule/ids.ts
 * and ../ticket/ids.ts: this Task's directory boundary excludes that file.
 */

export const genreIdSchema = z.uuid().brand<'GenreId'>();
export type GenreId = z.infer<typeof genreIdSchema>;

export const groupIdSchema = z.uuid().brand<'GroupId'>();
export type GroupId = z.infer<typeof groupIdSchema>;
