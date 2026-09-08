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

---

## 手順 1: GitHub Environment（migration の自動適用）

**Settings → Environments → New environment**、名前 `production`。

### Deployment branches

**Selected branches** に **`main` のみ**を指定する。

> environment に紐づく secret は、指定した branch で走る job からしか読めない。
> **この repository は agent が workflow ファイルを書く**ため、PR の branch から
> secret を読めないことが実質的な保護になる。

### Secret（1 つだけ）

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
3. **記号は percent-encode する**（CLI が「must be percent-encoded」と要求する。
   例: `@` → `%40`、`#` → `%23`、`/` → `%2F`）

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
