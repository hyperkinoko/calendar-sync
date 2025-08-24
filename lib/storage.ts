import { kv } from '@vercel/kv';
import { createClient } from 'redis';
import type { WebhookChannel } from '@/types';
import { STORAGE_KEYS } from '@/types';

// Redis/KVクライアントのインターフェース
interface StorageClient {
  get<T = string>(key: string): Promise<T | null>;
  set<T = string>(key: string, value: T, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// 開発環境用のRedisクライアント
class RedisStorageClient implements StorageClient {
  private client: ReturnType<typeof createClient>;

  constructor() {
    this.client = createClient({
      url: process.env.KV_URL || 'redis://localhost:6379',
    });

    this.client.on('error', (err) => {
      console.error('Redis接続エラー:', err);
    });

    // 自動接続
    this.connect();
  }

  private async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async get<T = string>(key: string): Promise<T | null> {
    await this.connect();
    const value = await this.client.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set<T = string>(key: string, value: T, options?: { ex?: number }): Promise<void> {
    await this.connect();
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    
    if (options?.ex) {
      await this.client.setEx(key, options.ex, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async del(key: string): Promise<void> {
    await this.connect();
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    await this.connect();
    const result = await this.client.exists(key);
    return result === 1;
  }
}

// Vercel KVクライアント
class VercelKVStorageClient implements StorageClient {
  async get<T = string>(key: string): Promise<T | null> {
    try {
      const value = await kv.get<T>(key);
      return value;
    } catch (error) {
      console.error(`KV取得エラー (${key}):`, error);
      return null;
    }
  }

  async set<T = string>(key: string, value: T, options?: { ex?: number }): Promise<void> {
    try {
      if (options?.ex) {
        await kv.set(key, value, { ex: options.ex });
      } else {
        await kv.set(key, value);
      }
    } catch (error) {
      console.error(`KV保存エラー (${key}):`, error);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await kv.del(key);
    } catch (error) {
      console.error(`KV削除エラー (${key}):`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const value = await kv.exists(key);
      return value === 1;
    } catch (error) {
      console.error(`KV存在確認エラー (${key}):`, error);
      return false;
    }
  }
}

// ストレージクライアントの取得
let storageClient: StorageClient;

export function getStorageClient(): StorageClient {
  if (!storageClient) {
    // Vercel環境かローカル環境かを判定
    const isVercel = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
    
    if (isVercel) {
      console.log('Vercel KVを使用します');
      storageClient = new VercelKVStorageClient();
    } else {
      console.log('ローカルRedisを使用します');
      storageClient = new RedisStorageClient();
    }
  }
  
  return storageClient;
}

// 同期トークンの管理
export async function getSyncToken(calendarId: string): Promise<string | null> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.SYNC_TOKEN(calendarId);
  return await client.get<string>(key);
}

export async function setSyncToken(calendarId: string, token: string): Promise<void> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.SYNC_TOKEN(calendarId);
  await client.set(key, token);
}

// Webhookチャンネル情報の管理
export async function getWebhookChannel(calendarId: string): Promise<WebhookChannel | null> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.WEBHOOK_CHANNEL(calendarId);
  return await client.get<WebhookChannel>(key);
}

export async function setWebhookChannel(calendarId: string, channel: WebhookChannel): Promise<void> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.WEBHOOK_CHANNEL(calendarId);
  // 有効期限まで保存（最大30日）
  const ttl = Math.min(
    Math.floor((channel.expiration - Date.now()) / 1000),
    30 * 24 * 60 * 60
  );
  await client.set(key, channel, { ex: ttl });
}

export async function deleteWebhookChannel(calendarId: string): Promise<void> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.WEBHOOK_CHANNEL(calendarId);
  await client.del(key);
}

// イベントマッピングの管理
export async function getEventMapping(sourceCalendarId: string, sourceEventId: string): Promise<string | null> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.EVENT_MAPPING(sourceCalendarId, sourceEventId);
  return await client.get<string>(key);
}

export async function setEventMapping(
  sourceCalendarId: string,
  sourceEventId: string,
  targetEventId: string
): Promise<void> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.EVENT_MAPPING(sourceCalendarId, sourceEventId);
  // 90日間保存
  await client.set(key, targetEventId, { ex: 90 * 24 * 60 * 60 });
}

export async function deleteEventMapping(sourceCalendarId: string, sourceEventId: string): Promise<void> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.EVENT_MAPPING(sourceCalendarId, sourceEventId);
  await client.del(key);
}

// 最終同期時刻の管理
export async function getLastSync(calendarId: string): Promise<Date | null> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.LAST_SYNC(calendarId);
  const timestamp = await client.get<string>(key);
  return timestamp ? new Date(timestamp) : null;
}

export async function setLastSync(calendarId: string, date: Date = new Date()): Promise<void> {
  const client = getStorageClient();
  const key = STORAGE_KEYS.LAST_SYNC(calendarId);
  await client.set(key, date.toISOString());
}