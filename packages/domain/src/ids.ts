import { z } from 'zod';

/**
 * Opaque, branded identifiers.
 *
 * The catalog is a shared read surface across authenticated users; keeping
 * `EventId`/`OccurrenceId`/`UserId` as distinct nominal types prevents mixing
 * them up positionally (e.g. passing an `eventId` where an `occurrenceId` is
 * expected) even though all three are plain UUID strings on the wire.
 */

export const userIdSchema = z.uuid().brand<'UserId'>();
export type UserId = z.infer<typeof userIdSchema>;

export const eventIdSchema = z.uuid().brand<'EventId'>();
export type EventId = z.infer<typeof eventIdSchema>;

export const occurrenceIdSchema = z.uuid().brand<'OccurrenceId'>();
export type OccurrenceId = z.infer<typeof occurrenceIdSchema>;
