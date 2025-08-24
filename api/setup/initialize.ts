import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadEnvConfig, verifyAllCalendarAccess } from '@/lib/google-auth';
import { registerAllWebhooks, listAllWebhooks } from '@/lib/webhook-manager';
import { syncAllCalendars } from '@/lib/calendar-sync';
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
    console.log('🚀 システム初期化開始');
    
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

    const initResults = {
      calendarAccess: false,
      initialSync: false,
      webhookRegistration: false,
      errors: [] as string[],
    };

    // Step 1: カレンダーアクセス権限の確認
    console.log('\n📋 Step 1: カレンダーアクセス権限の確認');
    try {
      const { result: accessResult } = await measureTime(
        'カレンダーアクセス確認',
        () => verifyAllCalendarAccess()
      );
      
      initResults.calendarAccess = accessResult.success;
      
      if (!accessResult.success) {
        const failedCalendars = Object.entries(accessResult.results)
          .filter(([_, success]) => !success)
          .map(([name, _]) => name);
        
        const errorMessage = `カレンダーアクセスエラー: ${failedCalendars.join(', ')}`;
        initResults.errors.push(errorMessage);
        console.error(`❌ ${errorMessage}`);
      } else {
        console.log('✅ すべてのカレンダーへのアクセス確認完了');
      }
    } catch (error: any) {
      const errorMessage = `カレンダーアクセス確認エラー: ${error.message}`;
      initResults.errors.push(errorMessage);
      console.error(`❌ ${errorMessage}`);
    }

    // Step 2: 初回同期の実行
    console.log('\n🔄 Step 2: 初回同期の実行');
    try {
      const { result: syncResult } = await measureTime(
        '初回同期',
        () => withRetry(
          () => syncAllCalendars(),
          {
            maxAttempts: 3,
            baseDelay: 5000,
            maxDelay: 60000,
          }
        )
      );

      initResults.initialSync = syncResult.success;
      
      if (syncResult.success) {
        console.log(`✅ 初回同期完了:`);
        console.log(`   - 作成: ${syncResult.totalCreated}件`);
        console.log(`   - 更新: ${syncResult.totalUpdated}件`);
        console.log(`   - 削除: ${syncResult.totalDeleted}件`);
      } else {
        const errorMessage = `初回同期でエラー発生: ${syncResult.totalErrors}件`;
        initResults.errors.push(errorMessage);
        console.error(`❌ ${errorMessage}`);
      }
    } catch (error: any) {
      const errorMessage = `初回同期エラー: ${error.message}`;
      initResults.errors.push(errorMessage);
      console.error(`❌ ${errorMessage}`);
    }

    // Step 3: Webhook登録
    console.log('\n🔗 Step 3: Webhook登録');
    try {
      const { result: webhookResult } = await measureTime(
        'Webhook登録',
        () => withRetry(
          () => registerAllWebhooks(),
          {
            maxAttempts: 3,
            baseDelay: 3000,
            maxDelay: 30000,
          }
        )
      );

      initResults.webhookRegistration = webhookResult.success;
      
      if (webhookResult.success) {
        console.log('✅ すべてのWebhook登録完了');
        
        // 登録されたWebhookの詳細を表示
        await listAllWebhooks();
      } else {
        const failedWebhooks = Object.entries(webhookResult.results)
          .filter(([_, result]) => result === null)
          .map(([name, _]) => name);
        
        const errorMessage = `Webhook登録失敗: ${failedWebhooks.join(', ')}`;
        initResults.errors.push(errorMessage);
        console.error(`❌ ${errorMessage}`);
      }
    } catch (error: any) {
      const errorMessage = `Webhook登録エラー: ${error.message}`;
      initResults.errors.push(errorMessage);
      console.error(`❌ ${errorMessage}`);
    }

    const processingTime = Date.now() - startTime;
    const overallSuccess = initResults.calendarAccess && 
                          initResults.initialSync && 
                          initResults.webhookRegistration;

    console.log(`\n🎉 システム初期化完了 (${processingTime}ms)`);
    console.log(`結果: ${overallSuccess ? '成功' : '一部失敗'}`);
    
    if (initResults.errors.length > 0) {
      console.error('発生したエラー:');
      initResults.errors.forEach((error, index) => {
        console.error(`  ${index + 1}. ${error}`);
      });
    }

    // ヘルスチェック情報も含める
    const healthInfo = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      version: process.env.npm_package_version || 'unknown',
      uptime: process.uptime(),
    };

    return res.status(overallSuccess ? 200 : 207).json({
      success: overallSuccess,
      message: overallSuccess 
        ? 'システム初期化が正常に完了しました' 
        : `システム初期化が部分的に完了しました（${initResults.errors.length}件のエラー）`,
      data: {
        results: initResults,
        processingTime,
        health: healthInfo,
      },
    } as ApiResponse);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    
    logError('システム初期化', error, {
      processingTime,
      headers: req.headers,
    });

    console.error(`❌ システム初期化エラー (${processingTime}ms):`, error.message);

    return res.status(500).json({
      success: false,
      error: 'システム初期化でエラーが発生しました',
      message: error.message,
    } as ApiResponse);
  }
}