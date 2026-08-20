# stage-tracker product rules

これは `reitojike/stage-tracker` の canonical product rule source です。
`reitojike/stage-tracker-old` は historical evidence に過ぎず、この source を
上書きしません。product semantics はここで再承認したものだけを記載します。

PR B (shared event catalog minimal slice) の時点で、`public.events` の
schema / RLS / domain permission matrix が実装済みです。以下はその範囲で
既に承認済みの semantics です。

## Event catalog

- Event 情報は authenticated users 間の共有 catalog です。anonymous user は
  catalog を閲覧・変更できません。
- per-user の participation / ticket acquisition / expense は event catalog
  とは分離した personal concept として扱います。
- Event owner は情報管理者です。owner であることは participant / organizer /
  inviter であることを意味しません。

### Ownership

- event を作成した authenticated user がその event の owner になります。
- owner だけが event 情報を更新できます。non-owner は更新できません。
- owner transfer は product operation として提供しません。owner 自身であっても
  owner を別 user へ変更することはできません。
- event の作成者と、最終的に persist される owner は一致していなければ
  なりません（owner spoofing は不可）。

### Mutable / system-managed fields

- owner が変更できるのは event の記述情報（例: title / venue / 開催日時 /
  参照 URL / memo）です。
- record の識別子・作成日時・owner とレコードの更新日時は system-managed と
  し、normal な authenticated client から直接書き換えられる対象にはしません。

### Deletion

- PR B の時点では event deletion を提供しません。存在する event row は
  すべて current catalog row として扱います。
- deletion semantics（論理削除の要否を含む）は、それを扱う専用の product
  task で別途決定します。「将来 migration したくない」という理由だけで
  deletion 用の schema を先行実装しません。

## Invitation

- invite 可否は event へ参加登録済みかで決まり、owner かどうかでは決まりません。
- MVP の invite は approval flow を持たず、invite 時点で invitee の schedule
  へ即時反映します。

## Participation

- participation visibility の default は `private` です。
  - `private` = 本人のみ
  - `public` = authenticated users 全員
- participation の intention/planning と ticket acquisition は独立した
  concept とし、ticket の結果から participation status を自動変更しません。
- participation status の初期 semantic 候補は `considering` / `attending` /
  `not_attending` です。
- participation の table 名・永続化 shape は participation 実装時まで固定
  しません。

## 時刻・タイムゾーン

- product 上の日付境界は `Asia/Tokyo` です。
- persisted timestamp は PostgreSQL `timestamptz` です。

## 先行実装しないもの

- 将来用の `participation_state` / invite approval states /
  `profiles.is_admin` 等を、「後で migration したくない」という理由だけで
  先行実装しません。
- MVP 後の変更を不必要に阻害する不可逆 coupling は避けますが、将来可能性
  だけを理由にした speculative machinery も作りません。

## まだ決めていないもの

以下は関連する product task が起票されるまで、このファイルへ追記しません。

- participation の persistence / table naming
- budget 集計の期間基準
- ticket entry と participation row の必須関係
- PWA scope
- MCP product scope

## Supabase

- database development の source of truth は repository migrations です。
- development / schema / RLS / generated types / DB tests は local-first
  Supabase を使います。
- local で成立した後に新しい Supabase remote project を作成します。
- 旧 Supabase project は historical evidence / data reference に限り、新
  schema の authority にはしません。
- PR B の時点で、local Supabase 上の `events` migration / RLS / generated
  TypeScript database types / DB・RLS test が実際に導入済みです。
- remote Supabase project の provisioning は、local schema/RLS/types/test が
  成立した後の別 operational step として扱い、product task の merge gate には
  しません。
