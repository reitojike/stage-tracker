import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg from 'pg';
import {
  createAdminClient,
  createAnonymousClient,
  createTestActor,
  deleteTestActor,
  type TestActor,
} from './support/testActors.ts';
import { readLocalSupabaseStatus } from './support/localSupabase.ts';

// Real local Supabase/Postgres tests for public.notifications and the
// recipient-owned mark_notification_read RPC (Issue #510). The test uses both
// anon-key clients, which are the RLS boundary under test, and a service-role
// client only for fixture setup/inspection.
//
// The source Invitation fixture is deliberately deleted after its Notification
// is created. That proves source_id is a soft reference rather than a foreign
// key that would either cascade the Notification away or block resolution.

const PASSWORD = 'Str0ng-Test-Passw0rd!';

let recipient: TestActor;
let other: TestActor;
const createdActors: TestActor[] = [];

before(async () => {
  recipient = await createTestActor('rls-notification-recipient', PASSWORD);
  createdActors.push(recipient);
  other = await createTestActor('rls-notification-other', PASSWORD);
  createdActors.push(other);
});

after(async () => {
  const results = await Promise.allSettled(createdActors.map((actor) => deleteTestActor(actor)));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`test actor cleanup failed:\n${messages.join('\n')}`);
  }
});

async function createNotification(
  recipientId: string,
  sourceId: string = randomUUID(),
  createdAt?: string,
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notifications')
    .insert({
      recipient_id: recipientId,
      kind: 'invitation_received',
      source_id: sourceId,
      ...(createdAt === undefined ? {} : { created_at: createdAt }),
    })
    .select()
    .single();
  assert.equal(error, null);
  assert.ok(data);
  return data;
}

async function createInvitationSource(): Promise<string> {
  const admin = createAdminClient();
  const { data: event, error: eventError } = await admin
    .from('events')
    .insert({
      owner_id: other.user.id,
      title: 'Notification source fixture',
      starts_on: '2026-10-01',
      ends_on: '2026-10-31',
    })
    .select('id')
    .single();
  assert.equal(eventError, null);
  assert.ok(event);

  const { data: occurrence, error: occurrenceError } = await admin
    .from('event_occurrences')
    .insert({
      event_id: event.id,
      starts_at: '2026-10-15T18:00:00+09:00',
    })
    .select('id')
    .single();
  assert.equal(occurrenceError, null);
  assert.ok(occurrence);

  const { data: invitation, error: invitationError } = await admin
    .from('occurrence_invitations')
    .insert({
      occurrence_id: occurrence.id,
      inviter_id: other.user.id,
      invitee_id: recipient.user.id,
    })
    .select('id')
    .single();
  assert.equal(invitationError, null);
  assert.ok(invitation);
  return invitation.id;
}

async function readNotificationForSource(sourceId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('notifications')
    .select()
    .eq('recipient_id', recipient.user.id)
    .eq('kind', 'invitation_received')
    .eq('source_id', sourceId)
    .single();
  assert.equal(error, null);
  assert.ok(data);
  return data;
}

void test('the schema exposes only the MVP contract and a stable recipient ordering index', async () => {
  const status = readLocalSupabaseStatus();
  const client = new pg.Client({ connectionString: status.dbUrl });
  await client.connect();
  try {
    const { rows: columns } = await client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'notifications'
       order by ordinal_position`,
    );
    assert.deepEqual(
      columns.map((column) => column.column_name),
      ['id', 'recipient_id', 'kind', 'source_id', 'created_at', 'read_at'],
      'notifications must remain the six-field MVP contract without a payload or source registry',
    );

    const { rows: enumValues } = await client.query<{ enumlabel: string }>(
      `select enumlabel
       from pg_enum
       where enumtypid = 'public.notification_kind'::regtype
       order by enumsortorder`,
    );
    assert.deepEqual(enumValues, [{ enumlabel: 'invitation_received' }]);

    const { rows: indexes } = await client.query<{ indexdef: string }>(
      `select indexdef
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'notifications'
         and indexname = 'notifications_recipient_created_at_id_idx'`,
    );
    assert.equal(indexes.length, 1);
    assert.match(
      indexes[0]?.indexdef ?? '',
      /\(recipient_id, created_at DESC, id DESC\)/,
      'the inbox ordering index must use created_at DESC with id DESC as a deterministic tie-breaker',
    );

    const { rows: policies } = await client.query<{ cmd: string; qual: string | null }>(
      `select cmd, qual
       from pg_policies
       where schemaname = 'public'
         and tablename = 'notifications'
       order by cmd`,
    );
    assert.deepEqual(
      policies.map((policy) => policy.cmd),
      ['SELECT'],
    );
    assert.match(policies[0]?.qual ?? '', /recipient_id/);
    assert.match(policies[0]?.qual ?? '', /auth\.uid\(\)/);

    const { rows: writeGrants } = await client.query(
      `select privilege_type, column_name
       from information_schema.role_column_grants
       where table_schema = 'public'
         and table_name = 'notifications'
         and grantee = 'authenticated'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       order by privilege_type, column_name`,
    );
    assert.deepEqual(writeGrants, [], 'authenticated must have no direct write grant');

    const { rows: functionSecurity } = await client.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select prosecdef, proconfig
       from pg_proc
       where oid = 'public.mark_notification_read(uuid)'::regprocedure`,
    );
    assert.deepEqual(functionSecurity, [{ prosecdef: true, proconfig: ['search_path=""'] }]);

    const { rows: functionGrants } = await client.query<{
      authenticated_can_execute: boolean;
      anon_can_execute: boolean;
    }>(
      `select
         has_function_privilege(
           'authenticated',
           'public.mark_notification_read(uuid)',
           'EXECUTE'
         ) as authenticated_can_execute,
         has_function_privilege(
           'anon',
           'public.mark_notification_read(uuid)',
           'EXECUTE'
         ) as anon_can_execute`,
    );
    assert.deepEqual(functionGrants, [
      { authenticated_can_execute: true, anon_can_execute: false },
    ]);

    const { rows: triggerFunctions } = await client.query<{
      tgenabled: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select t.tgenabled, p.prosecdef, p.proconfig
       from pg_trigger t
       join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.occurrence_invitations'::regclass
         and t.tgname = 'occurrence_invitations_create_notification'`,
    );
    assert.deepEqual(triggerFunctions, [
      { tgenabled: 'O', prosecdef: true, proconfig: ['search_path=""'] },
    ]);

    const { rows: triggerFunctionGrants } = await client.query<{
      role_name: string;
      can_execute: boolean;
    }>(
      `select role_name, has_function_privilege(
         role_name,
         'public.create_invitation_received_notification()'::regprocedure,
         'EXECUTE'
       ) as can_execute
       from (values ('anon'::name), ('authenticated'::name), ('service_role'::name)) roles(role_name)
       order by role_name`,
    );
    assert.deepEqual(triggerFunctionGrants, [
      { role_name: 'anon', can_execute: false },
      { role_name: 'authenticated', can_execute: false },
      { role_name: 'service_role', can_execute: false },
    ]);
  } finally {
    await client.end();
  }
});

void test('only the recipient can select a Notification row', async () => {
  const notification = await createNotification(recipient.user.id);

  const { data: ownRows, error: ownError } = await recipient.client
    .from('notifications')
    .select()
    .eq('id', notification.id);
  assert.equal(ownError, null);
  assert.deepEqual(ownRows, [notification]);

  const { data: otherRows, error: otherError } = await other.client
    .from('notifications')
    .select()
    .eq('id', notification.id);
  assert.equal(otherError, null);
  assert.deepEqual(otherRows, [], 'another authenticated user must not see the recipient row');

  const anonymous = createAnonymousClient();
  const { error: anonymousError } = await anonymous.from('notifications').select();
  assert.ok(anonymousError, 'anonymous clients must not have a Notification SELECT surface');
});

void test('authenticated clients cannot directly insert, delete, or update Notifications', async () => {
  const notification = await createNotification(recipient.user.id);

  const { error: insertError } = await recipient.client.from('notifications').insert({
    recipient_id: recipient.user.id,
    kind: 'invitation_received',
    source_id: randomUUID(),
  });
  assert.ok(insertError, 'direct authenticated INSERT must be denied');

  const { error: deleteError } = await recipient.client
    .from('notifications')
    .delete()
    .eq('id', notification.id);
  assert.ok(deleteError, 'direct authenticated DELETE must be denied');

  const { error: canonicalUpdateError } = await recipient.client
    .from('notifications')
    .update({ recipient_id: other.user.id })
    .eq('id', notification.id);
  assert.ok(canonicalUpdateError, 'canonical fields must not be directly updateable');

  const { error: readStateUpdateError } = await recipient.client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notification.id);
  assert.ok(readStateUpdateError, 'read state must only be changed through the bounded RPC');

  const admin = createAdminClient();
  const { data: unchanged, error: unchangedError } = await admin
    .from('notifications')
    .select()
    .eq('id', notification.id)
    .single();
  assert.equal(unchangedError, null);
  assert.deepEqual(unchanged, notification);
});

void test('mark_notification_read is recipient-only, idempotent, and keeps canonical fields immutable', async () => {
  const notification = await createNotification(recipient.user.id);

  const { data: marked, error: markedError } = await recipient.client.rpc(
    'mark_notification_read',
    { p_notification_id: notification.id },
  );
  assert.equal(markedError, null);
  assert.ok(marked);
  assert.equal(marked.id, notification.id);
  assert.equal(marked.recipient_id, notification.recipient_id);
  assert.equal(marked.kind, notification.kind);
  assert.equal(marked.source_id, notification.source_id);
  assert.equal(marked.created_at, notification.created_at);
  assert.ok(marked.read_at, 'the first call must transition the row to read');

  const { data: repeated, error: repeatedError } = await recipient.client.rpc(
    'mark_notification_read',
    { p_notification_id: notification.id },
  );
  assert.equal(repeatedError, null);
  assert.ok(repeated);
  assert.equal(repeated.read_at, marked.read_at, 'repeating the call must be an idempotent no-op');

  const { data: otherResult, error: otherError } = await other.client.rpc(
    'mark_notification_read',
    { p_notification_id: notification.id },
  );
  assert.equal(otherError, null);
  // PostgREST serializes a SQL NULL composite return as an object whose
  // attributes are all null. It carries no row data and, importantly, no
  // identifier that could reveal another user's Notification.
  assert.deepEqual(
    otherResult,
    {
      id: null,
      recipient_id: null,
      kind: null,
      source_id: null,
      created_at: null,
      read_at: null,
    },
    'another user must not update or receive the row',
  );

  const anonymous = createAnonymousClient();
  const { error: anonymousError } = await anonymous.rpc('mark_notification_read', {
    p_notification_id: notification.id,
  });
  assert.ok(anonymousError, 'anonymous clients must not execute the read-state RPC');

  const admin = createAdminClient();
  const { data: persisted, error: persistedError } = await admin
    .from('notifications')
    .select()
    .eq('id', notification.id)
    .single();
  assert.equal(persistedError, null);
  assert.equal(persisted.read_at, marked.read_at);
  assert.equal(persisted.recipient_id, recipient.user.id);
});

void test('the recipient/source identity is unique and source Invitation deletion preserves the Notification', async () => {
  const sourceId = await createInvitationSource();
  const notification = await readNotificationForSource(sourceId);
  const admin = createAdminClient();

  const { data: duplicate, error: duplicateError } = await admin
    .from('notifications')
    .insert({
      recipient_id: recipient.user.id,
      kind: 'invitation_received',
      source_id: sourceId,
    })
    .select()
    .maybeSingle();
  assert.equal(duplicate, null);
  assert.ok(duplicateError, 'the dedupe identity must reject a duplicate source Notification');
  assert.equal(duplicateError.code, '23505');

  const { error: sourceDeleteError } = await admin
    .from('occurrence_invitations')
    .delete()
    .eq('id', sourceId);
  assert.equal(sourceDeleteError, null);

  const { data: surviving, error: survivingError } = await admin
    .from('notifications')
    .select()
    .eq('id', notification.id)
    .single();
  assert.equal(survivingError, null);
  assert.equal(surviving.id, notification.id);
  assert.equal(surviving.source_id, sourceId);
});
