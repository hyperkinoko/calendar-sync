#!/usr/bin/env tsx

import { syncAllCalendars } from '../lib/calendar-sync';
import { verifyAllCalendarAccess } from '../lib/google-auth';
import { measureTime } from '../lib/error-handler';

async function main() {
  console.log('🚀 手動同期スクリプト開始\n');

  try {
    // Step 1: カレンダーアクセス確認
    console.log('📋 カレンダーアクセス権限を確認中...');
    const { result: accessResult } = await measureTime(
      'アクセス権限確認',
      () => verifyAllCalendarAccess()
    );

    if (!accessResult.success) {
      console.error('\n❌ カレンダーアクセスエラー:');
      Object.entries(accessResult.results).forEach(([name, success]) => {
        console.log(`   ${success ? '✅' : '❌'} ${name}`);
      });
      process.exit(1);
    }

    console.log('✅ すべてのカレンダーアクセス確認完了\n');

    // Step 2: 同期実行
    console.log('🔄 カレンダー同期を実行中...');
    const { result: syncResult, duration } = await measureTime(
      '全カレンダー同期',
      () => syncAllCalendars()
    );

    // 結果表示
    console.log('\n🎉 同期完了:');
    console.log(`   ⏱️  処理時間: ${duration}ms`);
    console.log(`   ➕ 作成: ${syncResult.totalCreated}件`);
    console.log(`   🔄 更新: ${syncResult.totalUpdated}件`);
    console.log(`   🗑️  削除: ${syncResult.totalDeleted}件`);
    console.log(`   ❌ エラー: ${syncResult.totalErrors}件`);

    // カレンダー別の詳細結果
    if (Object.keys(syncResult.results).length > 0) {
      console.log('\n📊 カレンダー別結果:');
      Object.entries(syncResult.results).forEach(([calendarName, result]) => {
        console.log(`   📅 ${calendarName}:`);
        console.log(`      作成: ${result.created}, 更新: ${result.updated}, 削除: ${result.deleted}, エラー: ${result.errors.length}`);
        
        // エラー詳細
        if (result.errors.length > 0) {
          result.errors.forEach((error, index) => {
            console.log(`      ❌ ${index + 1}: ${error.error}`);
          });
        }
      });
    }

    if (syncResult.success) {
      console.log('\n✅ すべての同期が正常に完了しました');
      process.exit(0);
    } else {
      console.log('\n⚠️ 一部のエラーがありましたが、同期は完了しました');
      process.exit(0);
    }

  } catch (error: any) {
    console.error('\n❌ 手動同期でエラーが発生しました:');
    console.error(error.message);
    
    if (error.stack) {
      console.error('\nスタックトレース:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// スクリプトとして実行された場合のみmain関数を実行
if (require.main === module) {
  main().catch((error) => {
    console.error('予期せぬエラー:', error);
    process.exit(1);
  });
}