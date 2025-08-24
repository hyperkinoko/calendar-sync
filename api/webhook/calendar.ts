import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadEnvConfig } from '@/lib/google-auth';
import { syncSingleCalendar, getSourceCalendars } from '@/lib/calendar-sync';
import { withRetry, logError, measureTime } from '@/lib/error-handler';
import type { ApiResponse } from '@/types';

// Googleから送信されるWebhookヘッダー
interface GoogleWebhookHeaders {
  'x-goog-channel-id'?: string;
  'x-goog-channel-token'?: string;
  'x-goog-channel-expiration'?: string;
  'x-goog-resource-id'?: string;
  'x-goog-resource-state'?: string;
  'x-goog-resource-uri'?: string;
  'x-goog-message-number'?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // メソッドチェック
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'POST メソッドのみ許可されています',
    } as ApiResponse);
  }

  const startTime = Date.now();
  
  try {
    console.log('🎣 Webhook受信開始');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    // 認証トークンの検証
    const config = loadEnvConfig();
    const token = req.query.token || req.headers['x-goog-channel-token'];
    
    if (token !== config.WEBHOOK_SECRET) {
      console.error('❌ 不正なトークン:', token);
      return res.status(401).json({
        success: false,
        error: 'トークンが無効です',
      } as ApiResponse);
    }

    // Googleヘッダーの検証
    const googleHeaders: GoogleWebhookHeaders = {
      'x-goog-channel-id': req.headers['x-goog-channel-id'] as string,
      'x-goog-channel-token': req.headers['x-goog-channel-token'] as string,
      'x-goog-channel-expiration': req.headers['x-goog-channel-expiration'] as string,
      'x-goog-resource-id': req.headers['x-goog-resource-id'] as string,
      'x-goog-resource-state': req.headers['x-goog-resource-state'] as string,
      'x-goog-resource-uri': req.headers['x-goog-resource-uri'] as string,
      'x-goog-message-number': req.headers['x-goog-message-number'] as string,
    };

    // 必須ヘッダーのチェック
    if (!googleHeaders['x-goog-channel-id'] || !googleHeaders['x-goog-resource-state']) {
      console.error('❌ 必須ヘッダーが不足');
      return res.status(400).json({
        success: false,
        error: 'Googleからのリクエストではありません',
      } as ApiResponse);
    }

    const channelId = googleHeaders['x-goog-channel-id'];
    const resourceState = googleHeaders['x-goog-resource-state'];
    const resourceUri = googleHeaders['x-goog-resource-uri'];

    console.log(`📡 Webhookイベント受信:`);
    console.log(`   - Channel ID: ${channelId}`);
    console.log(`   - Resource State: ${resourceState}`);
    console.log(`   - Resource URI: ${resourceUri}`);

    // sync イベントの処理のみ（exists は無視）
    if (resourceState === 'sync') {
      console.log('🔄 初期同期通知を受信（処理スキップ）');
      return res.status(200).json({
        success: true,
        message: '初期同期通知を確認',
      } as ApiResponse);
    }

    if (resourceState !== 'exists') {
      console.log(`⚠️ 未対応のリソース状態: ${resourceState}`);
      return res.status(200).json({
        success: true,
        message: `未対応状態: ${resourceState}`,
      } as ApiResponse);
    }

    // Resource URIからカレンダーIDを抽出
    const calendarId = extractCalendarIdFromResourceUri(resourceUri);
    if (!calendarId) {
      console.error('❌ Resource URIからカレンダーIDを抽出できませんでした:', resourceUri);
      return res.status(400).json({
        success: false,
        error: 'カレンダーIDの抽出に失敗',
      } as ApiResponse);
    }

    console.log(`📅 変更されたカレンダー: ${calendarId}`);

    // 対象のソースカレンダーかチェック
    const sourceCalendars = getSourceCalendars();
    const targetCalendar = sourceCalendars.find(cal => cal.id === calendarId);
    
    if (!targetCalendar) {
      console.log(`⚠️ 監視対象外のカレンダー: ${calendarId}`);
      return res.status(200).json({
        success: true,
        message: '監視対象外のカレンダー',
      } as ApiResponse);
    }

    // 同期処理を実行（リトライ付き）
    const { result: syncResult, duration } = await measureTime(
      `${targetCalendar.name}の同期`,
      () => withRetry(
        () => syncSingleCalendar(targetCalendar),
        {
          maxAttempts: 3,
          baseDelay: 2000,
          maxDelay: 30000,
        }
      )
    );

    const processingTime = Date.now() - startTime;

    console.log(`✅ Webhook処理完了 (${processingTime}ms):`);
    console.log(`   - 作成: ${syncResult.created}件`);
    console.log(`   - 更新: ${syncResult.updated}件`);
    console.log(`   - 削除: ${syncResult.deleted}件`);
    console.log(`   - エラー: ${syncResult.errors.length}件`);

    // 成功レスポンス
    return res.status(200).json({
      success: true,
      message: '同期完了',
      data: {
        calendar: targetCalendar.name,
        duration,
        created: syncResult.created,
        updated: syncResult.updated,
        deleted: syncResult.deleted,
        errors: syncResult.errors.length,
      },
    } as ApiResponse);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    
    logError('Webhook処理', error, {
      headers: req.headers,
      query: req.query,
      processingTime,
    });

    console.error(`❌ Webhook処理エラー (${processingTime}ms):`, error.message);

    return res.status(500).json({
      success: false,
      error: 'Webhook処理でエラーが発生しました',
      message: error.message,
    } as ApiResponse);
  }
}

// Resource URIからカレンダーIDを抽出
function extractCalendarIdFromResourceUri(resourceUri?: string): string | null {
  if (!resourceUri) return null;

  // Resource URIの形式: https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
  const match = resourceUri.match(/\/calendars\/([^\/]+)\/events/);
  if (match && match[1]) {
    // URL エンコードされている場合はデコード
    return decodeURIComponent(match[1]);
  }

  return null;
}