import { execFileSync } from "node:child_process";

/**
 * Local Supabase connection info this E2E suite needs. Read from the CLI
 * (`supabase status -o json`) rather than hard-coded, so the suite stays
 * correct if the CLI's local demo credentials ever change - mirrors
 * `apps/legacy-web/test/rls/support/localSupabase.ts` (read for this
 * Task's design, not imported: `apps/legacy-web/**` is out of scope for
 * `apps/web` to depend on).
 */
export interface LocalSupabaseStatus {
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
  readonly mailpitUrl: string;
}

interface RawSupabaseStatus {
  readonly API_URL: string;
  readonly ANON_KEY: string;
  readonly SERVICE_ROLE_KEY: string;
}

function isRawSupabaseStatus(value: unknown): value is RawSupabaseStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "API_URL" in value &&
    typeof value.API_URL === "string" &&
    "ANON_KEY" in value &&
    typeof value.ANON_KEY === "string" &&
    "SERVICE_ROLE_KEY" in value &&
    typeof value.SERVICE_ROLE_KEY === "string"
  );
}

/**
 * The Supabase CLI renamed this key from `INBUCKET_URL` to `MAILPIT_URL`;
 * both spellings are accepted rather than pinning the port here where it
 * could silently drift from `supabase/config.toml`.
 */
function readMailpitUrl(parsed: object): string {
  for (const key of ["MAILPIT_URL", "INBUCKET_URL"]) {
    if (key in parsed) {
      const value: unknown = Reflect.get(parsed, key);
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  throw new Error(
    'Neither MAILPIT_URL nor INBUCKET_URL was reported by "supabase status -o json"; ' +
      "the local SMTP capture service ([local_smtp]) may be disabled.",
  );
}

/**
 * `supabase status` is not safe to run concurrently (it rewrites the CLI's
 * own telemetry file through a temp-file-plus-rename, and concurrent
 * invocations can lose that race - see the equivalent comment in
 * `apps/legacy-web/test/rls/support/localSupabase.ts`, which observed this
 * directly). This suite runs with a single Playwright worker (see
 * `playwright.config.ts`), but the main process (resolving `webServer.env`)
 * and the worker process both call this at startup, so the same bounded
 * retry is worth keeping here too.
 */
const STATUS_ATTEMPTS = 5;
const STATUS_RETRY_BASE_MS = 150;

function runStatusCommand(): string {
  let lastError: unknown;
  for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt += 1) {
    try {
      // Windows can only launch node_modules/.bin's supabase.cmd shim
      // through a shell (Node throws EINVAL otherwise); the args below are
      // static literals, not external input, so shell:true carries no
      // injection risk here.
      return execFileSync("supabase", ["status", "-o", "json"], {
        encoding: "utf8",
        shell: process.platform === "win32",
      });
    } catch (error) {
      lastError = error;
      const backoffMs =
        STATUS_RETRY_BASE_MS * (attempt + 1) + Math.floor(Math.random() * 100);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs);
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `"supabase status -o json" failed ${String(STATUS_ATTEMPTS)} times; ` +
      `is the local stack running (pnpm run verify:database:start)? Last error: ${detail}`,
  );
}

/**
 * この suite は service-role key を使う（`adminClient.ts`）。接続先が
 * ローカルスタックであることを、`supabase status` が local しか報告しない
 * という性質に暗黙に頼るのではなく、ここで明示的に検査する。
 *
 * 将来 env フォールバックや `--linked` を足す変更が入っても、この検査が
 * 先に落ちる。service-role で本番へ書き込む事故は取り返しがつかないので、
 * 「そうならないはず」ではなく「そうなったら止まる」形にしておく。
 */
export function assertLocalApiUrl(apiUrl: string): void {
  let host: string;
  try {
    host = new URL(apiUrl).hostname;
  } catch {
    throw new Error(`Unparsable API_URL from "supabase status": ${apiUrl}`);
  }
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";
  if (!isLocal) {
    throw new Error(
      `E2E refuses to run against a non-local Supabase (API_URL host: ${host}). ` +
        "This suite provisions and deletes users with the service-role key.",
    );
  }
}

export function readLocalSupabaseStatus(): LocalSupabaseStatus {
  const raw = runStatusCommand();

  const parsed: unknown = JSON.parse(raw);
  if (!isRawSupabaseStatus(parsed)) {
    throw new Error('Unexpected shape from "supabase status -o json".');
  }

  assertLocalApiUrl(parsed.API_URL);

  return {
    apiUrl: parsed.API_URL,
    anonKey: parsed.ANON_KEY,
    serviceRoleKey: parsed.SERVICE_ROLE_KEY,
    mailpitUrl: readMailpitUrl(parsed),
  };
}
