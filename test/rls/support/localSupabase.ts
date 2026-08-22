import { execFileSync } from 'node:child_process';

export interface LocalSupabaseStatus {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  /**
   * Base URL of the local SMTP capture service ([local_smtp] in
   * supabase/config.toml). The CLI renamed this key from INBUCKET_URL to
   * MAILPIT_URL, so both spellings are accepted rather than pinning the
   * port here where it could silently drift from config.toml.
   */
  mailpitUrl: string;
}

interface RawSupabaseStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  DB_URL: string;
}

function isRawSupabaseStatus(value: unknown): value is RawSupabaseStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    'API_URL' in value &&
    typeof value.API_URL === 'string' &&
    'ANON_KEY' in value &&
    typeof value.ANON_KEY === 'string' &&
    'SERVICE_ROLE_KEY' in value &&
    typeof value.SERVICE_ROLE_KEY === 'string' &&
    'DB_URL' in value &&
    typeof value.DB_URL === 'string'
  );
}

function readMailpitUrl(parsed: object): string {
  for (const key of ['MAILPIT_URL', 'INBUCKET_URL']) {
    if (key in parsed) {
      const value: unknown = Reflect.get(parsed, key);
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  throw new Error(
    'Neither MAILPIT_URL nor INBUCKET_URL was reported by "supabase status -o json"; ' +
      'the local SMTP capture service ([local_smtp]) may be disabled.',
  );
}

/**
 * Reads the running local Supabase stack's connection info via the CLI
 * rather than hard-coding local defaults, so DB/RLS tests stay correct if
 * the CLI's local demo credentials ever change.
 */
/**
 * `supabase status` is not safe to run concurrently. Each invocation
 * rewrites the CLI's own ~/.supabase/telemetry.json through a temp file plus
 * a rename, and when several run at once that rename loses the race and the
 * CLI aborts:
 *
 *   error: Unknown: FileSystem.rename (~/.supabase/telemetry.json.tmp.<uuid>)
 *
 * `node --test` runs one process per test file, and every DB/RLS test file
 * calls this at module load, so the whole suite hits that window together.
 * The observed failure is a whole test file dying before any of its tests
 * run - and which files lose is different on every run.
 *
 * This is a CLI/runtime behavior, not something about the schema under test,
 * so it is absorbed here rather than by serializing the suite: the loser of
 * the race just tries again. The retry is bounded and only covers launching
 * the CLI - a status that parses into an unexpected shape is still a hard
 * failure.
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
      return execFileSync('supabase', ['status', '-o', 'json'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
    } catch (error) {
      lastError = error;
      // Jittered, so processes that collided once do not line up again on
      // the next attempt.
      const backoffMs = STATUS_RETRY_BASE_MS * (attempt + 1) + Math.floor(Math.random() * 100);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `"supabase status -o json" failed ${String(STATUS_ATTEMPTS)} times; ` +
      `is the local stack running? Last error: ${detail}`,
  );
}

export function readLocalSupabaseStatus(): LocalSupabaseStatus {
  const raw = runStatusCommand();

  const parsed: unknown = JSON.parse(raw);
  if (!isRawSupabaseStatus(parsed)) {
    throw new Error('Unexpected shape from "supabase status -o json".');
  }

  return {
    apiUrl: parsed.API_URL,
    anonKey: parsed.ANON_KEY,
    serviceRoleKey: parsed.SERVICE_ROLE_KEY,
    dbUrl: parsed.DB_URL,
    mailpitUrl: readMailpitUrl(parsed),
  };
}
