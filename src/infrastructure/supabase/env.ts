function readEnv(name: string): string {
  const value = process.env[name];
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
  return {
    url: readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  };
}
