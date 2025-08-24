// エラー処理とリトライ機能を提供するユーティリティ

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryCondition?: (error: any, attempt: number) => boolean;
}

export class CalendarSyncError extends Error {
  constructor(
    message: string,
    public code?: string,
    public originalError?: any,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'CalendarSyncError';
  }
}

// 指数バックオフでリトライ
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    retryCondition = (error, attempt) => shouldRetry(error) && attempt < maxAttempts,
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      if (!retryCondition(error, attempt)) {
        break;
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
        console.warn(`⚠️ リトライ ${attempt}/${maxAttempts}: ${delay}ms後に再試行 - ${error.message}`);
        await sleep(delay);
      }
    }
  }

  throw new CalendarSyncError(
    `${maxAttempts}回の試行後も失敗: ${lastError.message}`,
    lastError.code,
    lastError,
    false
  );
}

// スリープ関数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// エラーがリトライ可能かどうかを判定
export function shouldRetry(error: any): boolean {
  // Google API のエラーコードに基づく判定
  if (error.code) {
    switch (error.code) {
      case 403:
        // Rate limit exceeded or quota exceeded
        if (error.message?.includes('rate limit') || 
            error.message?.includes('quota') ||
            error.message?.includes('Rate Limit Exceeded')) {
          return true;
        }
        return false;
      
      case 429:
        // Too Many Requests
        return true;
      
      case 500:
      case 502:
      case 503:
      case 504:
        // Server errors
        return true;
      
      case 401:
        // Unauthorized - token expired
        if (error.message?.includes('token')) {
          return false; // 認証エラーはリトライしない
        }
        return true;
      
      case 404:
        // Not found - カレンダーやイベントが存在しない
        return false;
      
      case 409:
        // Conflict - 重複エラー
        return false;
      
      case 410:
        // Gone - sync token invalid
        return false;
      
      default:
        return false;
    }
  }

  // ネットワークエラーなど
  if (error.message?.includes('ECONNRESET') ||
      error.message?.includes('ETIMEDOUT') ||
      error.message?.includes('ENOTFOUND') ||
      error.message?.includes('network')) {
    return true;
  }

  return false;
}

// エラーメッセージを日本語化
export function translateErrorMessage(error: any): string {
  if (error.code) {
    switch (error.code) {
      case 401:
        return 'Google認証に失敗しました。Service Accountの設定を確認してください。';
      
      case 403:
        if (error.message?.includes('rate limit') || error.message?.includes('quota')) {
          return 'Google Calendar APIの利用制限に達しました。しばらく待ってから再試行してください。';
        }
        return 'カレンダーへのアクセス権限がありません。Service Accountがカレンダーに招待されているか確認してください。';
      
      case 404:
        return 'カレンダーまたはイベントが見つかりません。カレンダーIDを確認してください。';
      
      case 409:
        return 'データの競合が発生しました。同じイベントが同時に更新された可能性があります。';
      
      case 410:
        return '同期トークンが無効になりました。初回同期から再開します。';
      
      case 429:
        return 'リクエストが多すぎます。しばらく待ってから再試行してください。';
      
      case 500:
      case 502:
      case 503:
      case 504:
        return 'Googleサーバーでエラーが発生しました。しばらく待ってから再試行してください。';
      
      default:
        return `不明なエラーが発生しました (コード: ${error.code}): ${error.message}`;
    }
  }

  // ネットワークエラー
  if (error.message?.includes('ECONNRESET')) {
    return '接続がリセットされました。ネットワーク環境を確認してください。';
  }
  if (error.message?.includes('ETIMEDOUT')) {
    return '接続がタイムアウトしました。ネットワーク環境を確認してください。';
  }
  if (error.message?.includes('ENOTFOUND')) {
    return 'サーバーが見つかりません。DNS設定を確認してください。';
  }

  // その他のエラー
  return error.message || '不明なエラーが発生しました。';
}

// 構造化ログ出力
export function logError(context: string, error: any, additionalData?: Record<string, any>) {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    context,
    error: {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
    },
    translatedMessage: translateErrorMessage(error),
    retryable: shouldRetry(error),
    ...additionalData,
  };

  console.error('🚨 エラー詳細:', JSON.stringify(errorInfo, null, 2));
}

// エラー監視とアラート（将来的な拡張用）
export function reportError(error: CalendarSyncError, context: Record<string, any> = {}) {
  // 本番環境では外部の監視サービス（Sentry、DataDog等）に送信
  if (process.env.NODE_ENV === 'production') {
    // TODO: 外部監視サービスとの統合
    console.log('📊 エラーレポート送信:', {
      error: error.message,
      code: error.code,
      retryable: error.retryable,
      context,
    });
  }
}

// 処理時間の計測
export async function measureTime<T>(
  label: string,
  operation: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const startTime = Date.now();
  
  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    
    console.log(`⏱️ ${label}: ${duration}ms`);
    
    return { result, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`⏱️ ${label}: ${duration}ms (エラーで終了)`);
    throw error;
  }
}

// バッチ処理のエラー集約
export class BatchErrorCollector {
  private errors: Array<{
    item: any;
    error: any;
    timestamp: Date;
  }> = [];

  addError(item: any, error: any) {
    this.errors.push({
      item,
      error,
      timestamp: new Date(),
    });
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  getErrors() {
    return [...this.errors];
  }

  getSummary() {
    const errorCounts = this.errors.reduce((acc, { error }) => {
      const key = error.code || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalErrors: this.errors.length,
      errorCounts,
      retryableErrors: this.errors.filter(({ error }) => shouldRetry(error)).length,
    };
  }

  clear() {
    this.errors = [];
  }
}