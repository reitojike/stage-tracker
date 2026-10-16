import {
  BackLink,
  PageHeading,
  SectionHeading,
  StatePanel,
} from "@stage-tracker/ui";
import {
  getScheduleContactRegistrationEnabled,
  listReceivedScheduleContactRequests,
  listScheduleContacts,
} from "@/lib/data/reads/scheduleContact";
import { toReadErrorVariant } from "@/lib/data/read-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { RequestContactForm } from "./_components/RequestContactForm";
import { ReceivedContactRequests } from "./_components/ReceivedContactRequests";
import { ScheduleContactList } from "./_components/ScheduleContactList";

export default async function ScheduleContactsPage() {
  const client = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  const heading = (
    <>
      <BackLink href="/mypage">マイページへ戻る</BackLink>
      <PageHeading>共有相手の登録</PageHeading>
    </>
  );
  if (error || !user)
    return (
      <div className="flex flex-col gap-md">
        {heading}
        <StatePanel
          variant="unavailable"
          title="サインイン状態を確認できません"
        />
      </div>
    );
  const capability = await getScheduleContactRegistrationEnabled(client);
  if (!capability.ok)
    return (
      <div className="flex flex-col gap-md">
        {heading}
        <StatePanel
          variant={toReadErrorVariant(capability.error.kind)}
          title="共有相手の登録を確認できませんでした"
          description={READ_FAILURE_RETRY_HINT_JA}
        />
      </div>
    );
  if (!capability.value)
    return (
      <div className="flex flex-col gap-md">
        {heading}
        <StatePanel
          variant="unavailable"
          title="共有相手の登録は準備中です"
          description="登録の受付はまだ開始していません。既存の予定と共有の確認・解除は引き続き利用できます。"
        />
      </div>
    );
  const [received, contacts] = await Promise.all([
    listReceivedScheduleContactRequests(client),
    listScheduleContacts(client),
  ]);
  return (
    <div className="flex flex-col gap-section">
      {heading}
      <p className="text-body-sm text-muted-foreground">
        相手の承認で登録が完了します。登録しただけでは予定は共有されません。予定ごとに共有する相手を選びます。
      </p>
      <section
        className="flex flex-col gap-sm"
        aria-labelledby="contact-request-heading"
      >
        <SectionHeading id="contact-request-heading">
          登録を申請する
        </SectionHeading>
        <RequestContactForm />
      </section>
      <section
        className="flex flex-col gap-sm"
        aria-labelledby="contact-received-heading"
      >
        <SectionHeading id="contact-received-heading">
          届いた申請
        </SectionHeading>
        {received.ok ? (
          <ReceivedContactRequests requests={received.value} />
        ) : (
          <StatePanel
            variant={toReadErrorVariant(received.error.kind)}
            title="届いた申請を読み込めませんでした"
            description={READ_FAILURE_RETRY_HINT_JA}
          />
        )}
      </section>
      <section
        className="flex flex-col gap-sm"
        aria-labelledby="contact-list-heading"
      >
        <SectionHeading id="contact-list-heading">
          登録済みの共有相手
        </SectionHeading>
        {contacts.ok ? (
          <ScheduleContactList contacts={contacts.value} />
        ) : (
          <StatePanel
            variant={toReadErrorVariant(contacts.error.kind)}
            title="共有相手を読み込めませんでした"
            description={READ_FAILURE_RETRY_HINT_JA}
          />
        )}
      </section>
    </div>
  );
}
