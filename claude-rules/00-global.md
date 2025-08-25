# Claude Code グローバルルール

このファイルは全プロジェクト共通のルールです。
`~/claude/claude-rules.md` として保存し、各プロジェクトでは `.claude-rules/00-global.md` にコピーされます。

## 最重要ルール

### 日本語の使用
- **すべての返答は日本語で行うこと**
- **コード内のコメントも日本語で記述**
- **エラーメッセージは日本語で表示**
- **テストの説明も日本語で記述**
- **コミットメッセージも日本語で記述**
- **ドキュメントも日本語で記述**
- ただし、変数名・関数名・クラス名は英語（一般的な慣習に従う）

### 例
```javascript
// ❌ 悪い例
// Get user by ID
function getUser(id) {
  if (!id) {
    throw new Error('User ID is required');
  }
}

// ✅ 良い例  
// ユーザーIDからユーザー情報を取得する
function getUser(id) {
  if (!id) {
    throw new Error('ユーザーIDが必要です');
  }
}
```

```javascript
// テストも日本語で
describe('ユーザーサービス', () => {
  it('IDが指定されていない場合はエラーを投げる', () => {
    expect(() => getUser()).toThrow('ユーザーIDが必要です');
  });
});
```

## Docker設定

### Docker Compose
- **ファイル名**: `compose.yml`を使用（`docker-compose.yml`ではない）
- **形式**: V2形式で記述（`version:`フィールドは記載しない）
- **コマンド**: `docker compose`を使用（`docker-compose`ではない）

### 正しい例
```yaml
# compose.yml (V2形式)
services:
  web:
    image: node:20-alpine
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
    volumes:
      - .:/app
      - /app/node_modules
    working_dir: /app
    command: npm run dev

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:

networks:
  default:
    name: myapp_network
```

### Dockerコマンド
```bash
# ✅ 正しいコマンド（スペース区切り）
docker compose up -d
docker compose down
docker compose ps
docker compose logs -f
docker compose exec web sh

# ❌ 古いコマンド（使わない）
# docker-compose up -d
```

## 基本的なコーディング規約

### フォーマット
- **インデント**: スペース2つ
- **文字コード**: UTF-8（BOMなし）
- **改行コード**: LF（Unix形式）
- **末尾スペース**: 削除する
- **ファイル末尾**: 改行を入れる

### 命名規則
```javascript
// 変数・関数: camelCase
const userId = 123;
function getUserName() {}

// クラス・コンポーネント: PascalCase
class UserService {}
function UserProfile() {}

// 定数: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = 'https://api.example.com';

// ファイル名: kebab-case
// user-service.js
// shopping-list.tsx

// ディレクトリ: kebab-case
// src/shopping-list/
// src/user-profile/
```

## Git規約

### コミットメッセージ
```bash
# 形式: <type>: <説明>

# type の種類
feat: 新機能
fix: バグ修正
docs: ドキュメントのみの変更
style: コードの動作に影響しない変更（スペース、フォーマット等）
refactor: バグ修正や機能追加ではないコードの変更
test: テストの追加・修正
chore: ビルドプロセスやツールの変更

# 例
feat: 買い物リストの追加機能を実装
fix: ログイン時のエラーを修正
docs: READMEにセットアップ手順を追加
test: ユーザーサービスのテストを追加
```

### ブランチ名
```bash
feature/買い物リスト
fix/ログインエラー
refactor/ユーザーサービス
```

## エラーハンドリング

### エラーメッセージは日本語で
```javascript
// カスタムエラークラス
class ValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = '検証エラー';
    this.field = field;
  }
}

// 使用例
if (!email) {
  throw new ValidationError('メールアドレス', '必須項目です');
}

// APIエラーレスポンス
res.status(400).json({
  error: {
    message: 'リクエストが不正です',
    details: '必須パラメータが不足しています'
  }
});
```

## テスト

### テストの記述
```javascript
describe('買い物リストサービス', () => {
  describe('アイテムを追加する時', () => {
    it('正常にアイテムが追加される', () => {
      // テスト実装
    });
    
    it('名前が空の場合はエラーを返す', () => {
      // テスト実装
    });
  });
});
```

## セキュリティ

### 環境変数
- `.env`ファイルで管理
- `.env`は必ず`.gitignore`に追加
- `.env.example`を用意する

```bash
# .env.example
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
JWT_SECRET=your-secret-key-here
API_KEY=your-api-key-here
```

### 機密情報
- **絶対に守ること**: APIキー、パスワード、秘密鍵、認証情報は絶対にハードコーディングしない
- **絶対に守ること**: 実際の認証情報をドキュメント・コメント・ファイルに書かない
- **絶対に守ること**: OAuth2のClient ID、Client Secret、Refresh Tokenは絶対に記載しない
- 本番環境の情報はコメントにも書かない
- すべての認証情報は環境変数（.env.local）で管理し、gitignoreで除外する
- ドキュメントにはプレースホルダー（`<説明>`）のみ記載する

## ドキュメント

### README.md
```markdown
# プロジェクト名

## 概要
[日本語でプロジェクトの説明]

## セットアップ
\`\`\`bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envを編集

# 開発サーバーの起動
npm run dev
\`\`\`

## 使い方
[日本語で使い方を説明]
```

### JSDoc
```javascript
/**
 * ユーザー情報を取得する
 * @param {string} userId - ユーザーID
 * @returns {Promise<User>} ユーザー情報
 * @throws {NotFoundError} ユーザーが見つからない場合
 */
async function getUser(userId) {
  // 実装
}
```

## ディレクトリ構造

### 推奨構成
```
project/
├── src/              # ソースコード
├── tests/            # テストコード
├── docs/             # ドキュメント
├── scripts/          # ユーティリティスクリプト
├── compose.yml       # Docker Compose設定
├── .env.example      # 環境変数サンプル
├── .gitignore
├── README.md         # 日本語のREADME
├── CLAUDE.md         # Claude用設定
└── claude-rules/    # Claudeルール
```

## パッケージ管理

### 優先順位
1. npm（推奨）
2. pnpm
3. yarn（非推奨）

### lockファイル
- 必ずコミットする
- 依存関係の更新は慎重に

## その他の規約

### console.log
- 本番コードには残さない
- デバッグ時は適切なログレベルを使用

```javascript
// 開発時
console.log('デバッグ:', data);

// 本番対応
import debug from 'debug';
const log = debug('app:user-service');
log('ユーザー情報を取得:', userId);
```

### 早期リターン
```javascript
// ❌ ネストが深い
function processUser(user) {
  if (user) {
    if (user.active) {
      // 処理
    }
  }
}

// ✅ 早期リターン
function processUser(user) {
  if (!user) return;
  if (!user.active) return;
  
  // 処理
}
```

### マジックナンバー
```javascript
// ❌ マジックナンバー
if (retryCount > 3) {
  throw new Error('リトライ回数を超えました');
}

// ✅ 定数化
const MAX_RETRY_COUNT = 3;
if (retryCount > MAX_RETRY_COUNT) {
  throw new Error(`リトライ回数（${MAX_RETRY_COUNT}回）を超えました`);
}
```

---

これらのルールは全プロジェクトで適用されます。
プロジェクト固有のルールは、番号の大きいファイルで上書きできます。

