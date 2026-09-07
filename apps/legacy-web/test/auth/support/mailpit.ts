import { readLocalSupabaseStatus } from '../../rls/support/localSupabase.ts';

// Mailpit is the local SMTP capture service the Supabase CLI starts for
// [local_smtp]; its URL comes from `supabase status -o json` so this never
// pins a port that could drift from supabase/config.toml.
function mailpitBaseUrl(): string {
  return readLocalSupabaseStatus().mailpitUrl.replace(/\/$/, '');
}

interface MailpitMessageSummary {
  id: string;
  toAddresses: string[];
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseMessageSummary(value: unknown): MailpitMessageSummary | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if (!('ID' in value) || typeof value.ID !== 'string') {
    return null;
  }
  if (!('To' in value) || !Array.isArray(value.To)) {
    return null;
  }
  const toAddresses = value.To.map((entry: unknown) =>
    typeof entry === 'object' &&
    entry !== null &&
    'Address' in entry &&
    typeof entry.Address === 'string'
      ? entry.Address
      : null,
  );
  if (!isStringArray(toAddresses)) {
    return null;
  }
  return { id: value.ID, toAddresses };
}

async function listMessages(): Promise<MailpitMessagesResponse> {
  const response = await fetch(`${mailpitBaseUrl()}/api/v1/messages`);
  if (!response.ok) {
    throw new Error(`Mailpit list messages failed with status ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('messages' in body)) {
    throw new Error('Unexpected shape from Mailpit /api/v1/messages');
  }
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages)) {
    throw new Error('Unexpected shape from Mailpit /api/v1/messages: messages is not an array');
  }
  const messages: MailpitMessageSummary[] = [];
  for (const raw of rawMessages) {
    const parsed = parseMessageSummary(raw);
    if (parsed === null) {
      throw new Error('Unexpected shape for a Mailpit message summary');
    }
    messages.push(parsed);
  }
  return { messages };
}

async function fetchMessageHtml(id: string): Promise<string> {
  const response = await fetch(`${mailpitBaseUrl()}/api/v1/message/${id}`);
  if (!response.ok) {
    throw new Error(`Mailpit fetch message failed with status ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('HTML' in body) ||
    typeof body.HTML !== 'string'
  ) {
    throw new Error('Unexpected shape from Mailpit /api/v1/message/:id');
  }
  return body.HTML;
}

export interface MagicLinkToken {
  tokenHash: string;
  type: string;
}

/**
 * Pulls the /auth/confirm link out of the rendered email and reads its
 * query string as a real URL. The href is HTML-escaped in the message
 * body (`&amp;` between parameters), so it is unescaped before parsing
 * rather than scraped with per-parameter regexes.
 */
function extractMagicLinkToken(html: string): MagicLinkToken | null {
  const hrefMatch = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(html);
  if (hrefMatch === null) {
    return null;
  }
  const [, rawHref] = hrefMatch;
  if (rawHref === undefined) {
    return null;
  }

  const href = rawHref
    .replaceAll('&amp;', '&')
    .replaceAll('&#34;', '"')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }

  const tokenHash = parsed.searchParams.get('token_hash');
  const type = parsed.searchParams.get('type');
  if (tokenHash === null || type === null) {
    return null;
  }
  return { tokenHash, type };
}

/**
 * Polls Mailpit's local capture inbox for the most recent message sent to
 * `email` and extracts the token_hash/type pair from the confirm link
 * built by supabase/templates/magic_link.html. Local email delivery is
 * near-instant, but this polls briefly to avoid flakiness.
 */
export async function waitForMagicLinkToken(
  email: string,
  timeoutMs = 10_000,
): Promise<MagicLinkToken> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const { messages } = await listMessages();
    const match = messages.find((message) => message.toAddresses.includes(email));
    if (match) {
      const html = await fetchMessageHtml(match.id);
      const token = extractMagicLinkToken(html);
      if (token === null) {
        throw new Error(`Magic link email to ${email} did not contain a token_hash/type link`);
      }
      return token;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for a magic link email to ${email}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
