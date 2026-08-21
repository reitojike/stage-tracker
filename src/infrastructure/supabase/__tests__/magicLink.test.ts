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

void test('requestMagicLink reports delivered when Supabase accepted the request', async () => {
  const { client } = recordingClient();
  assert.equal(await requestMagicLink(client, 'a@example.test'), 'delivered');
});

void test('an account-level rejection is indistinguishable from a delivered link', async () => {
  // Status 422 / otp_disabled is what an address with no account yields.
  // Reporting it differently would give an enumeration oracle.
  const { client } = recordingClient({ status: 422, code: 'otp_disabled' });
  assert.equal(await requestMagicLink(client, 'nobody@example.test'), 'delivered');
});

void test('a service failure is reported as unavailable, not as a delivered link', async () => {
  // status 0 is a failed fetch (auth service unreachable); 5xx is a
  // server fault. Neither says anything about the address, so telling the
  // user their link was sent would simply be false.
  const unreachable = recordingClient({ status: 0, name: 'AuthRetryableFetchError' });
  assert.equal(await requestMagicLink(unreachable.client, 'a@example.test'), 'unavailable');

  const serverFault = recordingClient({ status: 500 });
  assert.equal(await requestMagicLink(serverFault.client, 'b@example.test'), 'unavailable');
});
