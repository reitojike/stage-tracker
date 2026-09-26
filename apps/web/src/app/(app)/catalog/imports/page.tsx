import { userIdSchema } from "@stage-tracker/domain";
import { BackLink, PageHeading, StatePanel } from "@stage-tracker/ui";
import {
  classifyListReadResult,
  classifyReadResult,
} from "@/lib/data/read-result";
import { isDesignatedCatalogCreator } from "@/lib/data/creator-capability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  bindOfficialImportTicketCandidateAction,
  lookupOfficialImportBindingEventAction,
  reviewOfficialImportCandidateAction,
} from "@/lib/actions/officialImportReview.actions";
import { startOfficialImportApplyAction } from "@/lib/actions/officialImportApply.actions";
import { OfficialImportReviewQueue } from "./_components/OfficialImportReviewQueue";
import {
  KabukiHeldPageReport,
  ShochikuTicketHeldPageReport,
} from "./_components/KabukiHeldPageReport";
import {
  KabukiManualShadowRun,
  ShochikuTicketManualShadowRun,
} from "./_components/KabukiManualShadowRun";
import {
  loadLatestKabukiHeldPageReport,
  loadLatestShochikuTicketHeldPageReport,
  loadLatestShochikuTicketRun,
} from "./_lib/held-page-loader";
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
  const [queue, heldPages, ticketHeldPages, latestTicketRun] =
    await Promise.all([
      loadOfficialImportReviewQueue(supabase),
      loadLatestKabukiHeldPageReport(supabase),
      loadLatestShochikuTicketHeldPageReport(supabase),
      loadLatestShochikuTicketRun(supabase),
    ]);
  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-col gap-sm">
        <BackLink href="/mypage">マイページへ戻る</BackLink>
        <PageHeading>公式情報の確認</PageHeading>
        <p className="text-body-sm text-muted-foreground">
          公式情報から生成された候補を確認します。承認後に反映を開始すると、最新のカタログ状態で再計画してからEventまたはTicketOpportunityへ反映します。
        </p>
      </div>
      <KabukiManualShadowRun />
      <ShochikuTicketManualShadowRun />
      <KabukiHeldPageReport
        state={classifyReadResult(
          heldPages,
          (report) => report,
          (report) => report === null,
        )}
      />
      <ShochikuTicketHeldPageReport
        state={classifyReadResult(
          ticketHeldPages,
          (report) => report,
          (report) => report === null,
        )}
        latestRun={classifyReadResult(
          latestTicketRun,
          (run) => run,
          (run) => run === null,
        )}
      />
      <OfficialImportReviewQueue
        state={classifyListReadResult(queue)}
        reviewAction={reviewOfficialImportCandidateAction}
        applyAction={startOfficialImportApplyAction}
        bindAction={bindOfficialImportTicketCandidateAction}
        lookupEventAction={lookupOfficialImportBindingEventAction}
      />
    </div>
  );
}
