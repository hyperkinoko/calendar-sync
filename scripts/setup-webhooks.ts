#!/usr/bin/env tsx

import { registerAllWebhooks, listAllWebhooks, refreshExpiredWebhooks } from '../lib/webhook-manager';
import { verifyAllCalendarAccess } from '../lib/google-auth';
import { measureTime } from '../lib/error-handler';

// コマンドライン引数を解析
const args = process.argv.slice(2);
const command = args[0] || 'setup';

async function setupWebhooks() {
  console.log('🔗 Webhook登録スクリプト開始\n');

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

    // Step 2: Webhook登録
    console.log('🔗 Webhook登録中...');
    const { result: webhookResult, duration } = await measureTime(
      'Webhook登録',
      () => registerAllWebhooks()
    );

    // 結果表示
    console.log(`\n🎉 Webhook登録完了 (${duration}ms):`);
    
    const successCount = Object.values(webhookResult.results).filter(r => r !== null).length;
    const totalCount = Object.keys(webhookResult.results).length;
    
    console.log(`   ✅ 成功: ${successCount}/${totalCount}個`);

    // 詳細結果
    console.log('\n📊 登録結果:');
    Object.entries(webhookResult.results).forEach(([calendarName, channel]) => {
      if (channel) {
        const expirationDate = new Date(channel.expiration).toLocaleString('ja-JP', {
          timeZone: 'Asia/Tokyo',
        });
        console.log(`   ✅ ${calendarName}:`);
        console.log(`      Channel ID: ${channel.id}`);
        console.log(`      有効期限: ${expirationDate}`);
      } else {
        console.log(`   ❌ ${calendarName}: 登録失敗`);
      }
    });

    if (webhookResult.success) {
      console.log('\n✅ すべてのWebhook登録が正常に完了しました');
    } else {
      console.log('\n⚠️ 一部のWebhook登録に失敗しました');
    }

  } catch (error: any) {
    console.error('\n❌ Webhook登録でエラーが発生しました:');
    console.error(error.message);
    process.exit(1);
  }
}

async function listWebhooks() {
  console.log('📋 Webhook状況確認\n');

  try {
    await listAllWebhooks();
  } catch (error: any) {
    console.error('\n❌ Webhook状況確認でエラーが発生しました:');
    console.error(error.message);
    process.exit(1);
  }
}

async function refreshWebhooks() {
  console.log('🔄 Webhook更新スクリプト開始\n');

  try {
    console.log('🔍 期限切れWebhookをチェック中...');
    const { result: refreshResult, duration } = await measureTime(
      'Webhook更新',
      () => refreshExpiredWebhooks()
    );

    console.log(`\n🎉 Webhook更新完了 (${duration}ms):`);
    console.log(`   🔄 更新: ${refreshResult.refreshed}個`);
    console.log(`   ❌ 失敗: ${refreshResult.failed}個`);

    // 詳細結果
    console.log('\n📊 更新結果:');
    Object.entries(refreshResult.results).forEach(([calendarName, result]) => {
      if (result.refreshed) {
        console.log(`   🔄 ${calendarName}: 更新しました`);
      } else if (result.error) {
        console.log(`   ❌ ${calendarName}: ${result.error}`);
      } else {
        console.log(`   ✅ ${calendarName}: 更新不要`);
      }
    });

  } catch (error: any) {
    console.error('\n❌ Webhook更新でエラーが発生しました:');
    console.error(error.message);
    process.exit(1);
  }
}

function showHelp() {
  console.log('📖 Webhook管理スクリプト\n');
  console.log('使用方法:');
  console.log('  npm run setup:webhooks [コマンド]\n');
  console.log('コマンド:');
  console.log('  setup     - 新規Webhook登録 (デフォルト)');
  console.log('  list      - 現在のWebhook状況を表示');
  console.log('  refresh   - 期限切れWebhookを更新');
  console.log('  help      - このヘルプを表示\n');
  console.log('例:');
  console.log('  npm run setup:webhooks setup');
  console.log('  npm run setup:webhooks list');
  console.log('  npm run setup:webhooks refresh');
}

async function main() {
  switch (command.toLowerCase()) {
    case 'setup':
      await setupWebhooks();
      break;
    case 'list':
      await listWebhooks();
      break;
    case 'refresh':
      await refreshWebhooks();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`❌ 不明なコマンド: ${command}`);
      showHelp();
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