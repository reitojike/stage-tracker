# Issue #431 — 表示項目 parity / information density evidence

取得日: 2026-09-12 JST

この資料は、同じ local Supabase fixture と同じ authenticated user を legacy (`apps/legacy-web`) と v2 (`apps/web`) から参照した比較記録である。比較 viewport は mobile 390×844 と bounded desktop 900×900。fixture は Event 2件、公演回3件、参加状態2件、個人予定1件、TicketOpportunity 2件、pending Invitation 1件を含む。

## Item-level inventory

`欠落` は source-backed field が画面に無かった差、`format/hierarchy` は値はあるが識別・順序・表示形式が後退していた差、`density-only` は field 集合に差がない presentation 差、`v2 improvement` は維持する意図的改善を表す。

| Surface                     | legacy visible fields / composition                                                                                  | fix前 v2との差分分類                                                     | 実装後の intended result                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` 申し込み期限            | relative deadline、Event title、Opportunity name、milestone date/time                                                | Event title・relative cueが`欠落`。縦積みは`format/hierarchy`            | Event title、Opportunity、deadline cue、personal stateを150px相当の横スクロール列へ配置。次項目のpeekとscroll snapを維持する例外的な横方向summary surface                  |
| `/` 直近の予定              | occurrence: date/start-end/title/venue/participation/cancellation。schedule: owner/shared、blocking、title、temporal | end/venue/status/cancellation、schedule metadataが`欠落`                 | source-backed fieldを復元し、同じcompact row + hairline vocabularyで表示                                                                                                   |
| `/catalog`                  | title「イベント」、見出し右filter icon、月calendar、選択日のtime/title/venue/classification                          | title/trigger/Sheet/月移動は`format/hierarchy`。独立cardは`density-only` | titleを「イベント」に統一。lucide filter + applied dot、適用時summary、Base UI selectionを持つbottom Sheet。行はhairline。classification badgeは`v2 improvement`として維持 |
| `/catalog/events/[eventId]` | title、venue、source URL、memo、occurrence count、focused cue、日時、参加操作                                        | URL/memo/count/focus cueが`欠落`                                         | 全fieldを復元。操作を同じ行にまとめる。doors/end明示とSheet操作は`v2 improvement`として維持                                                                                |
| `/catalog/invitations`      | back navigation、pending count、Event title、日本語date/start-end、cancellation、actions                             | back/end/localized hierarchyが`欠落`または`format/hierarchy`             | back linkとcount headerを復元し、localized full temporalを表示。decline confirmationは`v2 improvement`として維持                                                           |
| `/tickets`                  | milestone/date-time/deadline cue/state、Event title/venue、Opportunity、target scope、official source、actions       | Event/venue/deadline/target/sourceが`欠落`                               | shared/personal/temporal contextを同じcompact row内で階層化。row navigationとactionsはnested interactive elementにせずoverlay link + sibling actionsで分離                 |
| `/calendar`                 | month calendar、selected date、start-end/title/venue/status、schedule metadata、add action                           | selected-date headingが`欠落`、card surfaceは`density-only`              | selected dateと全fieldを復元。occurrence/scheduleをcompact rowへ統一。Event range band・独立read degradationは`v2 improvement`として維持                                   |
| `/mypage`                   | Invitation navigation/count、account、sign-out、Passkey説明/操作/登録状態                                            | field差なし。spacing/list surfaceが`density-only`                        | navigationを共通compact rowへ統一し、account/Passkey section hierarchyを維持                                                                                               |
| `/schedule/[entryId]`       | back、owner/shared、non-blocking、entry title H1、full-year temporal、memo、edit/share/delete影響                    | title/owner cue/full-year/delete影響が`欠落`または`format/hierarchy`     | entry titleをH1、editをtitle action、full-year temporalと削除影響を復元。blocking factとconfirm Sheetは維持                                                                |

## Shared presentation decisions

- Home / Catalog / Calendar / Tickets / My Page の反復項目は、独立した白面cardではなく、共通 `CompactList` / `ListRow*` のhairline separatorとbounded vertical spacingを使う。
- navigation rowはtrailing chevronを共通化する。row内に操作がある場合は、row overlay linkとsibling actionに分離し、interactive elementを入れ子にしない。
- `StatePanel` はtransparent surface + hairline、`AppBar` はcanvas background + bottom hairline、AppShell contentは`p-md`へ揃える。
- Button / BackLinkは見かけの密度を保ちながら、透明pseudo targetまたは`size-11`で44px target floorを確保する。
- Catalog filterはshadcn-style/Base UI `Sheet`、Base UI `RadioGroup` / `Checkbox`、lucide iconを使用する。独自modal・独自selection widgetは作らない。
- Catalog / Calendarの月移動は共通 `MonthNavigation` が押されたLinkだけを`useLinkStatus`のspinnerへ置換する。route-level fallbackは移動先月の5/6週grid geometryを保つ。

## Visual comparison

| Surface              | 390px legacy / v2                                                               | 900px legacy / v2                                                                 |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Home                 | [legacy](legacy-mobile-home.png) / [v2](v2-mobile-home.png)                     | [legacy](legacy-desktop-home.png) / [v2](v2-desktop-home.png)                     |
| Catalog              | [legacy](legacy-mobile-catalog.png) / [v2](v2-mobile-catalog.png)               | [legacy](legacy-desktop-catalog.png) / [v2](v2-desktop-catalog.png)               |
| Catalog Filter Sheet | [legacy](legacy-mobile-catalog-filter.png) / [v2](v2-mobile-catalog-filter.png) | [legacy](legacy-desktop-catalog-filter.png) / [v2](v2-desktop-catalog-filter.png) |
| Event detail         | [legacy](legacy-mobile-event.png) / [v2](v2-mobile-event.png)                   | [legacy](legacy-desktop-event.png) / [v2](v2-desktop-event.png)                   |
| Invitation           | [legacy](legacy-mobile-invitations.png) / [v2](v2-mobile-invitations.png)       | [legacy](legacy-desktop-invitations.png) / [v2](v2-desktop-invitations.png)       |
| Tickets              | [legacy](legacy-mobile-tickets.png) / [v2](v2-mobile-tickets.png)               | [legacy](legacy-desktop-tickets.png) / [v2](v2-desktop-tickets.png)               |
| Calendar             | [legacy](legacy-mobile-calendar.png) / [v2](v2-mobile-calendar.png)             | [legacy](legacy-desktop-calendar.png) / [v2](v2-desktop-calendar.png)             |
| My Page              | [legacy](legacy-mobile-mypage.png) / [v2](v2-mobile-mypage.png)                 | [legacy](legacy-desktop-mypage.png) / [v2](v2-desktop-mypage.png)                 |
| Schedule detail      | [legacy](legacy-mobile-schedule.png) / [v2](v2-mobile-schedule.png)             | [legacy](legacy-desktop-schedule.png) / [v2](v2-desktop-schedule.png)             |

The screenshots are comparison evidence, not golden pixel snapshots. Correctness remains bound to source-backed field inventory, semantic component tests, accessibility behavior, and end-to-end journeys.
