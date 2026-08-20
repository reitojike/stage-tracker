# stage-tracker roadmap

このroadmapは、productとして何をどの方向に成立させていくかを示す
directional documentです。固定されたMVP bundleや厳密な実装順序を宣言する
ものではありません。development process（provider/model routing、review
工程、Issue運用等）はここに含みません。process governanceの正本は
Foundation v0.1.0 です。

## Roadmap principle

誤って静かに成立してしまうと事故につながるsemantics（permission /
privacy / RLS等）は、UIより先に固めることを原則とします。

## 1. Completed baseline

- Foundation v0.1.0 consumer baseline
- shared event catalog（`public.events` の schema / RLS）
- event ownership semantics（owner限定更新・owner transfer不可・owner
  spoofing防止を含む permission baseline）

これらは [`docs/prd.md`](./prd.md) が指す
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
に従って既に実装済みです。ただしこのbaselineには、product-rules.mdで
承認済みのeventと公演回（occurrence）のtemporal model・公演回の管理権限は
含まれておらず、未実装です。これらは専用のschema taskで実装します。

invitation可否・participation visibility既定値等のsemanticsも
product-rules.md で承認済みですが、対応するschema/RLSはまだ実装されて
いません。こちらは次節の participation / personal schedule capability
の中で実装します。

## 2. Core product capabilities（成立させたい方向性）

以下は、[`docs/prd.md`](./prd.md) のmain domain conceptsのうち、event
catalog以外でこれから成立させたい主要capabilityです。列挙順は実装順序の
固定を意味しません。それぞれ、着手時に専用のbounded product Taskでscope
とsemanticsを確定してから進めます。

- **participation / personal schedule** — ユーザーごとのevent参加予定管理
- **ticket acquisition** — チケット入手情報の管理
- **expense / budget** — event単位の支出と横断的な予算管理

## 3. Deferred / uncommitted areas

以下はcurrent committed scopeに含まれない、未決定領域です。必要になった
時点で専用のproduct Taskで評価します（詳細は
[`docs/prd.md`](./prd.md#deferred-decisions) 参照）。

- MCP product scope
- PWA scope（installability / offline capability）
- sign-in provider / production hosting provider
- 家族・友人への本格展開時期
