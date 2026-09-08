import { z } from 'zod';
import { genreIdSchema } from './ids';

/**
 * Genre: a canonical lookup row, not a closed DB enum (AGENTS.md "Catalog
 * classification / venue boundary" §Genre, docs/v2/oracle-database.md
 * §1.12/§4). Gate A ships exactly 3 seed rows (宝塚/歌舞伎/アイドル), but
 * this schema does not hard-code that closed set - new genres are meant to
 * be addable as new rows, not as a schema/enum migration. An Event's genre
 * is 0..1 (nullable), which is why this module has no "no genre" sentinel
 * value of its own: absence is represented by `null` at the call site
 * (../catalog/eventClassification.ts), never a fabricated row.
 */
export const genreSchema = z.object({
  id: genreIdSchema,
  key: z.string().min(1),
  displayName: z.string().min(1),
  sortOrder: z.number().int(),
});

export type Genre = z.infer<typeof genreSchema>;
