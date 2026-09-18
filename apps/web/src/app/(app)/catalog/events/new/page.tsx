import Link from "next/link";
import { userIdSchema } from "@stage-tracker/domain";
import { PageHeading, StatePanel } from "@stage-tracker/ui";
import { isDesignatedCatalogCreator } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewEventForm } from "./_components/NewEventForm";

interface NewEventPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function backHref(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  const month = params.month;
  const date = params.date;
  if (typeof month === "string") {
    query.set("month", month);
  }
  if (typeof date === "string") {
    query.set("date", date);
  }
  const qs = query.toString();
  return qs.length > 0 ? `/catalog?${qs}` : "/catalog";
}

/**
 * Event 新規作成（`docs/v2/oracle-routes-ui.md` §1/§2
 * `/catalog/events/new`）。designated catalog creator 限定 —— ただし
 * ここでの判定は .ai-dev-foundation/product-rules.md の位置づけどおり**レンダー制御に過ぎない**。
 * 真の権限境界は `create_event` RPC 側の membership check にある。
 */
export default async function NewEventPage({
  searchParams,
}: NewEventPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return (
      <StatePanel
        variant="unavailable"
        title="サインインが必要です"
        description="サインインしてからもう一度お試しください。"
      />
    );
  }

  const parsedUserId = userIdSchema.safeParse(user.id);
  if (!parsedUserId.success) {
    return (
      <StatePanel
        variant="unavailable"
        title="サインインが必要です"
        description="サインインしてからもう一度お試しください。"
      />
    );
  }

  const canCreate = await isDesignatedCatalogCreator(
    supabase,
    parsedUserId.data,
  );
  if (!canCreate) {
    return (
      <StatePanel
        variant="unavailable"
        title="イベントを作成する権限がありません"
        description="イベントの新規作成は管理者のみ利用できます。"
      />
    );
  }

  return (
    <>
      <Link
        href={backHref(params)}
        className="text-body-sm text-muted-foreground hover:text-foreground"
      >
        ← イベントカタログへ戻る
      </Link>
      <PageHeading>イベントを作成</PageHeading>
      <NewEventForm />
    </>
  );
}
