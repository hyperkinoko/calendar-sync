# 📅 Google Calendar 同期システム

個人用Googleカレンダー（プライベート・仕事）の予定を、プロジェクトA用のGoogleカレンダーに「🔒 予定あり」として自動同期するシステム。

## 🌟 特徴

- **リアルタイム同期**: Google Calendar Webhookを使用した即座の同期
- **プライバシー保護**: 予定の詳細は隠蔽し、時間帯のみ共有
- **Docker対応**: 開発環境はDocker Composeで統一
- **Vercelデプロイ**: サーバーレスでの本番運用
- **エラーハンドリング**: リトライ機能と日本語エラーメッセージ
- **運用スクリプト**: 手動同期とWebhook管理のCLIツール

## 🚀 クイックスタート

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd calendar-sync
```

### 2. 環境変数の設定

```bash
# .env.exampleをコピーして設定
cp .env.example .env.local

# 必要な値を設定（後述の詳細を参照）
vi .env.local
```

### 3. Docker環境での開発

```bash
# 開発環境の起動
docker compose up -d

# ログの確認
docker compose logs -f app

# 環境の停止
docker compose down
```

### 4. 手動同期のテスト

```bash
# コンテナ内で実行
docker compose exec app npm run sync:manual

# または、ローカルでNode.js環境がある場合
npm install
npm run sync:manual
```

## ⚙️ 環境変数の設定

### Google Service Account設定

1. [Google Cloud Console](https://console.cloud.google.com)でプロジェクトを作成
2. Calendar APIを有効化
3. Service Accountを作成し、JSONキーをダウンロード
4. 各カレンダーにService Accountを編集者として招待

```bash
# Google Service Account認証情報
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"
```

### カレンダーID設定

```bash
# 同期元カレンダー
PRIVATE_CALENDAR_ID=your-private@gmail.com
WORK_CALENDAR_ID=your-work-calendar-id@group.calendar.google.com

# 同期先カレンダー（プロジェクトA）
PROJECT_A_CALENDAR_ID=project-a-calendar-id@group.calendar.google.com
```

### セキュリティトークン生成

```bash
# ランダムトークンを生成（32文字以上推奨）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 環境変数に設定
WEBHOOK_SECRET=生成したトークン1
CRON_SECRET=生成したトークン2
```

## 🔧 利用可能なコマンド

### 開発環境

```bash
# Docker環境の起動
docker compose up -d

# ログ監視
docker compose logs -f app

# コンテナに接続
docker compose exec app sh

# 環境の停止
docker compose down
```

### 同期関連

```bash
# 手動同期実行
npm run sync:manual

# カレンダーアクセス権限確認も含む
docker compose exec app npm run sync:manual
```

### Webhook管理

```bash
# Webhook新規登録
npm run setup:webhooks

# 現在のWebhook状況確認
npm run webhooks:list

# 期限切れWebhookの更新
npm run webhooks:refresh

# ヘルプ表示
npm run setup:webhooks help
```

### 開発用

```bash
# TypeScript型チェック
npm run type-check

# ビルド
npm run build

# 開発サーバー
npm run dev
```

## 🌐 Vercelデプロイ

### 1. Vercelプロジェクト作成

```bash
# Vercel CLIをインストール
npm i -g vercel

# プロジェクトをVercelに接続
vercel

# 初回デプロイ
vercel --prod
```

### 2. 環境変数の設定

Vercelダッシュボードの Settings → Environment Variables で設定:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
PROJECT_A_CALENDAR_ID
PRIVATE_CALENDAR_ID
WORK_CALENDAR_ID
WEBHOOK_SECRET
CRON_SECRET
```

### 3. 初回セットアップ

```bash
# システム初期化（カレンダー確認、初回同期、Webhook登録）
curl -X POST https://your-app.vercel.app/api/setup/initialize \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## 🔄 システムの動作

### 同期フロー

1. **個人カレンダー**で予定を作成・更新・削除
2. **Google Webhook**が変更を検知してエンドポイントに通知
3. **同期処理**が実行され、プロジェクトAカレンダーに反映
4. 同期されたイベントは「🔒 予定あり」として表示

### 同期されるイベント形式

```javascript
{
  summary: "🔒 予定あり",
  start: { /* 元の予定と同じ時間 */ },
  end: { /* 元の予定と同じ時間 */ },
  colorId: "8",              // グレー色
  description: "[自動同期]\n同期元: プライベート\n...",
  transparency: "opaque",    // 予定ありとして表示
  guestsCanModify: false,
  reminders: { useDefault: false, overrides: [] }
}
```

### 自動保守

- **Webhook更新**: 6時間ごとに期限切れをチェックして自動更新
- **増分同期**: syncTokenを使用した効率的な変更検知
- **エラーハンドリング**: 指数バックオフによるリトライ

## 📁 プロジェクト構造

```
calendar-sync/
├── api/                    # Vercel Functions
│   ├── webhook/
│   │   └── calendar.ts     # Webhook受信エンドポイント
│   ├── cron/
│   │   └── refresh-webhooks.ts  # 定期Webhook更新
│   └── setup/
│       └── initialize.ts   # システム初期化
├── lib/                    # コアライブラリ
│   ├── google-auth.ts      # Google認証
│   ├── calendar-sync.ts    # 同期ロジック
│   ├── webhook-manager.ts  # Webhook管理
│   ├── storage.ts          # データ永続化
│   └── error-handler.ts    # エラー処理
├── scripts/                # 運用スクリプト
│   ├── manual-sync.ts      # 手動同期
│   └── setup-webhooks.ts   # Webhook管理CLI
├── types/
│   └── index.ts            # 型定義
├── compose.yml             # Docker Compose設定
├── Dockerfile              # 開発用コンテナ
├── vercel.json            # Vercel設定
└── README.md              # このファイル
```

## 🛠️ トラブルシューティング

### よくある問題

#### 1. カレンダーアクセスエラー

```
❌ カレンダーへのアクセス確認失敗: 403 Forbidden
```

**解決方法**:
- Service Accountが各カレンダーに編集者として招待されているか確認
- Calendar APIが有効になっているか確認

#### 2. Webhook登録エラー

```
❌ Webhook登録エラー: webhookUrl
```

**解決方法**:
- Webhook URLがHTTPS公開されているか確認
- 開発環境ではngrok等を使用してローカルをHTTPS公開

#### 3. 同期トークン無効エラー

```
Sync token is no longer valid
```

**解決方法**:
- システムが自動的に初回同期に切り替えるため、通常は問題なし
- 繰り返し発生する場合は手動で同期トークンを削除

### ログの確認

```bash
# Docker環境
docker compose logs -f app

# Vercel本番環境
vercel logs --follow
```

### デバッグ情報

```bash
# システムの状況確認
npm run webhooks:list

# 手動同期でエラー詳細確認
npm run sync:manual
```

## 📊 監視とメンテナンス

### ヘルスチェック

システムの健全性を確認するエンドポイント:

```bash
# 初期化エンドポイントでヘルスチェック
curl -X POST https://your-app.vercel.app/api/setup/initialize \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 定期メンテナンス

- **Webhook更新**: 自動（6時間ごと）
- **手動同期**: 必要に応じて `npm run sync:manual`
- **ログ確認**: エラー発生時にVercelダッシュボードでログ確認

## 🔐 セキュリティ

- **トークン認証**: すべてのエンドポイントで認証トークン必須
- **環境変数**: 機密情報は環境変数で管理
- **最小権限**: Service Accountは必要最小限の権限のみ
- **HTTPS必須**: Webhook URLはHTTPSで公開

## 📝 ライセンス

MIT License

## 🤝 貢献

バグ報告や改善提案は Issue からお願いします。

---

**自動生成**: このプロジェクトは [Claude Code](https://claude.ai/code) で生成されました。