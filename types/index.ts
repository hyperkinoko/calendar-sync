// Google Calendar イベントの型定義
export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  colorId?: string;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: string;
      minutes: number;
    }>;
  };
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

// 同期イベントのメタデータ
export interface SyncMetadata {
  sourceCalendarId: string;
  sourceCalendarName: string;
  sourceEventId: string;
  syncedAt: string;
}

// Webhookチャンネル情報
export interface WebhookChannel {
  id: string;
  resourceId: string;
  resourceUri: string;
  expiration: number;
  token?: string;
  address: string;
}

// カレンダー設定
export interface CalendarConfig {
  id: string;
  name: string;
  type: 'source' | 'target';
}

// ストレージキーの定数
export const STORAGE_KEYS = {
  SYNC_TOKEN: (calendarId: string) => `sync_token:${calendarId}`,
  WEBHOOK_CHANNEL: (calendarId: string) => `webhook:${calendarId}`,
  EVENT_MAPPING: (sourceCalendarId: string, sourceEventId: string) => 
    `mapping:${sourceCalendarId}:${sourceEventId}`,
  LAST_SYNC: (calendarId: string) => `last_sync:${calendarId}`,
} as const;

// 環境変数の型定義
export interface EnvConfig {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  PROJECT_A_CALENDAR_ID: string;
  PRIVATE_CALENDAR_ID: string;
  WORK_CALENDAR_ID: string;
  WEBHOOK_SECRET: string;
  CRON_SECRET: string;
  KV_URL?: string;
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  KV_REST_API_READ_ONLY_TOKEN?: string;
}

// APIレスポンスの型定義
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 同期結果の型定義
export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: Array<{
    eventId?: string;
    error: string;
  }>;
}