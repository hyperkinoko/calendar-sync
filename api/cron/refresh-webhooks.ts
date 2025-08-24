import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadEnvConfig } from '@/lib/google-auth';
import { refreshExpiredWebhooks, listAllWebhooks } from '@/lib/webhook-manager';
import { withRetry, logError, measureTime } from '@/lib/error-handler';
import type { ApiResponse } from '@/types';

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
    console.log('⏰ Webhook更新Cron開始');
    
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

    // まず現在のWebhook状況を確認
    const currentWebhooks = await listAllWebhooks();
    const totalWebhooks = Object.keys(currentWebhooks).length;
    const activeWebhooks = Object.values(currentWebhooks).filter(w => w !== null).length;
    
    console.log(`📊 Webhook状況: ${activeWebhooks}/${totalWebhooks} アクティブ`);

    // 期限切れWebhookのチェックと更新（リトライ付き）
    const { result: refreshResult, duration } = await measureTime(
      'Webhook更新処理',
      () => withRetry(
        () => refreshExpiredWebhooks(),
        {
          maxAttempts: 3,
          baseDelay: 5000,
          maxDelay: 60000,
        }
      )
    );

    const processingTime = Date.now() - startTime;

    console.log(`✅ Webhook更新Cron完了 (${processingTime}ms):`);
    console.log(`   - 更新済み: ${refreshResult.refreshed}個`);
    console.log(`   - 失敗: ${refreshResult.failed}個`);

    // 統計情報を集計
    const statistics = {
      totalCalendars: totalWebhooks,
      activeWebhooks: activeWebhooks,
      refreshedWebhooks: refreshResult.refreshed,
      failedRefreshes: refreshResult.failed,
      duration: duration,
      processingTime: processingTime,
      timestamp: new Date().toISOString(),
    };

    // エラーがある場合は詳細をログ出力
    if (refreshResult.failed > 0) {
      console.error('⚠️ Webhook更新でエラーが発生:');
      Object.entries(refreshResult.results).forEach(([calendarName, result]) => {
        if (result.error) {
          console.error(`   - ${calendarName}: ${result.error}`);
        }
      });
    }

    // 本番環境では監視システムへ統計情報を送信（将来的な拡張）
    if (process.env.NODE_ENV === 'production') {
      console.log('📊 統計情報:', JSON.stringify(statistics, null, 2));
    }

    return res.status(200).json({
      success: true,
      message: `Webhook更新完了: ${refreshResult.refreshed}個更新, ${refreshResult.failed}個失敗`,
      data: {
        statistics,
        results: refreshResult.results,
      },
    } as ApiResponse);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    
    logError('Webhook更新Cron', error, {
      processingTime,
      headers: req.headers,
    });

    console.error(`❌ Webhook更新Cronエラー (${processingTime}ms):`, error.message);

    return res.status(500).json({
      success: false,
      error: 'Webhook更新でエラーが発生しました',
      message: error.message,
    } as ApiResponse);
  }
}