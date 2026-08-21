/**
 * Validates one already-read value. The lookup itself must stay at the
 * call site: Next.js only inlines `NEXT_PUBLIC_*` into the browser bundle
 * for statically analyzable references, so reading them through a string
 * key (`process.env[name]`) would leave them undefined in a Client
 * Component and make this throw despite a correct deployment.
 */
function required(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface PublicSupabaseEnv {
  url: string;
  anonKey: string;
}

export function readPublicSupabaseEnv(): PublicSupabaseEnv {
  // Static property access on purpose - see `required` above. Do not
  // refactor these into a loop or a lookup by name.
  return {
    url: required(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  };
}
