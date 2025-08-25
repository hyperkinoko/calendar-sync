import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadEnvConfig } from '@/lib/google-auth';
import { getSourceCalendars } from '@/lib/calendar-sync';
import { debouncedSync, getTimerStatus } from '@/lib/debounce-timer';
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
  // GET: ステータス確認用エンドポイント
  if (req.method === 'GET') {
    return handleStatusCheck(req, res);
  }
  
  // POST: Webhook受信処理
  if (req.method === 'POST') {
    return handleWebhook(req, res);
  }
  
  return res.status(405).json({
    success: false,
    error: 'GET または POST メソッドのみ許可されています',
  } as ApiResponse);
}

/**
 * ステータス確認処理
 */
async function handleStatusCheck(req: VercelRequest, res: VercelResponse) {
  try {
    // 簡易認証チェック
    const config = loadEnvConfig();
    if (req.query.token !== config.WEBHOOK_SECRET) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      } as ApiResponse);
    }
    
    const timerStatus = getTimerStatus();
    
    return res.status(200).json({
      success: true,
      message: 'Webhook endpoint active',
      data: {
        timestamp: new Date().toISOString(),
        activeTimers: timerStatus.length,
        timers: timerStatus
      }
    } as ApiResponse);
    
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    } as ApiResponse);
  }
}

/**
 * Webhook受信処理（デバウンス機能付き）
 */
async function handleWebhook(
  req: VercelRequest,
  res: VercelResponse
) {

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

    // デバウンス同期を実行（即座には同期せず、5分後にタイマーで実行）
    console.log(`📅 カレンダー変更検知: ${targetCalendar.name} (${calendarId})`);
    debouncedSync(calendarId, `webhook-${resourceState}`);

    const processingTime = Date.now() - startTime;

    console.log(`✅ Webhook処理完了 - デバウンスタイマー設定 (${processingTime}ms)`);

    // 成功レスポンス（同期は後でタイマーにより実行される）
    return res.status(200).json({
      success: true,
      message: 'Webhook受信完了 - デバウンス同期をスケジュール',
      data: {
        calendar: targetCalendar.name,
        calendarId: calendarId,
        resourceState: resourceState,
        debounceDelay: '5分',
        processingTime: `${processingTime}ms`
      },
    } as ApiResponse);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    
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