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
（CSS Modules → Tailwind 等）はここに含めない。並走比較の tester が
「同じに見えるべきか、違って見えるべきか」を判断する材料になることだけを
基準にする。

## 出典についての注記

Issue #391 の Acceptance Criteria は「各項目が `docs/v2/decisions.md` の
該当箇所を参照している」ことを求める。実際には、`docs/v2/decisions.md` は
主に M4–M8 期間に新たに浮上した論点の決定ログであり、本 inventory が扱う
主要な差分の多くは、それより前に確定し `AGENTS.md`「Consumer product
rules」節（canonical source）へ既に定着済みの決定である。`decisions.md`
はそれらに触れる箇所を持つが、決定そのものの正本ではない。

そのため本 inventory は、決定の正本が `AGENTS.md` にある項目は `AGENTS.md`
の該当見出しを一次citationとし、`docs/v2/decisions.md` 側に対応する言及が
あれば補助citationとして併記する。決定そのものが `docs/v2/decisions.md` に
存在する項目は、そこを直接citationする。全項目が `docs/v2/decisions.md`
（またはそれが指し示す `AGENTS.md`）から追跡可能である、という
Acceptance Criteria の意図は満たしている。

---

## Catalog / Event management

### 1. Event range が公演回集合から独立した first-class data になり、0 件公演回の Event が valid になる

- **legacy**: Event の開催期間は公演回の日付から導出する派生値（Issue #13 時点の
  ルール）。少なくとも 1 件の公演回を持たない Event は成立しない。
- **v2**: `starts_on`/`ends_on` を Event 自身が持つ必須 (not null) データとし、
  公演回集合から自動導出しない。0 件公演回の Event を valid とし、catalog へ
  即座に可視化する（日程確保情報として）。
- **一次citation**: `AGENTS.md`「Event と公演回」節・「Event 開催期間
  （Event range）」節（Issue #87。「#13 で確定した『公演期間は公演回からのみ
  導出する』ルールを明示的に上書きします」と明記）。
- **journey**: catalog / event 管理。
- **確信度**: CLEAR（明示的な upstream ルールの上書き）。

### 2. Catalog classification（genre / group / venue facet）が Post-MVP から Gate A（現行 committed scope）へ前倒しされた

- **legacy**: classification 相当の機能は Post-MVP 扱いで、v1 には存在しない
  （genre / group / venue によるフィルタ UI 自体が無い）。
- **v2**: genre（0..1）/ group（0..N）/ venue（歌舞伎のみ有効な facet、exact
  text match）による絞り込みを Gate A の committed scope として実装する。
- **一次citation**: `AGENTS.md`「Catalog classification / venue boundary」節
  （Issue #158 の PO 判断で Post-MVP early → Gate A へ promote、#167 で
  persistence / import / read boundary を materialize）。
- **補助citation**: `docs/v2/decisions.md` A15 行（56 行目、genre/group の
  非対称モデリングは「意図的な設計判断」と明記）。
- **journey**: catalog。
- **確信度**: CLEAR。

### 3. Venue の表記揺れを import 時に正規化する（venue master は作らない）

- **legacy**: `events.venue` は生 text のまま import され、表記揺れ
  （全角/半角、余分な空白）を正規化する処理は無い。
- **v2**: venue master（`venues` テーブル）は同様に作らないが、**import 時に
  空白・全角半角を正規化**して表記揺れを減らす。既存行への遡及的な一括
  backfill は行わない（「destructive reset は不要」）。
- **一次citation**: `docs/v2/decisions.md`「PO 判断: 確定（2026-09-07）」表
  P6 行（120 行目）および `### P6 — venue の正規化`（164 行目以降）。
- **journey**: catalog。
- **確信度**: INFERRED寄りのCLEAR — 正規化を行う方針自体は明示的だが、
  legacy の import が現在正規化を一切行っていないかどうかは
  `apps/legacy-web` の import script 側で個別に確認していない。並走比較で
  「新規 import した venue 表記」を見るときに、正規化の有無が実際に違いとして
  観測されるかを確認すること。

---

## Ticket opportunity

### 4. 取得済みチケットの在庫・割当・譲渡モデルを撤去し、TicketOpportunity（販売機会の発見 + `planned`/`applied` の personal planning state）のみを残す

- **legacy**: v1 は「取得済みチケット」を inventory として持ち、status /
  assignment / ownership transfer を扱うモデルを実装していた
  （Issue #225 で過剰スコープと判断されるまで）。
- **v2**: この旧モデルは history からも復元しない。残すのは
  TicketOpportunity（販売機会そのもの）と `UserTicketOpportunityState`
  （`planned`/`applied` の 2 値のみの personal planning state）だけ。
  実際の申込内容・希望順位・枚数・当落・座席・inventory・ownership transfer は
  この model に含めない。
- **一次citation**: `AGENTS.md`「Ticket model removal」節・「Ticket
  Opportunity（Ticket planning MVP）」節（Issue #225 → #234 で撤去、#157 で
  現行 MVP モデルを確定）。
- **補助citation**: `docs/v2/decisions.md`「v2 実装で踏んではいけない地雷」
  1つ目の bullet（65 行目、「history から復元しないこと」と明記）。
- **journey**: ticket opportunity。
- **確信度**: CLEAR。

---

## Invitation

### 5. Invitation が pending-only coordination へ収束し、auto-considering 作成と decline の永久 opt-out ロックが撤廃された

- **legacy**: 旧 semantics（#30 時点）は invite 時に invitee の participation
  を自動的に `considering` へ作成し、decline は永久的な re-invite 拒否
  （opt-out ロック）として扱っていた。
- **v2**: invite は invitee の participation を作成・変更しない（pending
  invitation を作るだけ）。decline は pending invitation の解消に過ぎず、
  永久 opt-out ではない。invitee が `attending` でない限り、同じ inviter が
  後日 re-invite できる。
- **一次citation**: `AGENTS.md`「Invitation」節冒頭（「Issue #225/#230 で
  pending-only coordination へ収束... #30 時点の旧 semantics ...は
  supersede 済み」と明記）。
- **補助citation**: `docs/v2/decisions.md`「v2 実装で踏んではいけない地雷」
  3つ目の bullet（73 行目、opacity 境界の注意喚起）。
- **journey**: invitation。
- **確信度**: CLEAR。

### 6. Invitation の decline が「8 秒タイマーでの確定」から「確認ダイアログ + 即時 hard delete（undo 無し）」へ変わった

- **legacy**: 「参加しない」を押すと 8 秒の client-local `declining` phase を
  経て確定する。タイマー完了前に unmount が発火しない離脱（タブを閉じる等）を
  すると、削除されないまま invitation が `pending` に残り得る（実際の離脱時
  挙動は未検証というバグ）。
- **v2**: 確認ダイアログ（押し間違い対策）を経て、**即座に** invitation を
  hard delete して確定する。undo は実装しない（Issue #382 は undo 不実装で
  close 済み — invite の opacity 境界（要件 A/B/C）が同時に成立しないことが
  実装時に判明したため）。タブを閉じても確定するため、legacy のバグは
  構造的に再現しない。
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
- **確信度**: CLEAR。

---

## Event / Occurrence 管理・参加

### 7. Cancellation（中止）が Deletion（削除）から明確に分離され、Event-level / Occurrence-level 独立の cancellation state を持つ

- **legacy**: v1 時点では中止と削除の区別が product semantics として
  明確化されていなかった（Issue #123 以前）。
- **v2**: Event-level と Occurrence-level の cancellation state を
  `canceled_at`（nullable timestamptz）として独立に持ち、effective
  cancellation は OR 合成。Deletion は owner-only の hard delete として
  誤登録の除去に限定し、cancellation とは別の operation として提供する
  （`occurrence_participations`/`occurrence_invitations` が 1 件でも存在する
  Occurrence の削除は拒否する等）。
- **一次citation**: `AGENTS.md`「Cancellation」節・「Deletion」節
  （Issue #123 で semantics 決定、#124 で削除の scope 決定、#125 で実装）。
- **journey**: event 管理、participation。
- **確信度**: CLEAR。

---

## Personal schedule

### 8. Personal Schedule の固定カテゴリ enum が撤廃され、free-form `title` + 独立 `blocking` boolean へ再設計された

- **legacy**: schedule entry は `paid_leave`/`work`/`travel`/`other` という
  closed な種別 enum を持つ。
- **v2**: 固定カテゴリを廃止し、必須 free-form `title`（件名）を持たせる。
  各 entry は独立した `blocking` boolean を持ち（`true`=availability を
  block、`false`=表示のみ）、この値は共有先にも同じ semantics で伝播する
  （per-recipient override は無い）。
- **一次citation**: `AGENTS.md`「Event-independent personal schedule」節
  （Issue #121。「旧 `paid_leave`/`work`/`travel`/`other` の closed schedule
  type vocabulary を supersede」と明記）。
- **journey**: personal schedule。
- **確信度**: CLEAR。

---

## 検討したが inventory に含めなかったもの

以下は decisions.md / oracle docs で言及されているが、**観測可能な
behavioral difference ではない**ため本 inventory から除外した。並走比較中に
誤って「差分」として報告されないよう記録しておく。

- **通知ベル（P1）**: legacy・v2 とも非活性のまま UI に配置。挙動は同じ。
- **グローバルナビの 4 項目固定（P2）**: legacy・v2 とも `/schedule`・
  `/mypage` はナビ項目に含めない。挙動は同じ。
- **中止時の新規 `considering` 作成拒否**: `docs/v2/decisions.md`
  「PO 判断: 中止時の participation 新規作成（2026-09-07）」
  （235-260 行目）は、product-rules の文言と実際の DB trigger の食い違い
  （ドキュメント上の曖昧さ）を解消しただけで、コード変更は無い
  （「コード変更は不要」と明記）。legacy の実際の DB 挙動と v2 は同じ。
- **`--color-primary` 未定義参照という CSS bug**: `AGENTS.md`
  「UI primitive」関連の記載で v2 に引き継がないとされているが、これは
  純粋に visual な問題であり、上記 7 journey のいずれの機能挙動にも
  影響しない。cosmetic な差異として気づいた場合のみ記録すれば十分。

## まだ決めていない事項（差分ではなく、比較対象にもならない）

`AGENTS.md`「まだ決めていないもの」節に列挙されている事項
（Ticket の削除/訂正、Post-MVP の Event 作成権限拡大の verification
workflow、budget 集計期間、canonical venue identity の具体形、公演回ごとに
会場が異なる興行の扱い、Event range 自体が未公表の event の表現、PWA の
offline scope、Web Push の product scope、MCP product scope）は、legacy・v2
いずれにも実装が存在しないか、determination 自体が先送りされているため、
並走比較の対象にならない。
