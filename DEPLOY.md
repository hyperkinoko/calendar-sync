# 🚀 デプロイガイド

Google Calendar同期システムをVercelにデプロイする手順を詳しく説明します。

## 📋 事前準備

### 1. Google Cloud プロジェクト設定

#### プロジェクト作成
```bash
# Google Cloud Consoleでプロジェクトを作成
# https://console.cloud.google.com/projectcreate
```

#### Calendar API有効化
```bash
# Google Cloud Consoleで以下のAPIを有効化
# https://console.cloud.google.com/apis/library/calendar.googleapis.com
```

#### Service Account作成
```bash
# IAM & Admin > Service Accounts で新規作成
# 1. 名前: calendar-sync-service-account
# 2. 権限: 無し（カレンダー個別に設定）
# 3. JSON形式でキーをダウンロード
```

### 2. カレンダー共有設定

各カレンダーにService Accountを招待:

```
1. Googleカレンダーを開く
2. 対象カレンダーの設定 > 特定のユーザーと共有
3. Service AccountのメールアドレスをWriter権限で追加
4. 同期元（プライベート・仕事）と同期先（プロジェクトA）すべてに設定
```

### 3. カレンダーID取得

```bash
# カレンダー設定 > カレンダーの統合 > カレンダーID をコピー
# 例: abc123@group.calendar.google.com
```

## 🔧 Vercelデプロイ

### 1. Vercel CLI セットアップ

```bash
# Vercel CLIインストール
npm i -g vercel

# Vercelにログイン
vercel login
```

### 2. プロジェクトデプロイ

```bash
# プロジェクトルートで実行
vercel

# 初回質問への回答例:
# ? Set up and deploy "~/calendar-sync"? [Y/n] y
# ? Which scope do you want to deploy to? Your Name
# ? Link to existing project? [y/N] n
# ? What's your project's name? calendar-sync
# ? In which directory is your code located? ./
```

### 3. 本番環境デプロイ

```bash
# 本番デプロイ
vercel --prod
```

## ⚙️ 環境変数設定

Vercelダッシュボードで環境変数を設定:

### 1. ダッシュボードアクセス
```
https://vercel.com/your-username/calendar-sync
Settings > Environment Variables
```

### 2. 必須環境変数

| 変数名 | 値 | 説明 |
|--------|----|----|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | service-account@project.iam.gserviceaccount.com | Service Accountのメールアドレス |
| `GOOGLE_PRIVATE_KEY` | "-----BEGIN PRIVATE KEY-----\n..." | Service Accountの秘密鍵（改行含む） |
| `PROJECT_A_CALENDAR_ID` | project-calendar-id@group.calendar.google.com | 同期先カレンダーID |
| `PRIVATE_CALENDAR_ID` | your-private@gmail.com | プライベートカレンダーID |
| `WORK_CALENDAR_ID` | work-calendar-id@group.calendar.google.com | 仕事カレンダーID |
| `WEBHOOK_SECRET` | 32文字以上のランダム文字列 | Webhook認証トークン |
| `CRON_SECRET` | 32文字以上のランダム文字列 | Cron認証トークン |

### 3. 環境設定

すべての環境変数で以下を選択:
- ✅ Production
- ✅ Preview  
- ✅ Development

## 🔑 セキュリティトークン生成

```bash
# ランダムトークン生成（ローカルで実行）
node -e "console.log('WEBHOOK_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# または
openssl rand -hex 32
```

## 🎯 初回セットアップ

### 1. デプロイ確認

```bash
# デプロイされたURLを確認
vercel ls

# 例: https://calendar-sync-abc123.vercel.app
```

### 2. システム初期化

```bash
# システム全体の初期化実行
curl -X POST https://your-app.vercel.app/api/setup/initialize \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

成功レスポンス例:
```json
{
  "success": true,
  "message": "システム初期化が正常に完了しました",
  "data": {
    "results": {
      "calendarAccess": true,
      "initialSync": true,
      "webhookRegistration": true
    }
  }
}
```

### 3. 動作確認

```bash
# 手動同期テスト（ローカルから）
curl -X POST https://your-app.vercel.app/api/webhook/calendar?token=YOUR_WEBHOOK_SECRET \
  -H "X-Goog-Channel-ID: test-channel" \
  -H "X-Goog-Resource-State: exists"
```

## 📊 監視とメンテナンス

### 1. ログ確認

```bash
# リアルタイムログ
vercel logs --follow

# 特定時間のログ
vercel logs --since=1h

# エラーのみ
vercel logs --output=short | grep ERROR
```

### 2. ヘルスチェック

定期的にシステム状態を確認:

```bash
# 初期化エンドポイントでヘルスチェック
curl -X POST https://your-app.vercel.app/api/setup/initialize \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 3. Webhook状況確認

開発環境で確認:

```bash
# ローカルでWebhook状況チェック
git clone <your-repo>
cd calendar-sync
npm install
cp .env.example .env.local
# .env.localに本番と同じ値を設定

npm run webhooks:list
```

## 🛠️ トラブルシューティング

### よくあるデプロイエラー

#### 1. 環境変数エラー

```
Error: 必須の環境変数が設定されていません
```

**解決方法**:
- Vercel ダッシュボードで環境変数が正しく設定されているか確認
- 特に `GOOGLE_PRIVATE_KEY` の改行文字（\n）が正しく設定されているか確認

#### 2. Calendar API権限エラー

```
Error: 403 Forbidden - カレンダーへのアクセス権限がありません
```

**解決方法**:
- Service Accountが各カレンダーに**編集者**権限で招待されているか確認
- カレンダーIDが正しいか確認

#### 3. Webhook登録エラー

```
Error: webhookUrl - HTTPSで公開されたURLが必要です
```

**解決方法**:
- Vercelデプロイが正常に完了しているか確認
- URLがHTTPS接続可能か確認

### デバッグ手順

#### 1. 段階的確認

```bash
# Step 1: デプロイ状態確認
vercel ls

# Step 2: 環境変数確認
vercel env ls

# Step 3: ログ確認
vercel logs --output=short

# Step 4: 初期化テスト
curl -X POST https://your-app.vercel.app/api/setup/initialize \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

#### 2. ローカルでのデバッグ

```bash
# 環境変数を本番と同じに設定
cp .env.example .env.local
# .env.localを編集

# カレンダーアクセステスト
npm run sync:manual

# Webhook状況確認
npm run webhooks:list
```

## 🔄 更新とメンテナンス

### コード更新時

```bash
# 変更をコミット
git add .
git commit -m "fix: バグ修正"

# 本番デプロイ
vercel --prod
```

### 定期メンテナンス

- **Webhook更新**: 自動（6時間ごと）
- **手動同期**: 必要に応じて初期化エンドポイントを実行
- **ログ確認**: 週次でエラーログをチェック

### パフォーマンス監視

- **Vercel Analytics**: ダッシュボードで関数の実行時間を監視
- **Google Calendar API**: 利用制限（1日100万リクエスト）を監視

## 📞 サポート

### 問題報告

1. エラーメッセージとログを収集
2. 実行した手順を記録
3. 環境変数設定（機密情報は除く）を確認
4. GitHubのIssueで報告

### 緊急時の対処

1. Webhook停止: Vercelダッシュボードで関数を無効化
2. 手動同期: ローカル環境で `npm run sync:manual` を実行
3. システム復旧: `api/setup/initialize` エンドポイントを再実行

---

このガイドに従ってデプロイを行えば、Google Calendar同期システムが正常に動作するはずです。問題が発生した場合は、トラブルシューティングセクションを参照してください。