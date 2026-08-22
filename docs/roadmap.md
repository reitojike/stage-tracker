# stage-tracker roadmap

このroadmapは、productとして何をどの方向に成立させていくかを示す
directional documentです。固定されたMVP bundleや厳密な実装順序を宣言する
ものではありません。development process（provider/model routing、review
工程、Issue運用等）はここに含みません。process governanceの正本は
Foundation v0.2.0 です。

## Roadmap principle

誤って静かに成立してしまうと事故につながるsemantics（permission /
privacy / RLS等）は、UIより先に固めることを原則とします。

## 1. Completed baseline

- Foundation v0.2.0 consumer baseline
- shared event catalog（`public.events` / `public.event_occurrences` の
  schema / RLS）
- event ownership semantics（owner限定更新・owner transfer不可・owner
  spoofing防止を含む permission baseline）
- eventと公演回（occurrence）のtemporal model・公演回の管理権限
  （1 event : N occurrence、occurrence starts_at必須/ends_at nullable、
  create/updateはparent event ownerのみ、event作成はevent + initial
  occurrenceを1 transactionで作るRPC経由のみ）
- designated catalog creator限定のminimal Event catalog write UI
  （Event作成は `public.catalog_creators` membershipに限定・作成者が
  owner・Event更新と公演回のadd/updateはowner限定・deletion/cancellationは
  対象外・開演/終演の前後関係はwrite pathで検証。`event_occurrences` への
  CHECK制約は未導入で、DB levelの不変条件ではない）

これらは [`docs/prd.md`](./prd.md) が指す
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に従って既に実装済みです。

occurrence-level participation / invitation、event-independent personal
schedule、ticket acquisition / ticket / ticket transfer、calendar上の
Saturday/Sunday/Japanese holiday presentationのsemanticsも
product-rules.md / `docs/ux-ui.md` で承認済みですが、対応する
schema/RLS/UIはまだ実装されていません。こちらは次節のMVP personal
planning capabilityの中で実装します。

catalog classification / venueについては、将来の分類導入を阻害しない
MVP data boundary（event-level・複数value許容・`troupe`等の
domain-specific columnを追加しない、venueは現行`events.venue` textを
維持する等）のみがMVPで承認済みです。classification / venueの
persistence実装・filter UIは対象外で、下記「Post-MVP direction」に
含みます。MVPでの実装対象には含めません。

## 2. MVP personal planning capabilities（成立させたい方向性）

以下は、[`docs/prd.md`](./prd.md) のmain domain conceptsのうち、event
catalog以外でMVPとして成立させたい主要capabilityです。列挙順は実装順序の
固定を意味しません。それぞれ、着手時に専用のbounded product Taskでscope
とsemanticsを確定してから進めます。detailed product semanticsは
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とします。

- **occurrence-level participation / invitation** — ユーザーごとの
  occurrence参加予定管理と、そこからのinvitation（詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  参照）
- **event-independent personal schedule** — eventとは独立したpersonal
  scheduleと共有（詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  参照）
- **ticket acquisition / ticket** — チケット入手情報とticketの管理（詳細は
  [`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  参照）
- **calendar weekday / Japanese holiday presentation** — Saturday/
  Sunday/Japanese holidayのglobal calendar presentation（詳細は
  [`docs/ux-ui.md`](./ux-ui.md) 参照）
- **expense / budget** — event単位の支出と横断的な予算管理（semanticsは
  未確定）

## 3. Post-MVP direction

以下はMVP scopeには含まれない、方向性としては採用済みだが着手時期を
決めていない領域です。着手時は専用のproduct Taskでscopeとsemanticsを
確定します。

- week-start preference
- photo upload / attendance memory・impression
- venue filtering / canonical venue identity
- 宝塚の組filter / visual cue UI、アイドルのグループfilter UI
- classification persistence / filter UI
- 宝塚 streaming
- movie release / admin-curated movie catalog
- broader Event create permissions（一般authenticated userへの拡大）＋
  verification / moderation mechanism（[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
  のPost-MVP governance gate参照）

## 4. Deferred / uncommitted areas

以下はcurrent committed scopeに含まれない、未決定領域です。必要になった
時点で専用のproduct Taskで評価します（詳細は
[`docs/prd.md`](./prd.md#deferred-decisions) 参照）。

- MCP product scope
- PWA scope（installability / offline capability）
- sign-in provider / production hosting provider
- 家族・友人への本格展開時期
