# 13. マイページ

参照: **12f**

前提: #1〜#3

## 背景

イベントとマイカレンダーは情報密度が要る画面なのに、利用頻度の低い「+ 追加」「招待一覧」「個人予定を管理」が縦幅を取っている。マイページに集約する。

## 変更

`src/app/mypage/page.tsx`

アカウントの**上**に新しいセクション「予定とイベント」を追加。太罫2pxの見出しは既存の `sectionHeading.module.css` を使う。

| 行 | 遷移先 | 条件 |
| --- | --- | --- |
| 個人予定を管理 | `/schedule` | 常時 |
| 招待一覧 | `/catalog/invitations` | 常時 |
| イベントを追加 | `/catalog/new` | `isDesignatedCatalogCreator` が真のときだけ行ごと出す |

- 行は高さ 44px 以上、右端に `›`、行間に細罫
- **「カタログ登録者のみ」のような副題は付けない**。権限が無い人には行そのものが出ないので、副題は出る人を混乱させるだけ

### 呼び出し元

- `src/app/catalog/page.tsx` から `ActionRow` と2つの `LinkButton` を削除（#10）
- `src/app/calendar/page.tsx` から `ActionRow` を削除（#11）
- `resolveCanCreateEvent` の判定はマイページ側に移す。catalog 側では不要になる

### ボタン

サインアウト / Passkey登録 は #1 で細罫だけの箱になる。

## 確認

- 12f と突き合わせる
- カタログ登録者でないアカウントで「イベントを追加」の行が出ない
