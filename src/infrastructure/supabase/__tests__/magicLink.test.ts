import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  requestMagicLink,
  type MagicLinkAuthClient,
  type MagicLinkDiagnostics,
} from '../magicLink.ts';

interface RecordedCall {
  email: string;
  options?: { shouldCreateUser?: boolean; emailRedirectTo?: string };
}

function recordingClient(error: unknown = null): {
  client: MagicLinkAuthClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: MagicLinkAuthClient = {
    auth: {
      signInWithOtp(credentials) {
        calls.push(credentials);
        return Promise.resolve({ error });
      },
    },
  };
  return { client, calls };
}

function recordingDiagnostics(): {
  diagnostics: MagicLinkDiagnostics;
  failures: { email: string; error: unknown }[];
} {
  const failures: { email: string; error: unknown }[] = [];
  return {
    diagnostics: {
      requestFailed(email, error) {
        failures.push({ email, error });
      },
    },
    failures,
  };
}

// The sign-in path must never ask Supabase to create an account. With the
// project configured correctly GoTrue refuses creation regardless, so this
// backstop cannot be observed end-to-end - assert the request itself.
void test('requestMagicLink never asks Supabase to create an account', async () => {
  const { client, calls } = recordingClient();

  await requestMagicLink(client, 'someone@example.test');

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.email, 'someone@example.test');
  assert.equal(call.options?.shouldCreateUser, false);
  assert.equal('emailRedirectTo' in (call.options ?? {}), false);
});

void test('requestMagicLink includes the supported redirect option when supplied', async () => {
  const { client, calls } = recordingClient();

  await requestMagicLink(client, 'someone@example.test', undefined, {
    emailRedirectTo: 'https://stage-tracker-git-preview-reitojike.vercel.app/',
  });

  assert.deepEqual(calls[0]?.options, {
    shouldCreateUser: false,
    emailRedirectTo: 'https://stage-tracker-git-preview-reitojike.vercel.app/',
  });
});

// The core anti-enumeration property. Every classification attempt became
// an oracle, so the caller is handed nothing to branch on. The absence of
// a signal is enforced at compile time by the `Promise<void>` return type;
// what is asserted here is that no outcome changes how the request itself
// behaves - it must complete uniformly rather than, say, throwing for some
// error shapes and resolving for others.
void test('every Supabase outcome is handled uniformly', async () => {
  const outcomes: { label: string; error: unknown }[] = [
    { label: 'sent', error: null },
    { label: 'address has no account (422)', error: { status: 422, code: 'otp_disabled' } },
    { label: 'SMTP dead for an address that exists (500)', error: { status: 500 } },
    { label: 'rate limited (429)', error: { status: 429 } },
    { label: 'never reached the service', error: { status: 0, name: 'AuthRetryableFetchError' } },
    { label: 'unparseable body, no status at all', error: new Error('unparseable body') },
  ];

  for (const { label, error } of outcomes) {
    const { client, calls } = recordingClient(error);
    await requestMagicLink(client, 'someone@example.test');
    assert.equal(calls.length, 1, `${label}: exactly one request`);
    assert.equal(calls[0]?.options?.shouldCreateUser, false, `${label}: guard still sent`);
  }
});

void test('failures are reported to the server-side diagnostics channel', async () => {
  const { client } = recordingClient({ status: 500 });
  const { diagnostics, failures } = recordingDiagnostics();

  await requestMagicLink(client, 'someone@example.test', diagnostics);

  assert.equal(failures.length, 1, 'a failure must not be swallowed entirely');
  assert.equal(failures[0]?.email, 'someone@example.test');
});

void test('a rejected SDK call is absorbed, not allowed to escape', async () => {
  // signInWithOtp rethrows anything that is not an AuthError. If that
  // escaped, the Server Action would abort and return an error response
  // instead of the neutral acknowledgement - a different envelope.
  const thrown = new TypeError('unexpected client failure');
  const client: MagicLinkAuthClient = {
    auth: {
      signInWithOtp() {
        return Promise.reject(thrown);
      },
    },
  };
  const { diagnostics, failures } = recordingDiagnostics();

  await requestMagicLink(client, 'someone@example.test', diagnostics);

  assert.equal(failures.length, 1, 'the rejection must reach diagnostics');
  assert.equal(failures[0]?.error, thrown);
});

void test('a successful request reports no failure', async () => {
  const { client } = recordingClient();
  const { diagnostics, failures } = recordingDiagnostics();

  await requestMagicLink(client, 'someone@example.test', diagnostics);

  assert.equal(failures.length, 0);
});
