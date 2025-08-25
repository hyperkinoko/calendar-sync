import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadEnvConfig } from '@/lib/google-auth';
import { syncAllCalendars } from '@/lib/calendar-sync';
import type { ApiResponse } from '@/types';

/**
 * 週1回の定時同期Cronエンドポイント
 * 
 * Webhookで取りこぼしがあった場合のバックアップとして
 * 週1回全カレンダーの同期を実行する
 */
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
    console.log('📅 週次定時同期Cron開始');
    
    // 認証チェック
    const config = loadEnvConfig();
    const authHeader = req.headers.authorization;
    
    if (!authHeader || authHeader !== `Bearer ${config.CRON_SECRET}`) {
      console.error('❌ 不正な認証トークン');
      return res.status(401).json({
        success: false,
        error: '認証トークンが無効です',
      } as ApiResponse);
    }

    console.log('🔐 認証成功 - 週次同期を開始');

    // 全カレンダー同期実行
    const syncResult = await syncAllCalendars();

    const processingTime = Date.now() - startTime;

    console.log(`✅ 週次定時同期完了 (${processingTime}ms):`);
    console.log(`   - 合計作成: ${syncResult.totalCreated}件`);
    console.log(`   - 合計更新: ${syncResult.totalUpdated}件`);
    console.log(`   - 合計削除: ${syncResult.totalDeleted}件`);
    console.log(`   - 合計エラー: ${syncResult.totalErrors}件`);

    // 統計情報を集計
    const statistics = {
      success: syncResult.success,
      totalCreated: syncResult.totalCreated,
      totalUpdated: syncResult.totalUpdated,
      totalDeleted: syncResult.totalDeleted,
      totalErrors: syncResult.totalErrors,
      processingTime: processingTime,
      timestamp: new Date().toISOString(),
    };

    // カレンダー別の結果詳細
    const calendarResults = Object.entries(syncResult.results).map(([calendarName, result]) => ({
      calendar: calendarName,
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
      errors: result.errors.length
    }));

    // エラーがある場合は詳細をログ出力
    if (syncResult.totalErrors > 0) {
      console.error('⚠️ 同期処理でエラーが発生:');
      Object.entries(syncResult.results).forEach(([calendarName, result]) => {
        if (result.errors.length > 0) {
          console.error(`   ${calendarName}:`);
          result.errors.forEach(error => {
            console.error(`     - ${error.error}`);
          });
        }
      });
    }

    // 本番環境では監視システムへ統計情報を送信
    if (process.env.NODE_ENV === 'production') {
      console.log('📊 週次同期統計:', JSON.stringify(statistics, null, 2));
    }

    return res.status(200).json({
      success: true,
      message: `週次同期完了: ${syncResult.totalCreated + syncResult.totalUpdated + syncResult.totalDeleted}件処理, ${syncResult.totalErrors}件エラー`,
      data: {
        statistics,
        calendars: calendarResults,
      },
    } as ApiResponse);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    
    console.error(`❌ 週次定時同期エラー (${processingTime}ms):`, error.message);

    return res.status(500).json({
      success: false,
      error: '週次同期でエラーが発生しました',
      message: error.message,
      processingTime: processingTime
    } as ApiResponse);
  }
}