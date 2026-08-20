import { readLocalSupabaseStatus } from '../../rls/support/localSupabase.ts';

// Local Supabase exposes Mailpit (the local SMTP capture UI/API) on the
// same port configured as [local_smtp] in supabase/config.toml. `supabase
// status -o json` also reports it as MAILPIT_URL/INBUCKET_URL, but
// readLocalSupabaseStatus() (shared with the RLS test suite) doesn't
// surface those fields, so this derives the same host from API_URL
// instead of hardcoding the port a second time.
function mailpitBaseUrl(): string {
  const { apiUrl } = readLocalSupabaseStatus();
  const { protocol, hostname } = new URL(apiUrl);
  return `${protocol}//${hostname}:54324`;
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

function extractMagicLinkToken(html: string): MagicLinkToken | null {
  const tokenHashMatch = /token_hash=([^&"]+)/.exec(html);
  const typeMatch = /[?&]type=([^&"]+)/.exec(html);
  if (tokenHashMatch === null || typeMatch === null) {
    return null;
  }
  const [, tokenHash] = tokenHashMatch;
  const [, type] = typeMatch;
  if (tokenHash === undefined || type === undefined) {
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
