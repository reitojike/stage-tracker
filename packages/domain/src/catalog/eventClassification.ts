import { z } from 'zod';
import { eventIdSchema } from '../ids';
import { genreSchema } from './genre';
import { groupIdSchema } from './ids';

/**
 * EventClassification: one Event's classification facets, joined for
 * display (`specs/011-catalog-classification-filter/spec.md`).
 *
 * `genre` is the full resolved `Genre` row (0..1, `null` = unclassified) -
 * the Event's genre is asymmetric with its groups on purpose
 * (`specs/011-catalog-classification-filter/spec.md`): a single nullable FK vs. a
 * many-to-many join. `groupIds` is therefore a plain id array (0..N), not
 * resolved `Group` rows - the caller joins against a separately-read
 * catalog-wide Group lookup (../catalog/group.ts) to get display names,
 * mirroring how the Group lookup itself is genre-independent.
 *
 * `venue` is deliberately absent from this type: it lives directly on the
 * Event row (`events.venue`, a plain nullable text column, no canonical
 * venue master - `specs/011-catalog-classification-filter/spec.md`), not as a classification facet.
 */
export const eventClassificationSchema = z.object({
  eventId: eventIdSchema,
  genre: genreSchema.nullable(),
  groupIds: z.array(groupIdSchema),
});

export type EventClassification = z.infer<typeof eventClassificationSchema>;
