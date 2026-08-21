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
export function readLocalSupabaseStatus(): LocalSupabaseStatus {
  // Windows can only launch node_modules/.bin's supabase.cmd shim through a
  // shell (Node throws EINVAL otherwise); the args below are static
  // literals, not external input, so shell:true carries no injection risk
  // here.
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

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
