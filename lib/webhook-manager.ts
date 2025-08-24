import { getCalendarClient, loadEnvConfig } from './google-auth';
import {
  getWebhookChannel,
  setWebhookChannel,
  deleteWebhookChannel,
} from './storage';
import { getSourceCalendars } from './calendar-sync';
import type { WebhookChannel } from '@/types';
import { randomUUID } from 'crypto';

// WebhookのURLを生成
export function getWebhookUrl(): string {
  const config = loadEnvConfig();
  
  // 開発環境とVercel本番環境の判定
  if (process.env.NODE_ENV === 'development') {
    // 開発環境ではngrokなどを想定
    return `${process.env.WEBHOOK_BASE_URL || 'https://your-ngrok-url.ngrok.io'}/api/webhook/calendar?token=${config.WEBHOOK_SECRET}`;
  } else {
    // Vercel本番環境
    return `${process.env.VERCEL_URL || 'https://your-app.vercel.app'}/api/webhook/calendar?token=${config.WEBHOOK_SECRET}`;
  }
}

// Webhookチャンネルを登録
export async function registerWebhook(calendarId: string): Promise<WebhookChannel | null> {
  const calendar = getCalendarClient();
  const config = loadEnvConfig();
  
  try {
    console.log(`🔗 Webhook登録開始: ${calendarId}`);
    
    const channelId = randomUUID();
    const webhookUrl = getWebhookUrl();
    
    console.log(`📡 Webhook URL: ${webhookUrl}`);
    
    const response = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: config.WEBHOOK_SECRET,
        params: {
          // TTL is optional, Google will choose a suitable default
          ttl: String(30 * 24 * 60 * 60), // 30日（秒単位）
        },
      },
    });

    const channel: WebhookChannel = {
      id: channelId,
      resourceId: response.data.resourceId!,
      resourceUri: response.data.resourceUri!,
      expiration: parseInt(response.data.expiration!) || Date.now() + 30 * 24 * 60 * 60 * 1000,
      token: config.WEBHOOK_SECRET,
      address: webhookUrl,
    };

    // ストレージに保存
    await setWebhookChannel(calendarId, channel);
    
    const expirationDate = new Date(channel.expiration).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
    });
    
    console.log(`✅ Webhook登録完了: ${channelId}`);
    console.log(`   - Resource ID: ${channel.resourceId}`);
    console.log(`   - 有効期限: ${expirationDate}`);
    
    return channel;
  } catch (error: any) {
    console.error(`❌ Webhook登録エラー (${calendarId}):`, error.message);
    
    if (error.code === 403) {
      console.error('権限エラー: Service Accountにカレンダーのリーダー権限以上が必要です');
    } else if (error.code === 404) {
      console.error('カレンダーが見つかりません: カレンダーIDを確認してください');
    } else if (error.message?.includes('webhookUrl')) {
      console.error('Webhook URLエラー: HTTPSで公開されたURLが必要です');
    }
    
    return null;
  }
}

// Webhookチャンネルを停止
export async function stopWebhook(calendarId: string): Promise<boolean> {
  const calendar = getCalendarClient();
  
  try {
    const channel = await getWebhookChannel(calendarId);
    if (!channel) {
      console.log(`⚠️ Webhookチャンネルが見つかりません: ${calendarId}`);
      return true;
    }

    console.log(`🛑 Webhook停止開始: ${channel.id}`);
    
    await calendar.channels.stop({
      requestBody: {
        id: channel.id,
        resourceId: channel.resourceId,
      },
    });

    // ストレージから削除
    await deleteWebhookChannel(calendarId);
    
    console.log(`✅ Webhook停止完了: ${channel.id}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Webhook停止エラー (${calendarId}):`, error.message);
    
    if (error.code === 404) {
      console.log(`⚠️ Webhookは既に無効です: ${calendarId}`);
      // ストレージからも削除
      await deleteWebhookChannel(calendarId);
      return true;
    }
    
    return false;
  }
}

// Webhookの有効期限をチェック
export async function isWebhookExpired(calendarId: string): Promise<boolean> {
  const channel = await getWebhookChannel(calendarId);
  
  if (!channel) {
    return true; // チャンネルがない場合は期限切れとして扱う
  }

  const now = Date.now();
  const expiration = channel.expiration;
  
  // 有効期限の1時間前に期限切れとして扱う（余裕をもって更新）
  const threshold = 60 * 60 * 1000; // 1時間
  
  return (expiration - now) <= threshold;
}

// Webhookを更新（古いものを停止して新しいものを登録）
export async function refreshWebhook(calendarId: string): Promise<WebhookChannel | null> {
  console.log(`🔄 Webhook更新開始: ${calendarId}`);
  
  // 既存のWebhookを停止
  await stopWebhook(calendarId);
  
  // 新しいWebhookを登録
  return await registerWebhook(calendarId);
}

// すべてのソースカレンダーのWebhookを登録
export async function registerAllWebhooks(): Promise<{
  success: boolean;
  results: Record<string, WebhookChannel | null>;
}> {
  const sourceCalendars = getSourceCalendars();
  const results: Record<string, WebhookChannel | null> = {};
  
  console.log(`\n🚀 全Webhook登録開始 (${sourceCalendars.length}個)`);
  
  let allSuccess = true;
  
  for (const calendar of sourceCalendars) {
    const channel = await registerWebhook(calendar.id);
    results[calendar.name] = channel;
    
    if (!channel) {
      allSuccess = false;
    }
  }

  console.log(`\n✨ 全Webhook登録完了: ${allSuccess ? '成功' : '一部失敗'}`);
  
  return {
    success: allSuccess,
    results,
  };
}

// 期限が近いWebhookをチェックして更新
export async function refreshExpiredWebhooks(): Promise<{
  refreshed: number;
  failed: number;
  results: Record<string, { refreshed: boolean; error?: string }>;
}> {
  const sourceCalendars = getSourceCalendars();
  const results: Record<string, { refreshed: boolean; error?: string }> = {};
  
  let refreshed = 0;
  let failed = 0;
  
  console.log(`\n🔍 期限切れWebhookのチェック開始`);
  
  for (const calendar of sourceCalendars) {
    try {
      const isExpired = await isWebhookExpired(calendar.id);
      
      if (isExpired) {
        console.log(`⏰ Webhook期限切れ検出: ${calendar.name}`);
        const newChannel = await refreshWebhook(calendar.id);
        
        if (newChannel) {
          results[calendar.name] = { refreshed: true };
          refreshed++;
        } else {
          results[calendar.name] = { refreshed: false, error: 'Webhook登録に失敗' };
          failed++;
        }
      } else {
        console.log(`✅ Webhook正常: ${calendar.name}`);
        results[calendar.name] = { refreshed: false };
      }
    } catch (error: any) {
      console.error(`❌ Webhook更新エラー (${calendar.name}):`, error.message);
      results[calendar.name] = { refreshed: false, error: error.message };
      failed++;
    }
  }

  console.log(`\n🔄 Webhook更新完了:`);
  console.log(`   - 更新済み: ${refreshed}個`);
  console.log(`   - 失敗: ${failed}個`);

  return {
    refreshed,
    failed,
    results,
  };
}

// Webhook情報をすべて表示
export async function listAllWebhooks(): Promise<Record<string, WebhookChannel | null>> {
  const sourceCalendars = getSourceCalendars();
  const webhooks: Record<string, WebhookChannel | null> = {};
  
  console.log(`\n📋 Webhook一覧:`);
  
  for (const calendar of sourceCalendars) {
    const channel = await getWebhookChannel(calendar.id);
    webhooks[calendar.name] = channel;
    
    if (channel) {
      const expirationDate = new Date(channel.expiration).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
      });
      const isExpired = await isWebhookExpired(calendar.id);
      
      console.log(`📡 ${calendar.name}:`);
      console.log(`   - Channel ID: ${channel.id}`);
      console.log(`   - 有効期限: ${expirationDate} ${isExpired ? '⚠️ 期限切れ' : '✅'}`);
    } else {
      console.log(`❌ ${calendar.name}: Webhookが登録されていません`);
    }
  }
  
  return webhooks;
}