"use client";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Button, StatePanel } from "@stage-tracker/ui";
import type { ReceivedScheduleContactRequest } from "@stage-tracker/domain";
import {
  acceptScheduleContactRequestAction,
  declineScheduleContactRequestAction,
} from "@/lib/actions/schedule/schedule-contact-actions";

function RequestRow({
  request,
}: {
  readonly request: ReceivedScheduleContactRequest;
}) {
  const router = useRouter();
  const accept = useAction(acceptScheduleContactRequestAction, {
    onSuccess: () => router.refresh(),
  });
  const decline = useAction(declineScheduleContactRequestAction, {
    onSuccess: () => router.refresh(),
  });
  const busy = accept.isExecuting || decline.isExecuting;
  const error = accept.result.serverError ?? decline.result.serverError;
  return (
    <li className="flex flex-col gap-sm border-b border-border py-sm">
      <p className="break-all text-body-sm">{request.requesterEmail}</p>
      <div className="flex flex-wrap gap-sm">
        <Button
          type="button"
          disabled={busy}
          aria-label={`${request.requesterEmail}からの申請を承認`}
          onClick={() => {
            accept.reset();
            decline.reset();
            accept.execute({ requestId: request.requestId });
          }}
        >
          {accept.isExecuting ? "承認中…" : "承認する"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          aria-label={`${request.requesterEmail}からの申請を拒否`}
          onClick={() => {
            accept.reset();
            decline.reset();
            decline.execute({ requestId: request.requestId });
          }}
        >
          {decline.isExecuting ? "拒否中…" : "拒否する"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </li>
  );
}
export function ReceivedContactRequests({
  requests,
}: {
  readonly requests: readonly ReceivedScheduleContactRequest[];
}) {
  if (requests.length === 0)
    return <StatePanel variant="empty" title="届いた申請はありません" />;
  return (
    <ul>
      {requests.map((request) => (
        <RequestRow key={request.requestId} request={request} />
      ))}
    </ul>
  );
}
