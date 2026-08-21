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
