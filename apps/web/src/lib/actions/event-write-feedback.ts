import { ActionError } from "@/lib/action-error";
import {
  DELETE_BLOCKED,
  EFFECTIVELY_CANCELED,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  VALIDATION_CODES,
  type EventWriteExtraKind,
  type RawPostgrestLikeError,
} from "./postgrest-error";

/**
 * `docs/v2/oracle-domain.md:576-580`「エラーケースと表示文言は
 * `eventWriteFeedback.ts` に `operation × EventCatalogWriteErrorKind` の
 * 直積として全パターン定義されている。v2 では...この直積をそのまま
 * 持ち込むのが最小変更」。M8 journey 比較（`docs/v2/
 * m8-journey-comparison.md`）で確定した分類2の不具合の修正 - v2 は
 * これまで全 operation を単一の汎用メッセージへ collapse していた。
 *
 * `apps/legacy-web/src/domain/eventWriteFeedback.ts` と同じ文言を、v2 の
 * `ActionError`（`{kind, message}` の単一 message field。legacy の
 * `{variant, title, description}` の 2 field 構造とは異なる - v2 の
 * write form は `StatePanel` ではなく単一の `<p role="alert">` で
 * `result.serverError.message` をそのまま表示するため）へ、
 * `${title}。${description}` として結合する形で移植する。SQLSTATE
 * 分類自体は `./postgrest-error.ts` と共有する（invitations.ts 等、
 * Event 以外の write boundary はこのファイルの対象外で従来どおり）。
 */

interface EventWriteFeedback {
  readonly title: string;
  readonly description: string;
}

function toMessage(feedback: EventWriteFeedback): string {
  return `${feedback.title}。${feedback.description}`;
}

export type EventWriteOperation =
  | "create-event"
  | "update-event"
  | "add-occurrence"
  | "update-occurrence";

const WRITE_PERMISSION_DENIED: Record<EventWriteOperation, EventWriteFeedback> =
  {
    "create-event": {
      title: "イベントを作成する権限がありません",
      description:
        "イベントの新規作成は、カタログ登録を担当するユーザーのみが行えます。登録が必要な場合は管理者に連絡してください。",
    },
    "update-event": {
      title: "このイベントを編集する権限がありません",
      description:
        "イベント情報を編集できるのは、そのイベントを登録したユーザーだけです。",
    },
    "add-occurrence": {
      title: "この公演回を追加する権限がありません",
      description: "公演回を追加できるのは、そのイベントを登録したユーザーだけです。",
    },
    "update-occurrence": {
      title: "この公演回を編集する権限がありません",
      description: "公演回を編集できるのは、そのイベントを登録したユーザーだけです。",
    },
  };

const WRITE_VALIDATION: EventWriteFeedback = {
  title: "入力内容を保存できませんでした",
  description: "入力内容に問題があります。各項目の内容を確認して、もう一度お試しください。",
};

const WRITE_EFFECTIVELY_CANCELED: EventWriteFeedback = {
  title: "この公演は中止されています",
  description: "中止された公演にはこの操作を行えません。",
};

const WRITE_FAILURE: EventWriteFeedback = {
  title: "保存に失敗しました",
  description: "通信状況を確認し、もう一度お試しください。",
};

/** Issue #79 の `(event_id, starts_at)` 一意制約違反。legacy と同じく、
 * 汎用 VALIDATION へ潰さず「開始日時を変えれば直る」ことが分かる専用文言
 * にする。 */
const DUPLICATE_OCCURRENCE_MESSAGE_JA =
  "同じ開始日時の公演回が既に登録されています。";

export function throwEventWriteError(
  operation: EventWriteOperation,
  error: RawPostgrestLikeError,
): never {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    console.error("[event write] permission denied", {
      code: error.code,
      message: error.message,
    });
    throw new ActionError<EventWriteExtraKind>(
      "permission-denied",
      toMessage(WRITE_PERMISSION_DENIED[operation]),
    );
  }
  if (error.code === UNIQUE_VIOLATION) {
    console.error("[event write] duplicate occurrence", {
      code: error.code,
      message: error.message,
    });
    throw new ActionError<EventWriteExtraKind>(
      "duplicate-occurrence",
      DUPLICATE_OCCURRENCE_MESSAGE_JA,
    );
  }
  if (error.code === EFFECTIVELY_CANCELED) {
    throw new ActionError<EventWriteExtraKind>(
      "validation",
      toMessage(WRITE_EFFECTIVELY_CANCELED),
    );
  }
  if (VALIDATION_CODES.has(error.code)) {
    console.error("[event write] validation rejected", {
      code: error.code,
      message: error.message,
    });
    throw new ActionError<EventWriteExtraKind>(
      "validation",
      toMessage(WRITE_VALIDATION),
    );
  }
  console.error("[event write] unclassified PostgREST error", {
    code: error.code,
    message: error.message,
  });
  throw new ActionError<EventWriteExtraKind>("failure", toMessage(WRITE_FAILURE));
}

/** plain UPDATE が RLS `USING` に除外されて 0 行成功になったケース
 * （`events.ts` の `deniedUpdate` 相当）。エラー自体は発生していないため
 * `throwEventWriteError` とは別経路。 */
export function throwEventWritePermissionDenied(
  operation: EventWriteOperation,
): never {
  throw new ActionError<EventWriteExtraKind>(
    "permission-denied",
    toMessage(WRITE_PERMISSION_DENIED[operation]),
  );
}

export type EventDeleteOperation = "delete-event" | "delete-occurrence";

const DELETE_PERMISSION_DENIED: Record<EventDeleteOperation, EventWriteFeedback> =
  {
    "delete-event": {
      title: "このイベントを削除する権限がありません",
      description: "イベントを削除できるのは、そのイベントを登録したユーザーだけです。",
    },
    "delete-occurrence": {
      title: "この公演回を削除する権限がありません",
      description: "公演回を削除できるのは、そのイベントを登録したユーザーだけです。",
    },
  };

const DELETE_BLOCKED_FEEDBACK: Record<EventDeleteOperation, EventWriteFeedback> =
  {
    "delete-event": {
      title: "このイベントは削除できません",
      description: "関連する参加・招待がある公演回が含まれているため削除できません。",
    },
    "delete-occurrence": {
      title: "この公演回は削除できません",
      description: "関連する参加・招待があるため削除できません。",
    },
  };

const DELETE_FAILURE: EventWriteFeedback = {
  title: "削除に失敗しました",
  description: "通信状況を確認し、もう一度お試しください。",
};

export function throwEventDeleteError(
  operation: EventDeleteOperation,
  error: RawPostgrestLikeError,
): never {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    console.error("[event delete] permission denied", {
      code: error.code,
      message: error.message,
    });
    throw new ActionError<EventWriteExtraKind>(
      "permission-denied",
      toMessage(DELETE_PERMISSION_DENIED[operation]),
    );
  }
  if (error.code === DELETE_BLOCKED) {
    console.error("[event delete] delete blocked", {
      code: error.code,
      message: error.message,
    });
    throw new ActionError<EventWriteExtraKind>(
      "delete-blocked",
      toMessage(DELETE_BLOCKED_FEEDBACK[operation]),
    );
  }
  console.error("[event delete] unclassified PostgREST error", {
    code: error.code,
    message: error.message,
  });
  throw new ActionError<EventWriteExtraKind>("failure", toMessage(DELETE_FAILURE));
}

export type EventCancellationOperation =
  | "cancel-event"
  | "uncancel-event"
  | "cancel-occurrence"
  | "uncancel-occurrence";

const CANCELLATION_PERMISSION_DENIED: Record<
  EventCancellationOperation,
  EventWriteFeedback
> = {
  "cancel-event": {
    title: "このイベントを中止にする権限がありません",
    description: "イベントの中止操作は、そのイベントを登録したユーザーだけが行えます。",
  },
  "uncancel-event": {
    title: "このイベントの中止を解除する権限がありません",
    description: "イベントの中止解除は、そのイベントを登録したユーザーだけが行えます。",
  },
  "cancel-occurrence": {
    title: "この公演回を中止にする権限がありません",
    description: "公演回の中止操作は、そのイベントを登録したユーザーだけが行えます。",
  },
  "uncancel-occurrence": {
    title: "この公演回の中止を解除する権限がありません",
    description: "公演回の中止解除は、そのイベントを登録したユーザーだけが行えます。",
  },
};

const CANCELLATION_FAILURE: EventWriteFeedback = {
  title: "操作に失敗しました",
  description: "通信状況を確認し、もう一度お試しください。",
};

/**
 * cancel/uncancel は plain owner-gated column update で、delete-blocked
 * のような「拒否され得る状態」自体を持たない（owner は常に中止/解除
 * できる - legacy の `resolveCancellationFeedback` のコメントと同じ）。
 */
export function throwEventCancellationPermissionDenied(
  operation: EventCancellationOperation,
): never {
  throw new ActionError<EventWriteExtraKind>(
    "permission-denied",
    toMessage(CANCELLATION_PERMISSION_DENIED[operation]),
  );
}

export function throwEventCancellationError(
  operation: EventCancellationOperation,
  error: RawPostgrestLikeError,
): never {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    console.error("[event cancellation] permission denied", {
      code: error.code,
      message: error.message,
    });
    throw new ActionError<EventWriteExtraKind>(
      "permission-denied",
      toMessage(CANCELLATION_PERMISSION_DENIED[operation]),
    );
  }
  console.error("[event cancellation] unclassified PostgREST error", {
    code: error.code,
    message: error.message,
  });
  throw new ActionError<EventWriteExtraKind>(
    "failure",
    toMessage(CANCELLATION_FAILURE),
  );
}
