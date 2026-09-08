# v2 release pipeline セットアップ（operator 作業）

Issue #387（v2 M7）の PO 判断 D1 = **案 C（GitHub Actions が migration と
deploy の両方を持つ）** を実施するための、**この repository のコードでは
完結しない設定手順**。

> **なぜ手順書が要るか**: Vercel dashboard と GitHub の設定は repository の
> ファイルから再現できない。ここに書いていない設定は、次に環境を作り直す人が
> 再現できない。

## 背景: 何を解決するのか

現状は 2 系統が並行し、**順序が人間の記憶に依存**している。

```
main merge ─┬→ Vercel が push を検知して Production auto-deploy
            └→ GitHub Actions は Verify のみ（deploy に関与しない）

Supabase migration → operator が手動 apply
```

Issue #121 / #124 / #125 は、`schema-first-required` という判断自体は
正しく認識されていたのに、**3 件連続で Production migration の適用が
Vercel デプロイより後回しになった**。human memory に依存した手順は
recurring failure になる、という実績がある。

案 C では、merge 後の一本の workflow が `migration → drift 確認 → deploy`
を順に実行する。順序が機械で保証される。

## PO 判断の記録

- **D1 = C**。Supabase の認証情報は GitHub の secret として管理され、
  agent へ渡されるわけではない。ordering の人間依存を残す案 A / B より、
  最初から C でよい（PO 判断、2026-09-08）
- 詳細と代替案の比較は `docs/v2/decisions.md` を参照

## 設定前の状態について

**この手順を実施するまで、Release workflow は何もしない。** secret が
未登録の間は「未設定」と notice を出して skip する。設定が入った時点で
自動的に本来の動作になる。

未設定を失敗にしていないのは、**赤い CI を常態化させると本当の失敗が
埋もれる**ため。`main` への push ごとに赤が出る状態は、数日で誰も
見なくなる。

したがって手順の途中で止まっても Production には影響しない。ただし
**手順 2-1（Vercel の auto-deploy 停止）だけを先に実施すると deploy が
止まる**ので、手順 1 → 2 → 3 の順で通しで実施すること。

## 手順 1: GitHub Environment を作る

**Settings → Environments → New environment**、名前 `production`。

### Deployment branches

**Selected branches** に `main` のみを指定する。

> これが最も重要な制限。environment に紐づく secret は、指定した branch で
> 走る job からしか読めない。PR の branch から読めないため、**PR で workflow
> を書き換えても secret は取れない**。この repository は agent が workflow
> ファイルを書くため、この制限が実質的な保護になる。

### Secrets

| 名前                    | 用途                      | 取得元                                            |
| ----------------------- | ------------------------- | ------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI の認証       | Supabase Dashboard → Account → Access Tokens      |
| `SUPABASE_PROJECT_REF`  | 対象 project の識別       | Dashboard の URL、または `supabase projects list` |
| `SUPABASE_DB_PASSWORD`  | `supabase db push` の接続 | project 作成時に設定した DB password              |
| `VERCEL_TOKEN`          | Vercel CLI の認証         | Vercel → Account Settings → Tokens                |
| `VERCEL_ORG_ID`         | deploy 先の識別           | `vercel link` 後の `.vercel/project.json`         |
| `VERCEL_PROJECT_ID`     | deploy 先の識別           | 同上                                              |

> **6 つすべてが揃うまで Release workflow は no-op**（notice を出して skip）。
> 途中で止めても Production には影響しない。

> **service-role key は置かない。** migration の適用に必要なのは上記だけで、
> service-role key は別物（application runtime も持たない方針）。

## 手順 2: Git による自動 deploy を止める

**なぜ止めるのか**: 止めないと、workflow が migration を適用している最中に
Vercel が先に新しい build を deploy してしまい、migration と deploy が
race する。

### 使う手段: `git.deploymentEnabled`

**Ignored Build Step は使わない。** Ignored Build Step は `exit 0` で build を
中止する仕組みで、**Git 由来かどうかを区別しない**。`VERCEL_ENV=production`
で一律 `exit 0` にすると、release workflow が CLI から起動した Production
deploy まで中止される（PR #388 review）。

止めたいのは **Git commit による自動 deploy だけ**で、CLI 経由の controlled
release path は生かす必要がある。これを表すのが `git.deploymentEnabled`。

Vercel の Root Directory 配下（現在は `apps/legacy-web/`、cutover 後は
`apps/web/`）の `vercel.json` に次を置く。**この PR で
`apps/legacy-web/vercel.json` として追加済み**なので、operator 側の作業は
不要（マージされれば効く）。

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

> **これは repository のコードで設定できる**（dashboard 作業ではない）。
> ただし **Root Directory 配下に置く必要がある** —— リポジトリ root の
> `vercel.json` は読まれない（`docs/v2/decisions.md` O1 の補足を参照）。
> cutover で Root Directory を `apps/web` へ切り替える際、この設定も
> 一緒に移すこと。

Preview の自動 deploy は止めない。Preview は smoke 環境として使う。

## 手順 3: Preview の環境変数を Production から分離する

**Vercel → stage-tracker → Settings → Environment Variables**

`NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` について、
**Preview scope の値を placeholder に差し替える**（Production scope は変更
しない）。

| 変数                            | Production  | Preview                              |
| ------------------------------- | ----------- | ------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | 実 URL      | `https://placeholder.invalid`        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 実 anon key | `preview-placeholder-not-a-real-key` |

**なぜ placeholder で良いか**（実測済み、2026-09-08）: `apps/web` を到達
不能な Supabase URL でビルド・起動して確認した。

| 経路                                            | 結果                                      |
| ----------------------------------------------- | ----------------------------------------- |
| `/` `/calendar` `/catalog` `/tickets` `/mypage` | **307 → `/sign-in`**（500 ではない）      |
| `/sign-in`                                      | 200                                       |
| `/auth/confirm?token_hash=...&type=email`       | 307 → `/sign-in?error=link_expired`       |
| sign-in フォーム送信                            | 200（例外にならず、常の acknowledgement） |
| サーバログ                                      | エラー・unhandled なし                    |

Supabase client がネットワーク失敗を握って `user: null` を返すため、
default-deny が自然に成立する。**`apps/web/src/env.ts` の変更は不要**
（`z.url()` と非空文字列を満たす）。CI の `Verify / Build` が既に同じ
placeholder でビルドを通しており整合する。

> **注意**: 現在 Vercel の Root Directory は `apps/legacy-web` であり、
> Preview がビルドしているのは legacy 側。この設定は cutover 後に
> `apps/web` へ効く。legacy 側の Preview が placeholder で壊れないことは、
> cutover 前に別途確認すること（legacy は default-deny の作りが異なる）。

## 手順 4: 確認

設定後、次を確認する。

- [ ] `main` へ push しても Vercel が自動で Production deploy しない
- [ ] Preview の自動 deploy は従来どおり走る（止めたのは Production だけ）
- [ ] Preview deployment の環境変数が placeholder になっている
- [ ] `production` environment の secret が `main` の job からのみ読める
      （PR の branch で走る job からは読めない）

## 手順 5: release workflow の dry-run

`workflow_dispatch` から `dry_run: true`（既定）で実行し、次を確認する。

- [ ] `Check release configuration` が `configured=true` になる
- [ ] `Plan migrations` が pending の有無を正しく報告する
- [ ] apply / drift 確認 / deploy が **skip されている**（dry-run なので）

その後 `dry_run: false` で実行し、次を確認する。

- [ ] migration が無い場合、deploy だけが走る
- [ ] migration がある場合、`migration → drift 確認 → deploy` の順に走る
- [ ] migration が失敗した場合、**deploy が走らない**
- [ ] drift が残った場合、**deploy が走らない**
- [ ] deploy が **checkout した commit の内容**を deploy している
      （Vercel の deployment 詳細で確認）

## 手順 6: Migration Ordering Fence の整理（この手順の完了後）

現行の `Verify / Migration Ordering Fence` は、`schema-first-required` の PR に
対して **merge 前に operator が Production migration を適用した evidence** を
要求する（`docs/architecture/runtime-stack.md`、
`.github/pull_request_template.md`）。これは release workflow の契約
（merge 後に Actions が適用する）と衝突する。

**ただし、この手順が完了するまでは旧 fence が唯一の保護である。** 先に
fence を外すと、pipeline が動いていないのに人間の手順も無い状態になる。

したがって整理は **手順 1〜5 が完了し dry-run が通ってから**、別 PR で行う。
その時点ではすべての migration が deploy より前に適用されることが保証される
ため、`schema-first-required` / `post-deploy-safe` の区別自体の役割が変わる。

## 元に戻す場合

案 C をやめる場合は、`vercel.json` の `git.deploymentEnabled` を外せば
Vercel の auto-deploy が復活する。GitHub Environment の secret は削除する。
