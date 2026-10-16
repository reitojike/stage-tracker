import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import { StatePanel } from "@stage-tracker/ui";
import type { Database } from "@/lib/data/database.types";
import {
  getScheduleContactRegistrationEnabled,
  listScheduleContacts,
} from "@/lib/data/reads/scheduleContact";
import { toReadErrorVariant } from "@/lib/data/read-result";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { ShareAddForm } from "./ShareAddForm";

export async function ContactSharePicker({
  supabase,
  entryId,
}: {
  readonly supabase: SupabaseClient<Database>;
  readonly entryId: PersonalScheduleEntryId;
}) {
  const capability = await getScheduleContactRegistrationEnabled(supabase);
  if (!capability.ok)
    return (
      <StatePanel
        variant={toReadErrorVariant(capability.error.kind)}
        title="共有相手の選択を確認できませんでした"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  if (!capability.value)
    return (
      <div className="flex flex-col gap-xs">
        <p className="text-body-sm text-muted-foreground">
          新しい共有の追加は準備中です。既存の共有は確認・解除できます。
        </p>
        <Link
          className="text-body-sm underline"
          href="/mypage/schedule-contacts"
        >
          共有相手の登録について
        </Link>
      </div>
    );
  const contacts = await listScheduleContacts(supabase);
  if (!contacts.ok)
    return (
      <StatePanel
        variant={toReadErrorVariant(contacts.error.kind)}
        title="共有相手を読み込めませんでした"
        description={READ_FAILURE_RETRY_HINT_JA}
      />
    );
  return <ShareAddForm entryId={entryId} contacts={contacts.value} />;
}
