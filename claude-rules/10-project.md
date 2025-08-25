# Google Calendar 同期システム実装指示書

## プロジェクト概要
個人用Googleカレンダー（プライベート・仕事）の予定を、プロジェクトA用のGoogleカレンダーに「予定あり」として自動同期するシステム。OAuth2認証を使用し、プライバシーを保護しながら時間帯のみ共有します。

## 🎉 実装完了状況
✅ **完全実装済み** - 2025年8月25日現在、すべての機能が実装され動作確認済み

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
- プロジェクトA: sak-matsumoto@uryu.ac.jp
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
- **Storage**: Vercel KV（Redis互換）、開発環境はRedis
- **認証**: Google OAuth2（Service Accountから移行済み）
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
# Google OAuth2認証（Service Accountから移行済み）
GOOGLE_CLIENT_ID=<OAuth2 Client ID>
GOOGLE_CLIENT_SECRET=<OAuth2 Client Secret>
GOOGLE_REFRESH_TOKEN=<OAuth2 Refresh Token>

# Calendar IDs
PROJECT_A_CALENDAR_ID=sak-matsumoto@uryu.ac.jp
PRIVATE_CALENDAR_ID=kinokodata.edu@gmail.com
WORK_CALENDAR_ID=63537fbd9fa3f05d83907ebcdaef6f4e326b757754114b6bed0394ba34b3e472@group.calendar.google.com

# ストレージ設定
KV_URL=redis://redis:6379  # 開発環境はRedis、本番はVercel KVが自動設定
KV_REST_API_URL=           # 本番環境では自動設定
KV_REST_API_TOKEN=         # 本番環境では自動設定
KV_REST_API_READ_ONLY_TOKEN=  # 本番環境では自動設定

# Security（32文字以上のランダム文字列）
WEBHOOK_SECRET=279cde77c8bb08079d58d846290b0290b6fbd68fa1161ac68a771a927bfdc4f5
CRON_SECRET=35d98619d125d8d35b619619280a591dd9cba8ceb6151fbccd700d03f4954292
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
  description: "[自動同期]\\n同期元: {カレンダー名}\\n同期時刻: {日時}\\n同期元イベントID: {ID}",
  guestsCanModify: false,
  guestsCanInviteOthers: false,
  reminders: { useDefault: false, overrides: [] },
  extendedProperties: {
    private: {
      sourceCalendarId: metadata.sourceCalendarId,
      sourceCalendarName: metadata.sourceCalendarName,
      sourceEventId: metadata.sourceEventId,
      syncedAt: metadata.syncedAt
    }
  }
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
**包含関係による重複判定：**
- 既存の同期イベントが新しいイベントを時間的に包含している場合はスキップ
- `extendedProperties.private.sourceCalendarId`で同期イベントを識別
- 辞退したイベント（`responseStatus: 'declined'`）は同期対象外
- 同期範囲：1週間前〜未来90日間

**判定条件：**
```javascript
// 時刻指定イベント：包含関係をチェック
if (existStart <= newStart && existEnd >= newEnd) {
  // スキップ（既存イベントが新しいイベントを包含）
}

// 全日イベント：完全一致のみチェック  
if (existingStart === timeMin && existingEnd === timeMax) {
  // スキップ
}
```

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
      - "33000:3000"  # ポート3000が使用中のため33000に変更
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      NODE_ENV: development
    env_file:
      - .env.local
    # 常駐ではなく、docker compose run --rm app コマンドで実行

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
# Redis起動
docker compose up -d redis

# 手動同期実行
docker compose run --rm app npm run sync:manual

# OAuth2セットアップ（初回のみ）
docker compose run --rm app npm run oauth2:setup

# デバッグスクリプト実行
docker compose run --rm app npm run debug:auth
docker compose run --rm app npm run debug:calendars

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

## 📋 実装済み機能

### ✅ 完了済み機能
- **OAuth2認証**: Service Accountから移行、個人カレンダーへの直接アクセス
- **同期処理**: 1週間前〜未来90日間の範囲で毎回全件チェック
- **重複防止**: 包含関係による智慧的な重複判定（手動調整対応）
- **辞退イベント除外**: 参加を辞退したイベントは同期対象外
- **プライバシー保護**: 「🔒 予定あり」として時間帯のみ共有
- **メタデータ管理**: `extendedProperties`でソース情報を管理
- **エラーハンドリング**: 各種APIエラーの適切な処理
- **デバッグツール**: 認証・カレンダーアクセス・偽装テスト用スクリプト
- **Docker開発環境**: Redis連携、各種npmスクリプト

### 🎯 動作確認済み
- プライベートカレンダー: 5件同期
- 仕事カレンダー: 11件同期（うち1件は新規追加テスト）
- 重複判定: 手動で時間拡張した既存イベントとの包含関係を正しく検出
- 辞退イベント: 「Valuup開発定例」×10件を正しく除外
- 10月26日の予定: 90日範囲拡張により同期成功

## 📊 API使用量
- **現在の使用量**: 約17回/同期 × 3回/日 = 51回/日
- **Google Calendar API無料枠**: 1,000,000回/日
- **使用率**: 0.005%程度（十分に余裕あり）

## 注意事項
- Google Calendar APIは無料枠で十分（月間でも1,500回程度の使用）
- OAuth2のリフレッシュトークンは長期間有効（手動更新不要）
- Webhook URLは公開されるため、必ずWEBHOOK_SECRETで認証すること
- 開発環境はDockerで統一（compose.yml使用、V2形式）

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