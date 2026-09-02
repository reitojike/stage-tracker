# マイページとお知らせを新設する

**labels**: screen, new
**depends on**: #5 appbar

## やること

### マイページ（`/mypage`）

参照: `screens/10f-mypage.png`、設計HTMLの id `10f`

- AppBar 右のアバターから開く二次画面。**bottom nav の項目にはしない**
- ホームから移設: アカウント（サインイン中のメール、サインアウト）、Passkey（説明、登録済み端末、登録、削除）
- 文言と操作は `HomeAccount.tsx` / `PasskeySection.tsx` / `DeletePasskeyForm.tsx` / `RegisterPasskeyButton.tsx` の現行実装を踏襲する
- セクションは 太罫見出し（15px/600）+ 本文。カード面は使わない

### お知らせ（`/notifications`）

参照: `screens/10g-notifications.png`、設計HTMLの id `10g`

- AppBar 左のベルから開く。**bottom nav の項目にはしない**
- 行: 未読は先頭に 藍の点 + 日時を藍 + 本文を `--color-text`。既読は点なし、日時 `--color-text-secondary`、本文の濃度を1段下げる
- **面の塗り分けはしない**（既読/未読は点と文字色だけ）
- プッシュ通知は必須にしない。この画面がメイン動線とは別の追いつき手段になる

## 完了条件

- どちらも bottom nav に現れない
- 未読の点が藍で、赤を使っていない
