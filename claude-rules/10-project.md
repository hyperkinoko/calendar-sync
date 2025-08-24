# Google Calendar 同期システム実装指示書

## プロジェクト概要
個人用Googleカレンダー（プライベート・仕事）の予定を、プロジェクトA用のGoogleカレンダーに「予定あり」として自動同期するシステムを構築します。Calendar APIのWebhookを使用し、リアルタイムで同期を行います。

## 要件
- 個人カレンダーの予定が作成・更新・削除されたら、即座にプロジェクトAカレンダーに反映
- 同期された予定は「🔒 予定あり」というタイトルで、グレー色のラベルを設定
- プロジェクトA以外の予定の詳細は隠蔽（時間帯のみ共有）
- Vercelにデプロイし、サーバーレスで運用
- 開発環境はDockerで構築（compose.yml使用）

## カレンダー情報
```
同期元:
- プライベート: kinokodata.edu@gmail.com
- 仕事: 63537fbd9fa3f05d83907ebcdaef6f4e326b757754114b6bed0394ba34b3e472@group.calendar.google.com

同期先:
- プロジェクトA: [要確認]
```

## ディレクトリ構造
```
calendar-sync/
├── api/
│   ├── webhook/
│   │   └── calendar.ts      # Webhook受信エンドポイント
│   ├── cron/
│   │   └── refresh-webhooks.ts  # Webhook更新用
│   └── setup/
│       └── initialize.ts    # 初期設定用エンドポイント
├── lib/
│   ├── google-auth.ts      # Google認証設定
│   ├── calendar-sync.ts    # 同期ロジック
│   ├── webhook-manager.ts  # Webhook管理
│   └── storage.ts          # データ永続化（Vercel KV）
├── scripts/
│   └── setup-webhooks.ts   # ローカル実行用セットアップ
├── types/
│   └── index.ts           # 型定義
├── .env.local             # 環境変数（ローカル）
├── .env.example           # 環境変数サンプル
├── compose.yml            # Docker Compose設定（V2形式）
├── Dockerfile             # 開発用Dockerイメージ
├── package.json
├── tsconfig.json
└── vercel.json
```

## 実装順序

### Phase 1: 基本設定
1. Docker環境の構築（compose.yml, Dockerfile）
2. プロジェクト初期化とパッケージインストール
3. TypeScript設定
4. 環境変数の設定（.env.local, .env.example）
5. Google認証モジュールの実装

### Phase 2: 同期ロジック
1. カレンダーイベント取得処理
2. 重複チェック機能
3. イベント作成・削除処理
4. エラーハンドリング

### Phase 3: Webhook実装
1. Webhook受信エンドポイント
2. イベント変更の検知と処理
3. Webhook登録・更新処理
4. 定期更新のCron設定

### Phase 4: デプロイと運用
1. Vercel KVのセットアップ
2. Vercelへのデプロイ
3. Webhook初期登録
4. 動作確認とログ設定

## 技術仕様

### 使用技術
- **Runtime**: Node.js 20（Docker環境）
- **Language**: TypeScript
- **Framework**: Vercel Functions
- **APIs**: Google Calendar API v3
- **Storage**: Vercel KV（Redis互換）
- **認証**: Google Service Account
- **開発環境**: Docker + Docker Compose（V2形式）

### 必要なnpmパッケージ
```json
{
  "dependencies": {
    "googleapis": "^118.0.0",
    "@vercel/kv": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vercel/node": "^3.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0"
  }
}
```

### 環境変数
```bash
# Google Service Account
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# Calendar IDs
PROJECT_A_CALENDAR_ID=
PRIVATE_CALENDAR_ID=kinokodata.edu@gmail.com
WORK_CALENDAR_ID=63537fbd9fa3f05d83907ebcdaef6f4e326b757754114b6bed0394ba34b3e472@group.calendar.google.com

# Vercel KV（本番環境では自動設定）
KV_URL=
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=

# Security（32文字以上のランダム文字列を使用）
WEBHOOK_SECRET=  # 例: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CRON_SECRET=     # 例: openssl rand -hex 32
```

## 主要機能の実装ポイント

### 1. Webhook受信時の処理フロー
```
1. Googleからの通知を受信
2. トークン認証（WEBHOOK_SECRET）の検証
3. Googleヘッダーの検証（X-Goog-Channel-ID等）
4. 変更されたカレンダーの特定
5. 最新の変更内容を取得（syncToken使用）
6. プロジェクトAカレンダーに同期
7. syncTokenを更新・保存
```

### 2. 同期イベントの形式
```javascript
{
  summary: "🔒 予定あり",
  start: { dateTime: sourceEvent.start.dateTime },
  end: { dateTime: sourceEvent.end.dateTime },
  colorId: "8",              // グレー色
  transparency: "opaque",    // 予定ありとして表示
  visibility: "default",
  description: "[自動同期]\\n同期元: {カレンダー名}\\n同期時刻: {日時}",
  guestsCanModify: false,
  guestsCanInviteOthers: false,
  reminders: { useDefault: false, overrides: [] }
}
```

### 3. データ永続化（Vercel KV）
```
- syncToken: 各カレンダーの最終同期トークン
- Webhook情報: Channel ID、Resource ID、有効期限
- イベントマッピング: 同期元と同期先のイベントID対応表
- 同期状態: 最終同期時刻、エラー情報
```

### 4. 重複防止ロジック
- イベントIDマッピングで同期済みイベントを管理
- 説明欄のメタデータで同期元を識別（バックアップ）
- 同じ時間帯の重複チェック

### 5. エラーハンドリング
- Google API のレート制限対策
- ネットワークエラーのリトライ
- Webhook有効期限切れの検知と自動更新
- 構造化ログでデバッグ容易に

### 6. セキュリティ実装
```javascript
// Webhook認証
if (req.query.token !== process.env.WEBHOOK_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}

// Cron認証
if (req.headers['authorization'] !== \`Bearer \${process.env.CRON_SECRET}\`) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

## Docker開発環境

### compose.yml
```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      NODE_ENV: development
    env_file:
      - .env.local
    command: npm run dev

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### Dockerコマンド
```bash
# 開発環境の起動
docker compose up -d

# ログの確認
docker compose logs -f app

# コンテナに入る
docker compose exec app sh

# 環境の停止
docker compose down
```

## テストとデバッグ

### ローカルテスト
```bash
# Docker環境内でWebhook受信のテスト
docker compose exec app curl -X POST http://localhost:3000/api/webhook/calendar?token=YOUR_SECRET \
  -H "X-Goog-Channel-ID: test-channel" \
  -H "X-Goog-Resource-State: update"

# 手動同期実行
docker compose exec app npm run sync:manual
```

### ログ出力
- Docker環境では`docker compose logs -f app`でリアルタイム確認
- Vercel本番環境ではFunctions のログを活用
- 構造化ログで検索しやすく
- エラー時は詳細なコンテキストを記録

## 完成時の動作
1. 個人カレンダーに予定を追加 → 数秒でプロジェクトAに「予定あり」が表示
2. 個人カレンダーの予定を削除 → プロジェクトAの対応する「予定あり」も削除
3. Webhookは自動的に更新され、途切れることなく同期が継続

## 注意事項
- Google Calendar APIの無料枠制限に注意（1日あたり1,000,000リクエスト）
- Vercel KVの無料枠制限（月間30,000コマンド）
- Webhook URLは公開されるため、必ずWEBHOOK_SECRETで認証すること
- 開発環境はDockerで統一（compose.yml使用、V2形式）
- コミットメッセージ、コメント、エラーメッセージは日本語で記述

## Vercelへのデプロイ手順

### 1. 環境変数の設定
```bash
# Vercelダッシュボードで設定
# Settings → Environment Variables
WEBHOOK_SECRET=<生成した32文字以上のトークン>
CRON_SECRET=<生成した32文字以上のトークン>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<サービスアカウントのメール>
GOOGLE_PRIVATE_KEY=<サービスアカウントの秘密鍵>
PROJECT_A_CALENDAR_ID=<プロジェクトAのカレンダーID>
```

### 2. デプロイ
```bash
# Vercel CLIでデプロイ
vercel --prod
```

### 3. Webhook初期登録
```bash
# 本番環境でWebhook登録スクリプトを実行
curl -X POST https://your-app.vercel.app/api/setup/initialize \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

この指示書に基づいて実装を進めてください。不明な点があれば質問してください。