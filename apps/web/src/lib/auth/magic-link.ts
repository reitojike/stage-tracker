import type { ActionErrorShape } from "@/lib/action-error";

/**
 * この module が必要とする Supabase client の断面。narrow にしているのは、
 * test が実 SDK 型に依存しない recording stub を type assertion なしで
 * 渡せるようにするため。
 */
export interface MagicLinkAuthClient {
  auth: {
    signInWithOtp(credentials: {
      email: string;
      options?: { shouldCreateUser?: boolean; emailRedirectTo?: string };
    }): Promise<{ error: unknown }>;
  };
}

export interface MagicLinkRequestOptions {
  /** Vercel Preview 等、信頼できる環境向けの明示的な redirect 先。 */
  emailRedirectTo?: string;
}

/**
 * 失敗の報告先。呼び出し元（`requestSignInLink`）は enumeration 対策として
 * account の有無・送信成否のいずれによっても応答を変えてはならないため、
 * 失敗はレスポンスに一切現れない、この診断チャンネルへのみ流す
 * （unauthenticated caller からは観測不能）。
 */
export interface MagicLinkDiagnostics {
  requestFailed(email: string, error: ActionErrorShape): void;
}

function classifyMagicLinkError(error: unknown): ActionErrorShape {
  const message = error instanceof Error ? error.message : String(error);
  // 5xx・レート制限・ネットワーク断等、ここで分類できる失敗は一律
  // `failure`。`unauthenticated` にしないのは、これはこれから
  // サインインしようとしている人へのメール送信の失敗であり、
  // 既存セッションの有無とは無関係だから（`src/lib/action-error.ts`
  // の base kind 語彙を参照）。
  return { kind: "failure", message };
}

/**
 * magic link サインインメールをリクエストする。
 *
 * 意図的に何も返さない: 呼び出し元へ分類済みの結果（redirect 先、
 * status の分岐、error shape）を返すと、それを使って応答を分岐させた
 * 瞬間に account-existence oracle になる。呼び出し元に対して不変な
 * 応答を保証する唯一の方法は、そもそも分岐材料を渡さないこと
 * （`docs/v2/oracle-domain.md` §1.11 サインイン方式、
 * `docs/v2/oracle-routes-ui.md` §1 `/sign-in` 参照）。
 *
 * `shouldCreateUser: false` は「公開 signup を無効化する」という
 * 設定判断のバックストップ。誤設定された Supabase project が
 * サインイン試行を暗黙のアカウント作成に変えてしまうことを防ぐ。
 */
export async function requestMagicLink(
  client: MagicLinkAuthClient,
  email: string,
  diagnostics?: MagicLinkDiagnostics,
  requestOptions?: MagicLinkRequestOptions,
): Promise<void> {
  try {
    const options = {
      shouldCreateUser: false,
      ...(requestOptions?.emailRedirectTo === undefined
        ? {}
        : { emailRedirectTo: requestOptions.emailRedirectTo }),
    };

    const { error } = await client.auth.signInWithOtp({ email, options });

    if (error !== null && error !== undefined) {
      diagnostics?.requestFailed(email, classifyMagicLinkError(error));
    }
  } catch (thrown: unknown) {
    // signInWithOtp は AuthError のみ `{ error }` として返し、それ以外は
    // rethrow される（GoTrueClient の挙動）。ここで catch せずに
    // 呼び出し元まで escape させると、Server Action が中立な
    // acknowledgement ではなくエラーレスポンスを返してしまう
    // （それ自体が分岐、= oracle になる）。
    diagnostics?.requestFailed(email, classifyMagicLinkError(thrown));
  }
}
