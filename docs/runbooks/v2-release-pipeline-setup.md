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

## 手順 1: GitHub Environment を作る

**Settings → Environments → New environment**、名前 `production`。

### Deployment branches

**Selected branches** に `main` のみを指定する。

> これが最も重要な制限。environment に紐づく secret は、指定した branch で
> 走る job からしか読めない。PR の branch から読めないため、**PR で workflow
> を書き換えても secret は取れない**。この repository は agent が workflow
> ファイルを書くため、この制限が実質的な保護になる。

### Secrets

| 名前                     | 用途                      | 取得元                                            |
| ------------------------ | ------------------------- | ------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`  | Supabase CLI の認証       | Supabase Dashboard → Account → Access Tokens      |
| `SUPABASE_PROJECT_REF`   | 対象 project の識別       | Dashboard の URL、または `supabase projects list` |
| `SUPABASE_DB_PASSWORD`   | `supabase db push` の接続 | project 作成時に設定した DB password              |
| `VERCEL_DEPLOY_HOOK_URL` | deploy の起動             | 手順 2 で作る                                     |

> **service-role key は置かない。** migration の適用に必要なのは上記だけで、
> service-role key は別物（application runtime も持たない方針）。

## 手順 2: Vercel の Git 連携を変更する

**Vercel → stage-tracker → Settings → Git**

### 2-1. Production の auto-deploy を止める

**Ignored Build Step** に次を設定する（または Production Branch の
auto-deploy を無効化する。UI の版によって場所が異なる）。

```sh
if [ "$VERCEL_ENV" = "production" ]; then exit 0; else exit 1; fi
```

> `exit 0` = ビルドをスキップ。Production だけを止め、Preview は従来どおり
> ビルドさせる。

**なぜ止めるのか**: 止めないと、workflow が migration を適用している最中に
Vercel が先に新しい build を deploy してしまう。migration と deploy が
race する。案 B / C のいずれでも auto-deploy はそのまま残せない。

### 2-2. Deploy Hook を作る

**Settings → Git → Deploy Hooks** で、branch `main` に対する hook を作る。
生成された URL を、手順 1 の `VERCEL_DEPLOY_HOOK_URL` として登録する。

> Deploy Hook は「この branch を deploy せよ」以外の権限を持たない。
> Vercel の API token（project の設定変更や他 project の操作ができる）を
> CI へ置くより権限が小さい。

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
- [ ] Deploy Hook を叩くと Production deploy が走る
- [ ] Preview deployment の環境変数が placeholder になっている
- [ ] `production` environment の secret が `main` の job からのみ読める
      （PR の branch で走る job からは読めない）

## 手順 5: release workflow の dry-run

repository 側に `release.yml` を追加した後、`workflow_dispatch` の
dry-run mode で次を確認する（実装は Issue #387 の scope）。

- [ ] migration が無い場合、deploy だけが走る
- [ ] migration がある場合、`migration → drift 確認 → deploy` の順に走る
- [ ] migration が失敗した場合、**deploy が走らない**
- [ ] drift が残った場合、**deploy が走らない**

## 元に戻す場合

案 C をやめる場合は、手順 2-1 の Ignored Build Step を外せば Vercel の
auto-deploy が復活する。GitHub Environment の secret は削除する。
