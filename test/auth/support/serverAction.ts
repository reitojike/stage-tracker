/**
 * Invokes a Next.js Server Action the way a browser without JavaScript
 * does: read the page, take the `$ACTION_ID_...` field React rendered into
 * the form, and POST it back as multipart form data.
 *
 * Testing the underlying helper function instead would not prove what the
 * Server Action does with its result - which is exactly where the
 * account-enumeration and sign-out guards live.
 */
export async function submitServerAction(
  baseUrl: string,
  path: string,
  fields: Record<string, string> = {},
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = cookie === undefined ? {} : { cookie };

  const pageResponse = await fetch(`${baseUrl}${path}`, { headers, redirect: 'manual' });
  if (pageResponse.status !== 200) {
    throw new Error(`expected 200 when loading ${path}, got ${String(pageResponse.status)}`);
  }
  const html = await pageResponse.text();

  const match = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(html);
  if (match === null) {
    throw new Error(`no server action field found on ${path}`);
  }
  const [, actionField] = match;
  if (actionField === undefined) {
    throw new Error(`could not read the server action field on ${path}`);
  }

  const form = new FormData();
  form.set(actionField, '');
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }

  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: form,
    redirect: 'manual',
  });
}

/**
 * Server Actions signal `redirect()` either with a real Location header or,
 * for a fetch-initiated action, an `x-action-redirect` header - accept
 * whichever this Next version used.
 */
export function actionRedirectTarget(response: Response): string | null {
  return response.headers.get('location') ?? response.headers.get('x-action-redirect');
}

function parseCookieHeader(header: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    jar.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return jar;
}

/**
 * Applies a response's `Set-Cookie` headers to an existing cookie header
 * the way a browser would: unaffected cookies survive, and a cookie that
 * is expired or emptied is dropped.
 *
 * Replacing the jar with just the response's cookies instead would let a
 * broken sign-out pass by emitting any unrelated cookie - the original
 * session cookie would silently vanish from the next request.
 */
export function applySetCookies(cookieHeader: string, response: Response): string {
  const jar = parseCookieHeader(cookieHeader);

  for (const setCookie of response.headers.getSetCookie()) {
    const [pair] = setCookie.split(';');
    if (pair === undefined) {
      continue;
    }
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    const expiresEpoch = /expires=thu, 01 jan 1970/i.test(setCookie);
    const maxAgeZero = /max-age=0(?:;|$)/i.test(setCookie);
    if (value.length === 0 || expiresEpoch || maxAgeZero) {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}
