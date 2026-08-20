# stage-tracker product rules

これは `reitojike/stage-tracker` の canonical product rule source です。
`reitojike/stage-tracker-old` は historical evidence に過ぎず、この source を
上書きしません。product semantics はここで再承認したものだけを記載します。

現時点では PR A (consumer bootstrap baseline) の範囲であり、product database
schema / RLS / event CRUD 等の実装は含みません。以下は将来の product task が
前提とする、既に承認済みの semantics です。

## Event catalog

- Event 情報は authenticated users 間の共有 catalog です。
- per-user の participation / ticket acquisition / expense は event catalog
  とは分離した personal concept として扱います。
- Event owner は情報管理者です。owner であることは participant / organizer /
  inviter であることを意味しません。

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
- PR A の時点では product schema がまだ無いため、Supabase types / RLS / DB
  test は導入しません。これらは実際に必要になる最初の real product task で
  導入します。
