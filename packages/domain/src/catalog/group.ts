import { z } from 'zod';
import { groupIdSchema } from './ids';

/**
 * Group: the generic canonical identity shared by 宝塚's 組 and an idol's
 * グループ (AGENTS.md "Catalog classification / venue boundary" §Group,
 * docs/v2/oracle-database.md §1.13). Deliberately not genre-scoped at the
 * schema level - a Group's relationship to any particular genre is derived
 * dynamically from which Events (and their genre) it is actually associated
 * with via `event_groups`, never a direct `genreId` column on this row.
 */
export const groupSchema = z.object({
  id: groupIdSchema,
  key: z.string().min(1),
  displayName: z.string().min(1),
});

export type Group = z.infer<typeof groupSchema>;
