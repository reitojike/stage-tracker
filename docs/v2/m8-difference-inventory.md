# v2 / legacy 意図的差分 inventory

Canonical Task Contract: Issue #391（v2 M8: legacy と並走検証し、差分を分類しきる）
の「着手できる単位」1 を対象とします。

## 目的とスコープ

並走比較（同 Issue の別の作業単位）を始める前に、「v2 が legacy と意図的に
異なる点」をあらかじめ洗い出しておく。並走比較中に観測した差分は、Issue #391
の 3 分類のいずれかに割り当てる。

1. **意図した差分** — 本 inventory の項目に一致するもの
2. **v2 の不具合** — 本 inventory に無い、oracle からも外れた差分
3. **legacy の不具合を v2 が正したもの** — 本 inventory の項目のうち、
   legacy 側の既知バグを修正する形になっているもの（各項目に明記する）

対象は **観測可能な product behavior の差分**に限る。実装技術の違い
（CSS Modules → Tailwind 等）はここに含めない。

## 重要な前提の訂正（初版からの変更）

初版はこの inventory を `docs/v2/decisions.md` / `AGENTS.md` の決定履歴
（Issue #87、#121、#123-125、#158/#167、#225/#230/#234 等）から機械的に
洗い出し、「これらの決定は legacy には無い、v2 固有の新しい挙動」と誤って
扱っていた。review（Codex）の指摘により、**実際の現行ソースコードを両アプリで
読み直して検証**した結果、これは前提から誤りだったと判明した。

`apps/legacy-web` は現在も稼働中の production app であり、v2 とは**同一の
Supabase project / 同一スキーマ**を共有する（`docs/v2/README.md`）。上記の
決定の多くは v2 の新規決定ではなく、**legacy 自身が過去に受けた product
change**であり、legacy のアプリケーションコードは既にそれらを実装済みだった
（例: `apps/legacy-web/src/app/catalog/_components/EventCreateForm.tsx` は
0-occurrence Event 作成を既に許可し、`apps/legacy-web/src/domain/
personalSchedule.ts` は既に `title`/`blocking` へ移行済みで、
`schedule_type` 固定 enum は残っていない）。v2 はこれらを「legacy と違う
新しい挙動」として作っているのではなく、**現行の共有 product 仕様に
一致させて**作っている。

そのため、決定履歴（decisions.md / AGENTS.md）に載っているというだけの
理由で inventory item にはしない。**両アプリの実ソースを読み、実際に現在
挙動が異なると確認できたものだけ**を below に記載する。

## 出典についての注記

Issue #391 の Acceptance Criteria は「各項目が `docs/v2/decisions.md` の
該当箇所を参照している」ことを求める。本 inventory に残った項目は、
`docs/v2/decisions.md` に決定の記述がある差分（P3、P4）に限られたため、
すべて直接 citation できる。

---

## 意図した差分（実コードで確認済み）

### 1. Invitation の decline が「8 秒タイマーでの確定」から「確認ダイアログ + 即時 hard delete（undo 無し）」へ変わった

- **legacy（現状）**: `apps/legacy-web/src/app/catalog/_components/
InvitationCard.tsx` が `DECLINE_UNDO_WINDOW_MS = 8000` の client-local
  `declining` phase（`CardPhase = 'pending' | 'busy' | 'declining'`）を持つ。
  「参加しない」を押すと 8 秒間の optimistic UI へ入り、`setTimeout` で
  確定する。**通常のページ遷移（React の unmount が発火するケース）では、
  mount-only cleanup が `declining` phase を検知して即座に
  `finalizeDeclineOnce()` を呼び、確定（削除）する** — これは正しい挙動で
  バグではない。バグが起きるのは、タブを閉じる／ブラウザを閉じる等
  **unmount 自体が発火しない離脱**の場合のみで、この場合だけ削除されずに
  invitation が `pending` のまま残り得る。
- **v2（現状）**: `apps/web/src/app/(app)/catalog/invitations/_components/
InvitationList.tsx` は `{ kind: "confirm-decline" }` phase を持つ。
  「参加しない」を押すと確認ダイアログ（押し間違い対策）を経て、確定操作で
  即座に `declineInvitationAction` を呼び hard delete する。undo は無い
  （Issue #382 は undo 不実装で close 済み — invite の opacity 境界
  （要件 A/B/C）が同時に成立しないことが実装時に判明したため）。タブを
  閉じても確定するため、legacy のバグは構造的に再現しない。
- **一次citation**: `docs/v2/decisions.md`「PO 判断: 確定（2026-09-07）」表
  P3 行（117 行目）、`### P3 — decline の確定と undo`（122 行目以降）、
  `## P3 の実装可否: decline の undo は現行スキーマでは実現できない
（2026-09-08）`（689 行目以降）、`### PO 判断: undo は作らない
（2026-09-08、Issue #382 を close）`（717 行目以降）。
- **journey**: invitation。
- **分類のヒント**: この項目は「意図した差分」であると同時に、legacy 側の
  実バグ（タブを閉じた場合に pending が残り得る）を v2 が正した項目でもある。
  並走比較で legacy 側のこのバグを再現できた場合、分類 3
  （legacyの不具合をv2が正したもの）としても記録すること。
- **確信度**: CLEAR（両アプリの実装ファイルで確認済み）。

### 2. Calendar（`/calendar`）のエラー表示が「単一の集約エラー」から「read ごとに独立した劣化」へ変わった

- **legacy（現状）**: `apps/legacy-web/src/app/calendar/page.tsx`
  （94-111 行目付近）は participations の読み取りと personal schedule の
  読み取りを `Promise.all` で並行取得し、どちらか一方でも失敗すると
  両方の結果を破棄して**単一の汎用エラーパネル**を表示する。成功した方の
  データも一緒に握りつぶされる。
- **v2（現状）**: `apps/web/src/app/(app)/calendar/_lib/calendar-loader.ts`
  が `loadCalendarOccurrences` / `loadCalendarSchedule` という 2 つの
  独立した `BlockState` を返すローダーを持ち、
  `apps/web/src/app/(app)/calendar/_components/CalendarView.tsx` が
  「参加予定」「個人の予定」を独立したセクションとして描画し、それぞれが
  自分の `StatePanel` 状態を持つ。片方が失敗しても、もう片方は正常に
  表示され続ける。v2 側の doc comment 自身が「legacy の単一エラーパネル
  挙動から意図的に逸脱する部分」と明記している。
- **一次citation**: `docs/v2/decisions.md`「PO 判断: 確定（2026-09-07）」表
  P4 行（118 行目）、`### P4 — エラー粒度の統一`（141 行目以降）。
- **journey**: calendar（participation / personal schedule の統合表示）。
- **確信度**: CLEAR（両アプリの実装ファイルで確認済み、v2 側は該当箇所に
  この差分を明記するコメントを持つ）。

---

## 既知の v2 不具合（並走比較を待たず分類 2 として先に記録するもの）

以下は「意図した差分」ではなく、oracle が要求する挙動から v2 が外れている
ことを実コードで確認済みの項目。Issue #391 の分類定義（「2. v2 の不具合 —
本 inventory に無い、oracle からも外れた差分」）に従い、並走比較で改めて
発見されるのを待たず、この時点で分類 2 として記録する。

### 3. Ticket opportunity の planning state 書き込み UI が v2 にまだ無い

- **legacy（現状）**: `apps/legacy-web/src/app/tickets/_components/
TicketOpportunityStateControls.tsx` により `planned`/`applied`/解除の
  書き込みができる。
- **v2（現状）**: `apps/web/src/app/(app)/tickets/_components/
TicketsView.tsx` は同じデータモデル（`TicketOpportunityTimelineRow`、
  `planned`/`applied` の 2 値）を読み取り表示するが、
  `updateTicketOpportunityStateAction` 相当の書き込み操作が実装されて
  いない。`docs/v2/oracle-routes-ui.md`「チケット一覧」節はこの書き込み
  controls を要求しているため、これは意図的な設計判断ではなく **oracle
  から外れた v2 の不具合（分類 2）**である。
- **journey**: ticket opportunity。
- **今後**: この screen が実装されれば本項目は inventory から消える。

### 4. Catalog filter の group/venue option が v2 では genre 非依存になっている

- **legacy（現状）**: `apps/legacy-web/src/app/catalog/_lib/
catalogFilterData.ts` は genre ごとに
  `listCatalogGroupOptions(client, genre.id)` /
  `listCatalogVenueOptions(client, genre.id)` を呼び、その genre に
  associate された group/venue だけを option として返す。
- **v2（現状）**: `apps/web/src/app/(app)/catalog/_lib/catalog-loader.ts`
  は genre を引数に取らない `listCatalogGroups(supabase)` /
  `listCatalogVenues(supabase)` を呼び、catalog 全体（全 genre 横断）の
  group/venue を option として返す。複数 genre のデータが存在する場合、
  宝塚の facet にアイドルの group、歌舞伎の facet に他 genre の venue まで
  option として現れ、無関係な option を選択すると意図せず結果が空になり
  得る。`AGENTS.md`「Facet model」節が定める genre ごとの facet 分離semantics
  から外れているため、これは presentational な差ではなく **v2 の不具合
  （分類 2）**である。
- **journey**: catalog。
- **今後**: この不具合が修正されれば本項目は inventory から消える。

---

## 検討したが inventory に含めなかったもの（実コード比較の結果、現在は同じと確認）

以下は `docs/v2/decisions.md` / `AGENTS.md` の決定履歴には載っているが、
**legacy 自身が既にその決定を実装済み**であり、v2 との間に現在観測可能な
差分は無いことを実ソースコードで確認した。並走比較中に誤って「差分」として
報告されないよう記録しておく。

- **Event range / 0-occurrence Event**（Issue #87）: legacy の
  `EventCreateForm.tsx` / `EventLevelFallbackList.tsx` は既に 0-occurrence
  Event の作成・表示を許可している。v2 の `NewEventForm.tsx` /
  `CatalogView.tsx` と同じ挙動。
- **Catalog classification の facet 切り替え・filter semantics 自体**
  （Issue #158/#167）: legacy の `FilterSheet.tsx` と v2 の
  `CatalogView.tsx` の `FilterPanel` は同じ genre→facet 切り替え・
  facet 内 OR / facet 間 AND・localStorage persistence を持つ。v2 側は
  `packages/ui` に `Sheet` primitive が無いため native `<dialog>` では
  なく inline panel を使っているが、これは presentational な差。
  **ただし option の取得範囲自体（genre 非依存になっている）は不具合として
  上記「既知の v2 不具合」項目 4 で別途扱う** — facet 切り替えの仕組みが
  同じであることと、option が正しく genre スコープされているかは別の話。
- **Ticket model そのもの**（Issue #225/#234）: legacy には acquired-ticket
  inventory/assignment/transfer の UI は既に存在せず、
  `TicketOpportunityRow.tsx` 等の MVP モデルのみ。v2 も同じモデル
  （書き込み UI の有無は上記「既知の v2 不具合」項目 3 を参照）。
- **Invitation pending-only semantics**（Issue #225/#230）: legacy の
  `invitation.ts` / `invitation.ts`（infrastructure 層）は既に
  DELETE ベースの `decline_occurrence_invitation` RPC を使い、accept 専用
  RPC を持たない。v2 の `lib/actions/invitations.ts` も同じ RPC・同じ
  「accept は通常の participation write」設計を使う。
- **Cancellation vs Deletion split**（Issue #123/#124/#125）: schema は
  共有（`supabase/migrations/**`）。legacy の `eventCancellation.ts` と
  v2 の `lib/actions/events.ts` は同じ独立 boolean（Event-level /
  Occurrence-level `canceled_at`）+ OR 合成モデルを使う。
- **Personal Schedule の free-form title + blocking**（Issue #121）:
  legacy の `personalSchedule.ts` は既に `schedule_type` 固定 enum を
  持たず、`title`/`blocking` へ移行済み。v2 の
  `ScheduleEntryFields.tsx` も同じフィールドを使う。
- **Venue の表記揺れ正規化**（`docs/v2/decisions.md` P6）: import 経路は
  リポジトリ全体で `apps/legacy-web/scripts/import-catalog-events.mjs`
  1 本のみ（v2 専用の import は存在しない）。この script の
  `validateEntry()` は `.trim()` のみで、全角半角や内部空白の正規化は
  行っていない。**legacy・v2 のどちらにも実装されていない、未着手の
  今後の計画**であり、現時点では差分ではない。実装された時点で本
  inventory へ追加すること。
- **通知ベル（P1）**: legacy・v2 とも非活性のまま UI に配置。挙動は同じ。
- **グローバルナビの 4 項目固定（P2）**: legacy・v2 とも `/schedule`・
  `/mypage` はナビ項目に含めない。挙動は同じ。
- **中止時の新規 `considering` 作成拒否**: `docs/v2/decisions.md`
  「PO 判断: 中止時の participation 新規作成（2026-09-07）」
  （235 行目）は、product-rules の文言と実際の DB trigger の食い違い
  （ドキュメント上の曖昧さ）を解消しただけで、コード変更は無い
  （「コード変更は不要」と明記）。legacy の実際の DB 挙動と v2 は同じ。
- **`--color-primary` 未定義参照という CSS bug**: 純粋に visual な問題で
  あり、上記の journey のいずれの機能挙動にも影響しない。

## まだ決めていない事項（差分ではなく、比較対象にもならない）

`AGENTS.md`「まだ決めていないもの」節に列挙されている事項
（Ticket の削除/訂正、Post-MVP の Event 作成権限拡大の verification
workflow、budget 集計期間、canonical venue identity の具体形、公演回ごとに
会場が異なる興行の扱い、Event range 自体が未公表の event の表現、PWA の
offline scope、Web Push の product scope、MCP product scope）は、legacy・v2
いずれにも実装が存在しないか、determination 自体が先送りされているため、
並走比較の対象にならない。

## この inventory の運用上の注意

本 inventory は**時点のスナップショット**である。並走比較を実施する時点で、
上記「既知の v2 不具合」（項目 3・4）が解消されている可能性があるため、
実施直前に該当箇所のソースを再確認すること。同様に、legacy・v2 いずれかに
新しい変更が入った場合、この inventory 自体の再検証が必要になる。
