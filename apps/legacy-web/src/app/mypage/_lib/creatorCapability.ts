import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { isDesignatedCatalogCreator } from '@/infrastructure/supabase/eventCatalogWrite.ts';
import type { EventCatalogQueryClient } from '@/infrastructure/supabase/eventCatalogRead.ts';

/**
 * Whether the caller may see the "イベントを追加" row (Issue #193). This is
 * the exact same fail-closed resolution src/app/catalog/page.tsx's own
 * (currently unexported) resolveCanCreateEvent already performs for the
 * Catalog ActionRow's "+ 追加" affordance (Issue #29's designated-creator
 * boundary) - kept here rather than imported from that page module so this
 * Task does not have to touch src/app/catalog/page.tsx (its ActionRow
 * removal is a separate, later Task - see design_handoff_v2/issues/13-mypage.md
 * "呼び出し元"). A missing/unauthenticated user or a failed membership read
 * both resolve to `false`: an indeterminate check must never be treated as
 * "yes, may create" (product-rules.md "Post-MVP governance gate" /
 * "membership/read failureをfail-openしない").
 */
export async function resolveCanCreateEvent(client: EventCatalogQueryClient): Promise<boolean> {
  const user = await getAuthenticatedUser();
  const creatorCheck = user === null ? null : await isDesignatedCatalogCreator(client, user.id);
  return creatorCheck !== null && creatorCheck.ok && creatorCheck.data;
}
