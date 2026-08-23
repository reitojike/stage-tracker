# Gate A remote environment runbook

Canonical Task Contract: Issue #61. This runbook covers only the Gate A
bounded 2-user dogfood remote environment (Vercel Hobby + a new hosted
Supabase project + Postmark Developer SMTP). It is not a general production
deployment guide — see `docs/roadmap.md` / `docs/prd.md` for what remains
deferred beyond Gate A.

Repository migrations are the only schema authority. Never hand-edit
schema/RLS/RPCs in the Supabase Dashboard SQL editor — every schema change
ships as a migration in `supabase/migrations/**` and is applied to the
remote project from this repository.

## Secret boundary

- The deployed app only ever receives `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` as Vercel production environment
  variables. Both are public by design (see `src/infrastructure/supabase/env.ts`).
- The Supabase **service role key** is never set as a Vercel environment
  variable and never committed. It is only used from an operator's own
  shell, for the duration of one command, via
  `STAGE_TRACKER_REMOTE_SUPABASE_URL` / `STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY`
  (see `scripts/lib/adminTarget.mjs`) or the Supabase CLI's own linked-project
  auth.
- Postmark server tokens live only in the Supabase Dashboard's Auth SMTP
  settings, not in this repository or in Vercel.
- Do not paste actual dogfood email addresses, service role keys, Postmark
  tokens, or Vercel/Supabase project identifiers into an Issue, PR, or
  commit message. Refer to the two dogfood accounts as `A` / `B`.

## One-time provider setup (operator-only, outside this repository)

These steps require interactive login to Vercel/Supabase/Postmark and are
not something an agent session can perform without the operator's own
credentials. Record completion here by editing this file's checklist, not
by recording the actual identifiers.

1. Create a new Vercel project (Hobby plan) from this GitHub repository,
   with `main` as the production branch. Do not let it build yet — step 2
   must supply required env vars first, or the first build throws on the
   missing values (see step 5).
2. Create a new hosted Supabase project (Free plan is acceptable for Gate A).
   Note its project ref for `supabase link`.
3. Create a Postmark account, a Server, and one verified Sender Signature
   (the Developer plan's 100 emails/month allowance is the accepted Gate A
   starting limit — see Issue #61's bounded provider decision).
4. In the Supabase Dashboard, under Auth → SMTP, enable custom SMTP and
   fill in the Postmark server's SMTP credentials.
5. In the Vercel project's Production environment variables, set
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
   hosted Supabase project's API settings (Project Settings → API). Both
   are read at request time by `src/infrastructure/supabase/env.ts`, which
   throws on any missing value — the first production deploy must happen
   after these are set, and any deploy that ran before they were set must
   be redeployed once they are.

## Schema migration to the hosted project

Run from a machine with the Supabase CLI installed and authenticated
(`supabase login`):

```bash
supabase link --project-ref <the-project-ref-from-step-2>
supabase db push
```

`supabase db push` applies `supabase/migrations/**` in order and records
migration history on the remote project. After it completes, confirm there
is no drift:

```bash
supabase db diff --linked
```

An empty diff means the remote schema matches the repository exactly. Any
non-empty diff means something was changed outside a migration (most
commonly a Dashboard hand-edit) and must be investigated before proceeding
— do not paper over it with a new migration that just re-states the
drifted state.

Re-run `supabase db push` after every merge that adds a migration. There is
no automatic CI step that pushes migrations to the hosted project; this is
a manual operator action by design (Issue #61: "multiple sessions が同じ
remote schema を無秩序に mutate しない").

## Auth configuration (Supabase Dashboard → Authentication)

- **URL Configuration → Site URL**: the canonical Vercel production URL
  for this project.
- **URL Configuration → Redirect URLs**: add the same origin's
  `/auth/confirm` path (the route the magic-link template points at — see
  `src/app/auth/confirm/route.ts` and the comment in
  `supabase/config.toml` under `[auth.email.template.magic_link]`).
- **Providers → Email**: enabled, confirmations off (matches
  `supabase/config.toml`'s local baseline).
- **Auth settings → Allow new users to sign up**: **disabled**. This is
  the remote equivalent of `supabase/config.toml`'s `enable_signup = false`
  and is the actual enforcement point once local `config.toml` no longer
  applies. Verify this is off after every Dashboard visit — it is the
  single most important setting in this section.
- **Email Templates → Magic Link**: paste the contents of
  `supabase/templates/magic_link.html` (this repository's source of truth)
  so the hosted project's link routes through `/auth/confirm` the same way
  local development does, instead of Supabase's default template that
  bypasses this app's route handler.

There is no CLI command that applies Auth configuration or email templates
from `supabase/config.toml` to a hosted project — these are Dashboard-only
settings and must be re-applied by hand if the project is ever recreated.

## Deploy / update

Vercel auto-deploys `main` on every push once the project is connected
(step 1 above). There is no separate manual deploy step. Migration
ordering depends on whether the change is backward-compatible with the
already-deployed build:

- **No new migration, or a backward-compatible one** (new nullable
  column, new table/RPC nothing yet references): merge, let Vercel deploy,
  then run the schema migration steps against the hosted project. The
  already-deployed build never depends on the new shape, so serving it
  briefly against the old schema is safe.
- **A migration the new build requires immediately** (a column/table/RPC
  the new code reads or writes as soon as it runs): apply the schema
  migration steps against the hosted project **before** merging /
  deploying, not after. Deploying the new build first would point it at a
  schema that does not have what it needs yet, and every request that
  touches that path fails until the migration lands.

In both cases: merge to `main` (normal PR flow, Foundation v0.3.0 Review
Protocol), confirm the Vercel deployment for that commit succeeds and the
production URL serves the new build, and run the schema migration steps
above at the point the case you're in calls for.

## Account provisioning (2 dogfood accounts)

From an operator shell, with the remote service role key exported only for
this command:

```bash
STAGE_TRACKER_REMOTE_SUPABASE_URL=https://<project-ref>.supabase.co \
STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/provision-user.mjs <email> --remote
```

Run once for each of the two dogfood accounts. This only creates the
account (`email_confirm: true`, no password) — sign-in is always the
normal magic-link flow at `/sign-in` afterwards.

## Catalog creator grant / revoke

Same remote-target pattern:

```bash
STAGE_TRACKER_REMOTE_SUPABASE_URL=https://<project-ref>.supabase.co \
STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/grant-catalog-creator.mjs <email> grant --remote
```

Pass `revoke` instead of `grant` to remove membership. Both scripts default
to the local dev stack when `--remote` is omitted — remote is always an
explicit opt-in, never the default target.

## 2-user cross-account smoke

See Issue #61 "2-user remote smoke / acceptance" (items 1–12) for the
exact checklist. Record results using `A` / `B`, never actual emails.
Items 1–11 can be exercised before Issue #34 (My Calendar) merges; item 12
(cross-user My Calendar smoke) is part of Gate A final acceptance, not this
Issue's own merge-ready fence.

## Known operational limits

- Supabase Free plan pauses the project after a period of low activity.
  This is an accepted Gate A limitation, not something this runbook works
  around with a keepalive job. If it causes real friction, re-evaluate a
  Pro upgrade rather than adding automation to dodge the pause.
- Postmark Developer plan allows 100 emails/month. If 2-user dogfood usage
  exceeds that, re-evaluate the plan rather than switching SMTP providers
  ad hoc.
