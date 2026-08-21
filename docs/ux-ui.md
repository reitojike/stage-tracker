# stage-tracker UX/UI baseline

このdocumentは、stage-trackerの screen / feature 横断で適用する **global
UX/UI ruleのcanonical source** です。個別feature screenのvisual / interaction
detailはここに置きません。

## Canonical ownership

- global UX/UI principle・responsive baseline・visual foundation・design
  token semantics・shared UI patternのnormativeなruleは、本ファイルのみを
  正本とします。`docs/prd.md` / `docs/roadmap.md` /
  `.ai-dev-foundation/product-rules.md` へ同じruleの別正本を作りません。
- product domain semantics（event / participation / ticket / expense等）の
  正本は引き続き `.ai-dev-foundation/product-rules.md` です。本ファイルは
  domain semanticsを固定しません。
- component catalog（Storybook）はこのruleの **rendered examples / states
  catalog** であり、rule自体の正本にはしません。ruleと実装が食い違う場合は
  本ファイルを正とします。

## Origin

ここに記載するglobal decisionは、Issue #10 Phase 1のPO checkpoint
（[#10 checkpoint comment](https://github.com/reitojike/stage-tracker/issues/10)、
2026-08-21、承認時点のmain: `2036cc12ae9c2f30382d9762fc2104b9fe1cf9aa`）で
承認された範囲に限ります。checkpointで **intentionally unresolved** と
された項目（下記「本ドキュメントで固定しないもの」参照）は、実装都合で
本ファイルに先行して書き込みません。

## Platform priority

stage-trackerは **smartphone-first** です。desktopはsecondary information /
density / wider list / supplemental controlsに追加spaceを使ってよいですが、
mobile experienceをdesktop版の縮小版にはしません。

## Product personality

Native-feeling / calmな mobile organizerとします。iOS / Android標準のUI
conventionから大きく逸脱しません。派手なmotion / glass effect /
oversized cardsをglobal defaultにしません。特定OS専用のUIではなく、
cross-platformでnative-feelingな体験を狙います。

## Primary interaction pattern

Primary time granularityはday-levelです。month viewをprimary viewとし、
hourly timeline / week schedulerをglobal centerにしません。

以下のpatternをglobalなprimary interaction patternとします。

```text
month calendar → selected-day list → event detail
```

このpatternは次の3つのcontextで共通利用します。ただし各contextの domain
semantics（query / empty state / actions）は分離し、shared catalogと
personal participationを同一semanticとして混在させません。

1. **Event Catalog** — authenticated users間のshared catalogを見る / 探す
2. **Favorites / Followed** — follow対象に関連するeventを見逃さず把握する
   （shared catalogのpersonalized view）
3. **My Calendar** — 自分がparticipation登録したoccurrenceと、
   event-independentなpersonal schedule entry（`paid_leave` / `work` /
   `travel` / `other`等）を合わせた自分のpersonal schedule

## Navigation principle

Catalog / Followed catalog / Personal scheduleの間をmobileで自然に移動
できるIA（情報設計）とします。bottom navigationを第一候補としますが、
正確なnav labels / 項目数 / Searchの独立tab化 / Settings配置 / future
feature navはこのdocumentで固定しません（「本ドキュメントで固定しない
もの」参照）。

## Information density

mobileはmedium、desktopはmedium-highまで許容します。giant cardで
viewportを使い切る構成は避け、calendarとevent listのscanabilityを
優先します。month calendarのdate cellは装飾よりinformation recognitionを
優先します。

## Typography

System / native UI sans系フォントを使います。日本語可読性を優先し、
restrained heading hierarchyとします。Giant marketing typographyは
使わず、UI fontのためだけにwebfont dependencyを増やしません。

exact font stackはPhase 2（本materialization）で次の通り決定します。

```css
--font-family-base:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans',
  Meiryo, system-ui, sans-serif;
```

各OSのnative UI fontを優先し、日本語UI fontへ確実にfallbackするsystem
font stackです。追加のwebfontは導入しません。

## Spacing / surface / radius

- **Spacing** — 4px-based scale（token化: 後述の「Design tokens」参照）。
- **Surface** — border / subtle tonal background中心とし、shadowを乱用
  しません。
- **Radius** — controlはmoderate、larger surfaceも過度にroundにしません。
- **Pill形状**（fully-rounded）はsemantic reasonがある場合のみ使います
  （例: badge / statusの慣用表現）。汎用surfaceのdefault形状にはしません。

## Color

Neutral base + single restrained cool accentのlow-noise UIとします。
success / warning / danger / infoはsemantic roleを分け、statusをcolor
だけで表現しません（アイコン / textラベル等を併用します）。

exact accent hueはPhase 1 checkpointでintentionally unresolvedのため、
本ファイルで最終値として固定しません。「Design tokens」節のtoken値は
placeholderです。

## Design tokens

CSS custom propertiesを使い、**primitive → semantic** の2層構成とします。

- **primitive layer** — 生の値（color scale, spacing scale, radius scale
  等）。他のtokenやcomponentから直接参照しません。
- **semantic layer** — primitiveを参照し、role（`--color-surface` /
  `--color-text` / `--color-accent` / `--space-md` 等）を表現します。
  componentは常にsemantic tokenを参照し、primitiveを直接参照しません。

必要なsemantic roleだけを先に作り、未使用のroleを先行して作りません。

Dark modeは、token構成としては対応可能なarchitecture（semantic tokenの
値を切り替えるだけで成立する構成）にしますが、dark mode UI自体は今回
実装しません。

### Placeholder値の扱い

以下のtoken値のうち、**accent色のexact hueと、spacing/radius以外の
細かい数値**はPhase 1 checkpointで凍結されていないplaceholderです。
将来の変更は該当primitive tokenの値を差し替えるだけで完結する設計とし、
component側のhard-codeやtoken参照の再設計を必要としません。

- **Spacing scale**は「4px-based」という決定自体はPhase 1で凍結済みの
  ため、4の倍数のscaleとして本ファイルでも確定します。
- **Accent hueの具体的な色**、typography size scaleの具体的なpx値、
  radius scaleの具体的なpx値はplaceholderです。

実装は `src/ui/tokens.css` を正本とし、本ファイルはtoken layerの構成
方針のみを記述します（具体値の重複記載はしません）。

## Calendar weekday / Japanese holiday presentation

month calendar全体に適用するglobal presentation ruleです。個別feature
screenのcalendar marker semantics（date dot / run period band等）とは
別concernとして扱います。

- Saturdayはblue roleで表示します。
- Sundayはred roleで表示します。
- 日本の祝日（国民の祝日・休日）はred roleで表示します。
- SaturdayとJapanese holidayが重なる場合は、holiday presentationを
  優先します。
- accessibility baselineどおり、色だけを唯一の意味表現にしません。

Holiday dataのauthorityは内閣府「国民の祝日について」掲載データ / CSV
です（[https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)）。
公式に公表されていない将来年の祝日を推測し、確定扱いにしません。祝日
データの取得・snapshot・update方法はimplementation Taskで決定します。

product上の日付境界（`Asia/Tokyo`）は
[`.ai-dev-foundation/product-rules.md`](../.ai-dev-foundation/product-rules.md)
を正本とし、本節では重複記載しません。

## Shared / feature-local component boundary

Visual / interaction semanticsがdomain-independentで実際に再利用される
ものだけをshared化します。

- **shared**（`src/ui/`） — Button / Text input / generic Surface /
  generic Badge / generic loading・empty・error・disabled/unavailable
  presentation等。
- **feature-local** — EventCard / calendar event marker /
  ParticipationStatus / FavoriteTargetSelector / domain-specific filters・
  detail blocks等。これらはfeatureごとのbounded taskで実装します。

未来のfeature componentを大量に先行実装しません。複数画面で再利用する
可能性が高く、global baselineとして意味のある最小setのみを対象とします。

## Common states

loading / empty / error / disabled / unavailableのglobal visual pattern
を持ちます。ただしfeature/domain層がmeaning / messageを所有し、shared層は
presentation primitiveのみを提供します。

- empty result（該当データなし）
- auth failure（認証エラー）
- permission denial（権限拒否）
- data load failure（読み込み失敗）
- unavailable（機能未提供・準備中）

これらを同一の「何もありません」表示にしません。RLS等のsilent failure
をempty UIとして誤表示する設計を避けます。shared componentは
`variant`（`empty` / `error` / `unavailable`等）とmessage/actionを呼び出し
側から渡せるAPIとし、意味の判定自体はfeature/domain層に残します。

## Accessibility baseline

WCAG 2.2 AA相当を baselineとします。

- semantic HTML
- keyboard access
- visible focus
- sufficient contrast
- zoom・reflow対応
- reduced motion（`prefers-reduced-motion`を尊重し、motionをglobal
  defaultで多用しない）
- 色のみに意味を依存しない
- sufficiently large touch target
- 片手利用しやすいinteraction

Storybookのa11y addon等はQA aidとして使いますが、compliance自体の証明
とはしません。

## Component catalog

Storybookを採用します。

- 責務分離: 本ファイル（`docs/ux-ui.md`）= global UX/UI ruleのcanonical
  source、tokens / shared components = implementation、Storybook =
  rendered examples / states catalog。Storybookをdesign ruleの正本には
  しません。
- Next.js 16.3.1 / React 19.2.8に対応する`@storybook/nextjs-vite`
  framework adapterを使用します（導入時点でのcompatibility確認は
  npm registry上のpeer dependency範囲で行いました: `next: ^14.1.0 ||
^15.0.0 || ^16.0.0`, `react: ^16.8.0..^19.0.0`）。
- app production runtimeへ不要なcouplingを持ち込みません
  （`.storybook/**`はapp buildの対象外）。
- local起動用のnpm script、static build検証を用意します。

## 本ドキュメントで固定しないもの

Phase 1 checkpointでintentionally unresolvedとされた次の項目は、実装
都合で本ファイルへ先行して書き込みません。それぞれ関連するproduct
task / 追加のPO checkpointで確定します。

- feature-specific calendar marker semantics（date dot / run period band /
  occurrence marker / 同日複数公演の件数表示 / overlapping runsのstack /
  `+N` collapsing / rest day表示）
- event / occurrence persistence shape、run-period persistence、
  rest-day persistence
- participation / invitation / personal schedule / ticket acquisition /
  ticket のpersistence shape・table naming（status modelそのものの正本は
  `.ai-dev-foundation/product-rules.md`）
- ticket acquisition とparticipationのpersistence関係、budget集計の
  期間基準
- favorite / follow persistence schema、classification taxonomyの具体形
  （classificationのdata boundary自体は
  `.ai-dev-foundation/product-rules.md`で承認済み）、category
  cardinality、saved filter preference
- 正確なnav labels / bottom nav項目数 / Search tab化 / Settings
  placement
- exact accent hue（「Design tokens」節のplaceholder扱いを参照）
- event deletion semantics
- auth provider、production hosting、PWA scope、MCP scope、broader
  rollout
