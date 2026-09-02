# 16. 個人予定のリスト画面を廃止する

## 背景

`/schedule`（個人の予定 一覧）は、マイカレンダーが月の予定一覧を持つ前に作られた画面。17a で日付未選択時に月ぶん全部を日付見出しで出すようになったため、この画面が単独で担っていた「自分の予定をまとめて見る」は、マイカレンダー側で満たされている。

残る差は2点だけで、どちらも代替がある。

| `/schedule` にしかないもの | 代替 |
| --- | --- |
| 月に縛られない全件表示 | マイカレンダーの月送り。`/schedule` 側にも検索・絞り込みは無いため、実質的な機能差にならない |
| イベントを混ぜず個人予定だけ見る | マイカレンダーは両方を同じ列に出す。この区別を必要とする要求は出ていない |

いっぽう `/schedule/[entryId]`（詳細）は**残す**。共有相手の追加・解除はこの画面にしかなく、マイカレンダーの行から到達する先でもある。

参照: 17a、18e（廃止）、18f（戻り先が変わる）

## 変更

### 消すもの

- `src/app/schedule/page.tsx` — リスト画面
- `src/app/schedule/_components/ScheduleList.module.css`
- マイページ「予定とイベント」の1行目「個人予定を管理」（`src/app/mypage/_components/ScheduleAndEventSection.tsx`）。残る行は「招待一覧」と「イベントを追加」の2つで、後者はカタログ登録者だけに出る現在の条件をそのまま維持する

### 付け替えるもの

| 場所 | 現在 | 変更後 |
| --- | --- | --- |
| `/schedule/[entryId]` の `BackLink` | 個人の予定に戻る → `/schedule` | マイカレンダーに戻る → `/calendar` |
| `/schedule/[entryId]/edit` の `BackLink` | 予定に戻る → `/schedule/{id}` | 変更なし（詳細に戻る） |
| `/schedule/new` の `BackLink` | 個人の予定に戻る → `/schedule` | マイカレンダーに戻る → `/calendar` |
| 各 write action の `redirect` 先 | `/schedule` | `/calendar` |

`/schedule` へのリクエストは `/calendar` へリダイレクトする（ブックマークと、既存の共有リンクの経路を切らないため）。

### 触らないもの

- `/schedule/[entryId]` と `/schedule/[entryId]/edit` の中身。URL も変えない
- `/schedule/new` の中身。マイカレンダーの選択日から `?date=` で入る導線（#196）はそのまま
- `listVisiblePersonalSchedule`。マイカレンダーの月アジェンダが同じ読み取りを使っている場合はそのまま残す

## 確認

- マイページの「予定とイベント」が2行になり、カタログ登録者でないユーザーには「招待一覧」1行だけが出る
- マイカレンダーの予定行から詳細へ入り、戻ると `/calendar` の同じ月に戻る
- 予定を作成・更新・削除したあと `/calendar` に着地する
- 共有された予定も、マイカレンダーの月一覧に出て詳細まで到達できる（`/schedule` を経由しない）
- `/schedule` を直接開くと `/calendar` へ飛ぶ
