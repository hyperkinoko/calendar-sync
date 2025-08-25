import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { EnvConfig } from '../types';

// 環境変数の検証とロード
export function loadEnvConfig(): EnvConfig {
  const requiredEnvVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'PROJECT_A_CALENDAR_ID',
    'PRIVATE_CALENDAR_ID',
    'WORK_CALENDAR_ID',
    'WEBHOOK_SECRET',
    'CRON_SECRET',
  ] as const;

  const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingVars.length > 0) {
    throw new Error(`必須の環境変数が設定されていません: ${missingVars.join(', ')}`);
  }

  return {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
    PROJECT_A_CALENDAR_ID: process.env.PROJECT_A_CALENDAR_ID!,
    PRIVATE_CALENDAR_ID: process.env.PRIVATE_CALENDAR_ID!,
    WORK_CALENDAR_ID: process.env.WORK_CALENDAR_ID!,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET!,
    CRON_SECRET: process.env.CRON_SECRET!,
    KV_URL: process.env.KV_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    KV_REST_API_READ_ONLY_TOKEN: process.env.KV_REST_API_READ_ONLY_TOKEN,
  };
}

// Google OAuth2認証クライアントの作成
export function createAuthClient(): OAuth2Client {
  const config = loadEnvConfig();
  
  const oauth2Client = new google.auth.OAuth2({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    redirectUri: 'http://localhost:33000/auth/callback'  // 初回認証用
  });

  // リフレッシュトークンがあればセット
  if (config.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: config.GOOGLE_REFRESH_TOKEN
    });
  }

  return oauth2Client;
}

// Google Calendar APIクライアントの取得
export function getCalendarClient() {
  const auth = createAuthClient();
  
  return google.calendar({
    version: 'v3',
    auth,
  });
}

// カレンダーへのアクセス権限を確認
export async function verifyCalendarAccess(calendarId: string): Promise<boolean> {
  try {
    console.log(`🔍 カレンダーアクセス確認開始: ${calendarId}`);
    
    const calendar = getCalendarClient();
    
    // 認証情報の確認
    const config = loadEnvConfig();
    console.log(`🔑 OAuth2 Client ID: ${config.GOOGLE_CLIENT_ID}`);
    console.log(`🔑 リフレッシュトークン設定済み: ${config.GOOGLE_REFRESH_TOKEN ? 'Yes' : 'No'}`);
    
    // カレンダーの設定を取得してアクセス権限を確認
    const response = await calendar.calendarList.get({
      calendarId,
    });
    
    console.log(`📊 カレンダー情報取得成功:`);
    console.log(`   - ID: ${response.data.id}`);
    console.log(`   - Summary: ${response.data.summary}`);
    console.log(`   - Access Role: ${response.data.accessRole}`);
    console.log(`   - Primary: ${response.data.primary}`);
    
    console.log(`✅ カレンダーへのアクセス確認成功: ${calendarId}`);
    return true;
  } catch (error: any) {
    console.error(`❌ カレンダーへのアクセス確認失敗: ${calendarId}`);
    console.error(`   エラーコード: ${error.code}`);
    console.error(`   エラーメッセージ: ${error.message}`);
    
    // 詳細なエラー情報
    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
      console.error(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
    }
    
    if (error.code === 404) {
      console.error('💡 解決方法: カレンダーが見つかりません。OAuth2認証でカレンダーにアクセス許可されているか確認してください。');
    } else if (error.code === 403) {
      console.error('💡 解決方法: 権限がありません。OAuth2でカレンダーのアクセス権限があるか確認してください。');
    } else if (error.code === 401) {
      console.error('💡 解決方法: 認証に失敗しました。OAuth2の設定を確認してください。');
      console.error('   - GOOGLE_CLIENT_ID が正しいか');
      console.error('   - GOOGLE_CLIENT_SECRET が正しいか');
      console.error('   - GOOGLE_REFRESH_TOKEN が有効か');
    }
    
    return false;
  }
}

// すべてのカレンダーへのアクセス権限を確認
export async function verifyAllCalendarAccess(): Promise<{
  success: boolean;
  results: Record<string, boolean>;
}> {
  const config = loadEnvConfig();
  
  const calendars = {
    'プライベート': config.PRIVATE_CALENDAR_ID,
    '仕事': config.WORK_CALENDAR_ID,
    'プロジェクトA': config.PROJECT_A_CALENDAR_ID,
  };

  const results: Record<string, boolean> = {};
  let allSuccess = true;

  for (const [name, id] of Object.entries(calendars)) {
    console.log(`\n${name}カレンダーの確認中...`);
    const success = await verifyCalendarAccess(id);
    results[name] = success;
    if (!success) {
      allSuccess = false;
    }
  }

  return {
    success: allSuccess,
    results,
  };
}