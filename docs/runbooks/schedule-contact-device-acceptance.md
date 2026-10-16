# 共有予定の実機復帰確認（#825）

これは P3 有効化前の最小の手動確認手順であり、実施済み証跡ではない。
Spec 010 の Android / iOS standalone surface でも、Spec 012 の PSH-020 が適用される。
Playwright の mobile emulation、合成 focus/blur、通信要求の abort は実機確認の代替ではない。
offline 機能、Service Worker、Push、全端末の網羅試験を追加する手順ではない。

## 対象と準備

- 実際に利用する OS / browser の home-screen standalone と、履歴の進む操作ができる通常 browser。
- 事前登録済みの actor A / B。A は別端末または独立した browser context を使う。
- A から B へ既に明示共有されている、非機微なテスト予定 1 件と、B 本人の予定 1 件。
- 実行日時、OS / browser version、standalone の別、配備 SHA、各観測結果を非公開証跡へ記録する。
  メール、本人 ID、予定内容を公開 Issue / PR へ貼らない。

gate=false でも既存共有の read、owner 個別解除、recipient 自己離脱は利用できる。
新規登録・共有は停止しているため、適切な既存 fixture がなければここで HOLD。
旧 email RPC、gate override、本番 admin INSERT で fixture を準備しない。
代わりに、別途承認した端末到達可能な専用 QA 環境を用意するか、対象を限定した
fixture 準備を別途承認する。public signup や第三者への公開は必要ない。

共有の解除は実データ変更である。対象予定と対象相手を限定した明示承認を得るまでは、
次の手順の表示・背景化確認だけで停止する。本手順の追加自体は解除を許可しない。

## 最小の実施手順

1. B の通常 browser と standalone の両方で、共有 detail、Home、Calendar を事前に表示する。
   通常 browser では detail と一覧を往復して履歴を作る。standalone は共有を表示して背景へ移す。
2. A が承認されたテスト予定の B 向け share だけを解除する。予定本体は残す。
   相手登録の解除、他の共有の解除、テスト後の自動再共有はしない。
3. B の通常 browser で実際の「戻る」「進む」、別タブからの復帰を行う。
   共有の新しい読取が完了する前に古い title / memo が見えず、完了後も見えないことを確認する。
   detail は非表示 / 不存在と同じ表示となり、Home / Calendar の帯・件数・ラベルにも残らないこと。
4. B の standalone を復帰する。別の事前表示 context では端末の通信を切って復帰し、
   通信失敗時も古い共有が表示されず、通信復帰・再試行後も非表示であることを確認する。
   通信失敗で app 全体が offline 利用できることは要求しない。
5. B 本人の予定が維持されることを確認する。本人予定の編集画面で保存せず title を変更し、
   画面遷移せず背景化・復帰した場合に未保存入力が維持されることも確認する。

standalone に「進む」UI がない場合は操作を作り足さず、通常 browser の実履歴と
standalone の実背景復帰を別々に記録する。既に見た内容、保存画像、OS app switcher の
thumbnail を遠隔消去できるとは主張しない。画面が前面のままの別端末への即時配信も対象外。

古い共有が一瞬でも application 内へ再表示された場合は HOLD とし、経路と配備 SHA を記録する。
成功するまで操作を繰り返して結果を上書きしない。fixture の復元や予定削除は別の承認なしに行わない。

## P3 / P4 への引継ぎ

実機確認は cache / lifecycle の意味上の AC の証跡であり、新しい CI gate や端末台数の定足数ではない。
実施した platform と未確認 platform を区別して報告する。
登録・承認・双方向 unlink・再登録の有効時 DB / UI 検証は、別の専用 local QA と E2E が担う。
gate=false でこの確認を行っただけでは登録機能の有効時検証が完了したことにはならない。

P3 は旧 email 作成経路の閉鎖と登録 gate の切替まで。legacy share の可視性を維持する。
P4 の既存共有 bind / read 強制は、利用者の相互承認と直前・transaction 内 preflight を経る別段階である。
