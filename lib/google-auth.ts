import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { EnvConfig } from '@/types';

// 環境変数の検証とロード
export function loadEnvConfig(): EnvConfig {
  const requiredEnvVars = [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
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
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
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

// Google認証クライアントの作成
export function createAuthClient(): OAuth2Client {
  const config = loadEnvConfig();
  
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  });

  return auth;
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
    const calendar = getCalendarClient();
    
    // カレンダーの設定を取得してアクセス権限を確認
    await calendar.calendarList.get({
      calendarId,
    });
    
    console.log(`✅ カレンダーへのアクセス確認成功: ${calendarId}`);
    return true;
  } catch (error: any) {
    console.error(`❌ カレンダーへのアクセス確認失敗: ${calendarId}`, error.message);
    
    if (error.code === 404) {
      console.error('カレンダーが見つかりません。Service Accountに共有されているか確認してください。');
    } else if (error.code === 403) {
      console.error('権限がありません。Service AccountにカレンダーのWriter権限があるか確認してください。');
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