#!/usr/bin/env tsx

import { getCalendarClient, loadEnvConfig, verifyAllCalendarAccess } from '../lib/google-auth';
import { getSourceCalendars } from '../lib/calendar-sync';
import { randomUUID } from 'crypto';

/**
 * Google Calendar Webhook登録スクリプト
 * 
 * カレンダーの変更を検知するWebhookをGoogleに登録する
 * デバウンス機能付きのリアルタイム同期を実現
 */

interface WebhookChannel {
  id: string;
  resourceId: string;
  resourceUri: string;
  token: string;
  expiration: number;
}

async function setupWebhooks() {
  console.log('🔗 Google Calendar Webhook登録開始\n');

  try {
    // 環境設定の確認
    const config = loadEnvConfig();
    console.log('📋 設定確認:');
    console.log(`   - Webhook Secret: ${config.WEBHOOK_SECRET ? '✅ 設定済み' : '❌ 未設定'}`);
    console.log(`   - プライベートカレンダー: ${config.PRIVATE_CALENDAR_ID}`);
    console.log(`   - 仕事カレンダー: ${config.WORK_CALENDAR_ID}`);

    // カレンダーアクセス確認
    console.log('\n🔍 カレンダーアクセス確認中...');
    const accessResult = await verifyAllCalendarAccess();
    
    if (!accessResult.success) {
      console.error('\n❌ カレンダーアクセスに問題があります:');
      Object.entries(accessResult.results).forEach(([name, success]) => {
        console.log(`   ${success ? '✅' : '❌'} ${name}`);
      });
      process.exit(1);
    }

    console.log('✅ すべてのカレンダーアクセス確認完了\n');

    // Webhook URLの決定
    const webhookUrl = getWebhookUrl();
    console.log(`🌐 Webhook URL: ${webhookUrl}`);

    // 各カレンダーのWebhook登録
    const calendar = getCalendarClient();
    const sourceCalendars = getSourceCalendars();

    console.log('\n📡 Webhook登録中...');

    for (const sourceCalendar of sourceCalendars) {
      try {
        console.log(`\n📅 ${sourceCalendar.name} (${sourceCalendar.id}):`);

        // チャンネルIDの生成（カレンダー識別用）
        const channelId = `calendar-sync-${getCalendarType(sourceCalendar.id)}-${Date.now()}`;
        
        // Webhook登録
        const watchResponse = await calendar.events.watch({
          calendarId: sourceCalendar.id,
          requestBody: {
            id: channelId,
            type: 'web_hook',
            address: webhookUrl,
            token: config.WEBHOOK_SECRET,
            // 有効期限を設定（最大30日、ここでは7日に設定）
            expiration: (Date.now() + 7 * 24 * 60 * 60 * 1000).toString()
          }
        });

        const channel: WebhookChannel = {
          id: channelId,
          resourceId: watchResponse.data.resourceId!,
          resourceUri: watchResponse.data.resourceUri!,
          token: config.WEBHOOK_SECRET,
          expiration: parseInt(watchResponse.data.expiration!)
        };

        console.log('✅ Webhook登録成功:');
        console.log(`   - Channel ID: ${channel.id}`);
        console.log(`   - Resource ID: ${channel.resourceId}`);
        console.log(`   - 有効期限: ${new Date(channel.expiration).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

      } catch (error: any) {
        console.error(`❌ ${sourceCalendar.name}のWebhook登録エラー:`, error.message);
        if (error.response) {
          console.error('   Response:', JSON.stringify(error.response.data, null, 2));
        }
      }
    }

    console.log('\n🎉 Webhook登録処理完了');
    console.log('\n💡 テスト方法:');
    console.log('1. カレンダーで予定を追加・編集・削除');
    console.log('2. 5分後に自動で同期されることを確認');
    console.log(`3. ステータス確認: ${webhookUrl}?token=${config.WEBHOOK_SECRET}`);

  } catch (error: any) {
    console.error('\n❌ Webhook登録エラー:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

/**
 * Webhook URLの取得
 */
function getWebhookUrl(): string {
  // Vercel本番環境の判定
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/webhook/calendar`;
  }
  
  // 開発環境（ngrokなどの外部公開URLが必要）
  if (process.env.WEBHOOK_BASE_URL) {
    return `${process.env.WEBHOOK_BASE_URL}/api/webhook/calendar`;
  }
  
  throw new Error('本番環境ではVERCEL_URL、開発環境ではWEBHOOK_BASE_URLを設定してください');
}

/**
 * カレンダーIDからタイプを特定
 */
function getCalendarType(calendarId: string): string {
  const config = loadEnvConfig();
  
  if (calendarId === config.PRIVATE_CALENDAR_ID) {
    return 'private';
  } else if (calendarId === config.WORK_CALENDAR_ID) {
    return 'work';
  } else {
    return 'unknown';
  }
}

if (require.main === module) {
  setupWebhooks().catch((error) => {
    console.error('予期せぬエラー:', error);
    process.exit(1);
  });
}