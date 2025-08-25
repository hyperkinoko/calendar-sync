// デバウンスタイマー管理
// Webhook受信時に5分のデバウンス処理を行う

import { syncSingleCalendar } from './calendar-sync';

// タイマーをメモリで管理（Vercel Functionsは短時間実行のため適切）
const syncTimers = new Map<string, NodeJS.Timeout>();

// デバウンス設定
const DEBOUNCE_DELAY = 5 * 60 * 1000; // 5分
const MAX_WAIT_TIME = 30 * 60 * 1000; // 最大30分で必ず実行

// 各カレンダーの最初のWebhook受信時刻を記録
const firstWebhookTime = new Map<string, number>();

/**
 * デバウンス機能付きの同期実行
 * @param calendarId - 同期対象のカレンダーID
 * @param reason - 同期実行の理由（ログ用）
 */
export function debouncedSync(calendarId: string, reason: string = 'webhook') {
  const now = Date.now();
  
  console.log(`📨 Webhook受信: ${calendarId} (理由: ${reason})`);
  
  // 既存のタイマーをキャンセル
  if (syncTimers.has(calendarId)) {
    clearTimeout(syncTimers.get(calendarId)!);
    console.log(`⏹️ 既存タイマーをキャンセル: ${calendarId}`);
  } else {
    // 初回のWebhook受信時刻を記録
    firstWebhookTime.set(calendarId, now);
  }
  
  // 最大待機時間チェック
  const firstTime = firstWebhookTime.get(calendarId) || now;
  const waitedTime = now - firstTime;
  
  if (waitedTime >= MAX_WAIT_TIME) {
    // 最大待機時間を超えた場合は即座に同期実行
    console.log(`⚡ 最大待機時間(${MAX_WAIT_TIME/1000/60}分)到達 - 即座に同期実行: ${calendarId}`);
    executeSync(calendarId, '最大待機時間到達');
    return;
  }
  
  // 新しいタイマーをセット
  const remainingWait = Math.min(DEBOUNCE_DELAY, MAX_WAIT_TIME - waitedTime);
  
  const timer = setTimeout(() => {
    executeSync(calendarId, 'デバウンスタイマー満了');
  }, remainingWait);
  
  syncTimers.set(calendarId, timer);
  
  console.log(`⏰ 同期タイマー設定: ${calendarId} (${remainingWait/1000/60}分後に実行)`);
}

/**
 * 同期を実行してクリーンアップ
 * @param calendarId - 同期対象のカレンダーID  
 * @param reason - 実行理由
 */
async function executeSync(calendarId: string, reason: string) {
  try {
    console.log(`🚀 同期実行開始: ${calendarId} (理由: ${reason})`);
    
    // 該当カレンダーの同期を実行
    await syncSingleCalendar({ id: calendarId, name: getCalendarName(calendarId) });
    
    console.log(`✅ 同期完了: ${calendarId}`);
    
  } catch (error: any) {
    console.error(`❌ 同期エラー: ${calendarId}`, error.message);
  } finally {
    // クリーンアップ
    syncTimers.delete(calendarId);
    firstWebhookTime.delete(calendarId);
  }
}

/**
 * カレンダーIDから表示名を取得
 * @param calendarId - カレンダーID
 * @returns カレンダーの表示名
 */
function getCalendarName(calendarId: string): string {
  const config = {
    PRIVATE_CALENDAR_ID: process.env.PRIVATE_CALENDAR_ID,
    WORK_CALENDAR_ID: process.env.WORK_CALENDAR_ID,
  };
  
  if (calendarId === config.PRIVATE_CALENDAR_ID) {
    return 'プライベート';
  } else if (calendarId === config.WORK_CALENDAR_ID) {
    return '仕事';
  } else {
    return 'Unknown';
  }
}

/**
 * 全てのタイマーをキャンセル（緊急時用）
 */
export function cancelAllTimers() {
  console.log(`🛑 全タイマーキャンセル: ${syncTimers.size}個`);
  
  syncTimers.forEach((timer, calendarId) => {
    clearTimeout(timer);
    console.log(`   - ${calendarId}`);
  });
  
  syncTimers.clear();
  firstWebhookTime.clear();
}

/**
 * 現在のタイマー状況を取得
 * @returns タイマー状況の配列
 */
export function getTimerStatus() {
  const status: Array<{
    calendarId: string;
    calendarName: string;
    firstWebhookTime: Date;
    remainingTime: number;
  }> = [];
  
  const now = Date.now();
  
  firstWebhookTime.forEach((startTime, calendarId) => {
    const elapsed = now - startTime;
    const remaining = Math.max(0, DEBOUNCE_DELAY - elapsed);
    
    status.push({
      calendarId,
      calendarName: getCalendarName(calendarId),
      firstWebhookTime: new Date(startTime),
      remainingTime: Math.ceil(remaining / 1000 / 60) // 分単位
    });
  });
  
  return status;
}