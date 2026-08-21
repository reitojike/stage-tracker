import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestMagicLink, type MagicLinkAuthClient } from '../magicLink.ts';

interface RecordedCall {
  email: string;
  options?: { shouldCreateUser?: boolean };
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
});

void test('requestMagicLink reports success only when Supabase returned no error', async () => {
  const success = recordingClient();
  assert.deepEqual(await requestMagicLink(success.client, 'a@example.test'), { ok: true });

  const failure = recordingClient(new Error('rejected'));
  assert.deepEqual(await requestMagicLink(failure.client, 'b@example.test'), { ok: false });
});
