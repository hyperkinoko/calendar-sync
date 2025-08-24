# Node.js 20のAlpineイメージを使用
FROM node:20-alpine

# 作業ディレクトリを設定
WORKDIR /app

# pnpmをインストール（高速なパッケージマネージャー）
RUN corepack enable && corepack prepare pnpm@latest --activate

# 依存関係ファイルをコピー
COPY package*.json pnpm-lock.yaml* ./

# 依存関係をインストール
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

# アプリケーションコードをコピー
COPY . .

# ポート3000を公開
EXPOSE 3000

# 開発サーバーを起動
CMD ["npm", "run", "dev"]