# migration 自動適用と Preview 隔離のセットアップ（operator 作業）

Issue #387（v2 M7）の PO 判断 **D1 = D** に対応する、**この repository の
コードでは完結しない設定**。

> **PR #388（案 C）の手順書は破棄されました。** あちらが要求していた
> `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` と Production
> auto-deploy の停止は、**すべて不要**です。C は CI が Vercel CLI で deploy
> する案で、採用していません。

## 作業は 2 つだけ

| #   | 作業                                          | 場所   | 目的                                                    |
| --- | --------------------------------------------- | ------ | ------------------------------------------------------- |
| 1   | GitHub Environment に secret を **1 つ** 登録 | GitHub | **operator が手元で `supabase login` する手間を無くす** |
| 2   | Preview の環境変数を placeholder に差し替え   | Vercel | Preview を Production Supabase から隔離する             |

**Vercel の secret を GitHub へ登録する作業はありません。** Vercel の Git
auto-deploy はそのまま維持します。

## 実施状況（2026-09-09 時点）

**両方とも PO により実施済み。** この文書は、設定をやり直す場合と、
同じ構成を別環境へ再現する場合のための記録として残す。

| #   | 状態 | 備考                                                                                 |
| --- | ---- | ------------------------------------------------------------------------------------ |
| 1   | 完了 | `SUPABASE_DB_URL` を `production` environment の Environment secret として登録済み   |
| 2   | 完了 | Preview scope を placeholder へ差し替え済み。**値の形式で 1 度失敗している**（下記） |

手順 2 は最初 URL 形式でない値を入れたため `apps/web` の build が失敗した
（Issue #394）。**この文書の指定どおり `https://placeholder.invalid` の形に
すること。** 詳細は手順 2 の中に記載。

---

## 手順 1: GitHub Environment（migration の自動適用）

**Settings → Environments → New environment**、名前 `production`。

### Deployment branches

**Selected branches** に **`main` のみ**を指定する。

> environment に紐づく secret は、指定した branch で走る job からしか読めない。
> **この repository は agent が workflow ファイルを書く**ため、PR の branch から
> secret を読めないことが実質的な保護になる。

### Secret（1 つだけ）

**Environment secrets へ登録する。Environment variables ではない。**
同じ environment 画面に両方の欄があるが、variables は平文で保存され log にも
出るため、password を含むこの値を置いてはいけない。Repository secrets でもなく
Environment secrets である点も重要で、これによって上の Deployment branches の
制限が効く。

`Settings -> Environments -> production -> Environment secrets -> Add secret`

| 名前              | 取得元                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `SUPABASE_DB_URL` | Dashboard 右上の **Connect** ボタン → Connection String → **URI** |

> **取得場所は "Project Settings → Database" ではない。** Supabase の dashboard
> 改修により、接続文字列は画面右上の **Connect** ボタンから取得する
> （2026-09-08 時点。PO が実際に画面を見て判明）。

### どの接続文字列を選ぶか

**Session pooler を使う。**

| 種類               | port | migration 用途                                                                                       |
| ------------------ | ---- | ---------------------------------------------------------------------------------------------------- |
| Direct connection  | 5432 | **CI からは繋がらない可能性が高い**（新しい project は IPv6 のみ。GitHub Actions の runner は IPv4） |
| **Session pooler** | 5432 | **これを使う。** IPv4 対応で、session モードなので migration に必要な機能が使える                    |
| Transaction pooler | 6543 | migration には不適（session レベルの機能が使えない）                                                 |

手元の CLI から使うだけなら Direct でも動くが、**この secret の用途は CI からの
適用**なので Session pooler を選ぶ。

1. URI をコピーする
2. `[YOUR-PASSWORD]` を実際の DB password に置き換える
3. **記号を percent-encode する**（CLI が「must be percent-encoded」と要求する）

   **password を reset する場合は、英数字だけにするのが最も安全。**
   この手順が丸ごと不要になり、下記の事故も起こらない（強度は長さで確保する）。
   password は作成時にしか表示されず後から取得できないため、この secret を
   用意する時点で reset することになる。その reset で英数字だけを選べばよい。

   記号を含む既存 password を使う場合のみ、次で変換する。

   ```sh
   node -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf8").replace(/\r?\n$/,""))+"\n")'
   ```

   実行してから password を入力し、Enter のあと `Ctrl-D`（Windows の
   `cmd`/PowerShell では `Ctrl-Z` → Enter）で終了する。

   > **password を command line に書かないこと。** `node -e "...('パスワード')"`
   > の形にすると、(1) 本番 DB の password が shell history に平文で残り、
   > (2) 二重引用符の中で `$HOME` や `` `...` ``、`$(...)` が **shell に展開・実行**
   > され、(3) `'` を含む値は JavaScript の文字列リテラルを壊す。
   > 上の形なら値は stdin から読むだけなので、shell も JavaScript も解釈しない。

   `encodeURIComponent` は必須の文字をすべて変換し、userinfo で許される記号
   （`! ~ * ' ( ) - _ .`）はそのまま残すので、この用途にちょうど合う。

   必須の文字（参考）:

   | 文字    | 変換後      | 理由                                        |
   | ------- | ----------- | ------------------------------------------- |
   | `%`     | `%25`       | **エスケープの開始と誤読される。** 最も危険 |
   | `@`     | `%40`       | userinfo の終端                             |
   | `:`     | `%3A`       | user と password の区切り                   |
   | `/`     | `%2F`       | path の開始                                 |
   | `?`     | `%3F`       | query の開始                                |
   | `#`     | `%23`       | fragment の開始                             |
   | `[` `]` | `%5B` `%5D` | IPv6 ホスト表記の予約文字                   |

   **エンコード漏れはエラーにならず「認証失敗」としてだけ現れる**ので原因が
   分かりにくい。

> **Supabase の Personal Access Token は使わない。** access token には
> **scope 設定が無く、アカウント配下の全 project を操作できる**。
> `--db-url` なら到達範囲がその 1 データベースに限られる。

> **service-role key も置かない。** migration の適用に必要なのはこの接続文字列
> だけ。

### これで何が変わるか

`main` へ merge された migration が自動で Production へ適用される
（`.github/workflows/apply-migrations.yml`）。**operator が手元で
`supabase login` / `supabase link` / `db push` を実行する必要が無くなる。**

**deploy には一切関与しない。** Vercel の auto-deploy はそのまま。
`Verify / Artifact Sequencing Fence` が migration と app code の同居を拒否
しているため、適用と deploy の順序を合わせる必要が無い。

### 設定前の状態

secret が未登録の間、この workflow は notice を出して skip する。**未設定を
失敗にしていない** —— 赤い CI を常態化させると本当の失敗が埋もれるため。
設定が入った時点で自動的に本来の動作になる。

したがって**この手順を後回しにしても Production には影響しない**。その間は
従来どおり operator が手元で適用する。

---

## 手順 2: Vercel Preview の環境変数

**Vercel → stage-tracker → Settings → Environment Variables**

**Preview scope のみ**差し替える（**Production scope は触らない**）。

| 変数                            | Production                | Preview                              |
| ------------------------------- | ------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | 実 URL（変更しない）      | `https://placeholder.invalid`        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 実 anon key（変更しない） | `preview-placeholder-not-a-real-key` |

### **URL の形を満たさないとビルドが落ちる**（実際に落とした）

`apps/web/src/env.ts` が `NEXT_PUBLIC_SUPABASE_URL: z.url()` を要求する。
`placeholder` のような**裸の文字列や空文字では build が失敗する**
（`emptyStringAsUndefined: true` のため空文字も undefined 扱いになる）。

```text
NEXT_PUBLIC_SUPABASE_URL=placeholder
  -> exit=1  ❌ Invalid environment variables: message: 'Invalid URL'

NEXT_PUBLIC_SUPABASE_URL=https://placeholder.invalid
  -> exit=0
```

`.invalid` は RFC 2606 の予約 TLD で、名前解決が必ず失敗する。**build は通り、
接続は必ず失敗し、Production Supabase へは到達しない。**

**この失敗は気付きにくい。** `apps/web` が実際に再ビルドされたときだけ表面化する
ため、`apps/web` を変更しない PR では Preview が success のままになる
（Issue #394。PR #392 で実際に 2 revision 落として、`Verify /*` が全部 green
だったため merge まで気付かなかった）。

### merge 前に Vercel の commit status も見ること

`Verify /*` の green は deploy の健全性を意味しない。merge-ready fence も
外部 status を見ない。

```sh
gh api repos/reitojike/stage-tracker/commits/<sha>/status --jq '.state'
```

### 壊れないことを実測済み

到達不能な Supabase URL でビルド・起動して確認した（2026-09-08）。
**現在 Preview がビルドしているのは legacy 側**なので、両方を確認してある。

| 経路                                 | legacy               | v2                   |
| ------------------------------------ | -------------------- | -------------------- |
| `/` `/calendar` `/catalog` `/mypage` | **307 → `/sign-in`** | **307 → `/sign-in`** |
| `/sign-in`                           | 200                  | 200                  |
| `/auth/confirm?token_hash=...`       | —                    | 307 → `link_expired` |
| ビルド                               | 成功                 | 成功                 |
| サーバのエラーログ                   | なし                 | なし                 |

**どちらも 500 にならず default-deny に倒れる。** Supabase client が
ネットワーク失敗を握って `user: null` を返すため。`env.ts` の変更も不要
（`z.url()` と非空文字列を満たす）。

### 確認

- [ ] Preview deployment で `/sign-in` が表示される
- [ ] Preview deployment で他のパスが `/sign-in` へリダイレクトされる
- [ ] **Production は従来どおり動く**（Preview scope しか変えていないこと）

---

## 元に戻す場合

- 手順 1: `production` environment の secret を削除する。workflow は notice を
  出して skip に戻り、適用は手元の作業に戻る
- 手順 2: Preview scope の値を Production と同じに戻す

## この手順に含まれないもの

- **cutover**（Vercel Root Directory を `apps/web` へ切り替える）。**PO 承認が
  必要**で、Preview 隔離が成立してから行う
- `apps/web` の実 Vercel Preview smoke（M8 / cutover preflight）
