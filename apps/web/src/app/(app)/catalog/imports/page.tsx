import { userIdSchema } from "@stage-tracker/domain";
import { BackLink, PageHeading, StatePanel } from "@stage-tracker/ui";
import { classifyListReadResult } from "@/lib/data/read-result";
import { isDesignatedCatalogCreator } from "@/lib/data/creator-capability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reviewOfficialImportCandidateAction } from "@/lib/actions/officialImportReview.actions";
import { OfficialImportReviewQueue } from "./_components/OfficialImportReviewQueue";
import { loadOfficialImportReviewQueue } from "./_lib/review-loader";

export default async function OfficialImportReviewPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) {
    return <StatePanel variant="unavailable" title="サインインが必要です" />;
  }
  const userId = userIdSchema.safeParse(user.id);
  if (!userId.success) {
    return (
      <StatePanel
        variant="error"
        title="アカウント情報を確認できませんでした"
      />
    );
  }
  if (!(await isDesignatedCatalogCreator(supabase, userId.data))) {
    return (
      <StatePanel
        variant="unavailable"
        title="公式情報を確認する権限がありません"
        description="この画面は指定されたカタログ管理者だけが利用できます。"
      />
    );
  }
  const queue = await loadOfficialImportReviewQueue(supabase);
  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-col gap-sm">
        <BackLink href="/mypage">マイページへ戻る</BackLink>
        <PageHeading>公式情報の確認</PageHeading>
        <p className="text-body-sm text-muted-foreground">
          公式情報から生成された候補を確認します。承認しても、この画面からEventやTicketOpportunityへ直接書き込みません。
        </p>
      </div>
      <OfficialImportReviewQueue
        state={classifyListReadResult(queue)}
        reviewAction={reviewOfficialImportCandidateAction}
      />
    </div>
  );
}
