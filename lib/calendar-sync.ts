import { getCalendarClient, loadEnvConfig } from './google-auth';
import type { CalendarEvent, SyncResult, SyncMetadata } from '@/types';

// カレンダーの設定情報
export interface SourceCalendarConfig {
  id: string;
  name: string;
}

// 同期元カレンダーの設定を取得
export function getSourceCalendars(): SourceCalendarConfig[] {
  const config = loadEnvConfig();
  
  return [
    {
      id: config.PRIVATE_CALENDAR_ID,
      name: 'プライベート',
    },
    {
      id: config.WORK_CALENDAR_ID,
      name: '仕事',
    },
  ];
}

// 同期先カレンダーの設定を取得
export function getTargetCalendarId(): string {
  const config = loadEnvConfig();
  return config.PROJECT_A_CALENDAR_ID;
}

// 指定されたカレンダーのイベントを取得（増分同期対応）
export async function getCalendarEvents(
  calendarId: string,
  syncToken?: string | null
): Promise<{
  events: CalendarEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}> {
  const calendar = getCalendarClient();
  
  try {
    console.log(`📅 イベント取得開始: ${calendarId}`);
    if (syncToken) {
      console.log(`🔄 増分同期を使用: ${syncToken.substring(0, 20)}...`);
    } else {
      console.log(`🆕 初回同期を実行`);
    }

    const params: any = {
      calendarId,
      maxResults: 2500, // 最大取得件数
      singleEvents: true, // 繰り返しイベントを展開
      orderBy: 'startTime',
    };

    // 増分同期の場合
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      // 初回同期は1週間前〜未来90日の範囲で取得
      const now = new Date();
      const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      
      params.timeMin = timeMin.toISOString();
      params.timeMax = timeMax.toISOString();
    }

    const response = await calendar.events.list(params);
    
    const events = (response.data.items || [])
      .filter((event: any) => {
        // 全日イベント、または時間が指定されているイベントのみ
        if (!event.start || (!event.start.dateTime && !event.start.date)) {
          return false;
        }
        
        // 辞退したイベントは除外
        // attendeesの中で自分のresponseStatusがdeclinedの場合は除外
        if (event.attendees && Array.isArray(event.attendees)) {
          const selfAttendee = event.attendees.find((attendee: any) => attendee.self === true);
          if (selfAttendee && selfAttendee.responseStatus === 'declined') {
            console.log(`⏭️ 辞退したイベントをスキップ: ${event.summary}`);
            return false;
          }
        }
        
        return true;
      })
      .map((event: any): CalendarEvent => ({
        id: event.id,
        summary: event.summary || '無題のイベント',
        description: event.description,
        location: event.location,
        start: {
          dateTime: event.start.dateTime,
          date: event.start.date,
          timeZone: event.start.timeZone,
        },
        end: {
          dateTime: event.end.dateTime,
          date: event.end.date,
          timeZone: event.end.timeZone,
        },
        colorId: event.colorId,
        transparency: event.transparency,
        visibility: event.visibility,
      }));

    console.log(`✅ 取得完了: ${events.length}件のイベント`);
    
    return {
      events,
      nextSyncToken: response.data.nextSyncToken || undefined,
      nextPageToken: response.data.nextPageToken || undefined,
    };
  } catch (error: any) {
    console.error(`❌ イベント取得エラー (${calendarId}):`, error.message);
    
    // syncTokenが無効な場合は初回同期に切り替え
    if (error.code === 410 || error.message?.includes('Sync token is no longer valid')) {
      console.log('🔄 SyncTokenが無効です。初回同期に切り替えます。');
      return await getCalendarEvents(calendarId, null);
    }
    
    throw error;
  }
}

// 同期用のイベントオブジェクトを作成
export function createSyncEvent(
  sourceEvent: CalendarEvent,
  metadata: SyncMetadata
): CalendarEvent {
  const syncedAt = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return {
    summary: '🔒 予定あり',
    start: {
      dateTime: sourceEvent.start.dateTime,
      date: sourceEvent.start.date,
      timeZone: sourceEvent.start.timeZone,
    },
    end: {
      dateTime: sourceEvent.end.dateTime,
      date: sourceEvent.end.date,
      timeZone: sourceEvent.end.timeZone,
    },
    description: `[自動同期]
同期元: ${metadata.sourceCalendarName}
同期時刻: ${syncedAt}
同期元イベントID: ${metadata.sourceEventId}`,
    colorId: '8', // グレー色
    transparency: 'opaque', // 予定ありとして表示
    visibility: 'default',
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    reminders: {
      useDefault: false,
      overrides: [], // リマインダーなし
    },
    extendedProperties: {
      private: {
        sourceCalendarId: metadata.sourceCalendarId,
        sourceCalendarName: metadata.sourceCalendarName,
        sourceEventId: metadata.sourceEventId,
        syncedAt: metadata.syncedAt,
      },
    },
  };
}

// 同じ時間帯に既存のイベントがあるかチェック
async function checkForDuplicateEvent(
  event: CalendarEvent,
  targetCalendarId: string
): Promise<boolean> {
  const calendar = getCalendarClient();
  
  try {
    // イベントの開始・終了時間を取得
    const timeMin = event.start.dateTime || event.start.date;
    const timeMax = event.end.dateTime || event.end.date;
    
    if (!timeMin || !timeMax) {
      return false;
    }
    
    // 同じ時間帯のイベントを検索
    // 全日イベントの場合は日付形式で検索
    const searchParams: any = {
      calendarId: targetCalendarId,
      singleEvents: true,
      maxResults: 100,
    };
    
    // dateTimeがある場合（時刻指定イベント）
    if (event.start.dateTime) {
      searchParams.timeMin = timeMin;
      searchParams.timeMax = timeMax;
    } else {
      // 全日イベントの場合
      searchParams.timeMin = timeMin + 'T00:00:00Z';
      searchParams.timeMax = timeMax + 'T23:59:59Z';
    }
    
    const response = await calendar.events.list(searchParams);
    
    const existingEvents = response.data.items || [];
    
    // 同じ時間帯に同期イベントがあるかチェック
    for (const existingEvent of existingEvents) {
      // extendedPropertiesにsourceCalendarIdがある場合は同期で作成されたイベント
      if (existingEvent.extendedProperties?.private?.sourceCalendarId) {
        // 時間が重複しているかチェック
        const existingStart = existingEvent.start?.dateTime || existingEvent.start?.date;
        const existingEnd = existingEvent.end?.dateTime || existingEvent.end?.date;
        
        // 包含関係をチェック：既存イベントが新しいイベントを包含している場合
        // 既存の開始時刻 <= 新しい開始時刻 && 既存の終了時刻 >= 新しい終了時刻
        
        // 時刻指定イベントの場合
        if (event.start.dateTime && existingEvent.start?.dateTime) {
          const newStart = new Date(timeMin).getTime();
          const newEnd = new Date(timeMax).getTime();
          const existStart = new Date(existingStart!).getTime();
          const existEnd = new Date(existingEnd!).getTime();
          
          // 既存イベントが新しいイベントを包含している場合
          if (existStart <= newStart && existEnd >= newEnd) {
            const sourceCalendar = existingEvent.extendedProperties?.private?.sourceCalendarName || '不明';
            console.log(`⏭️ 重複イベントをスキップ: 既存の同期イベントに包含される（ソース: ${sourceCalendar}）`);
            return true;
          }
        } 
        // 全日イベントの場合は完全一致のみチェック
        else if (event.start.date && existingEvent.start?.date) {
          if (existingStart === timeMin && existingEnd === timeMax) {
            const sourceCalendar = existingEvent.extendedProperties?.private?.sourceCalendarName || '不明';
            console.log(`⏭️ 重複イベントをスキップ: 同じ日の同期済みイベント（ソース: ${sourceCalendar}）`);
            return true;
          }
        }
      }
    }
    
    return false;
  } catch (error: any) {
    console.error(`⚠️ 重複チェックエラー:`, error.message);
    return false; // エラーの場合は重複なしとして処理を続行
  }
}

// イベントを同期先カレンダーに作成
export async function createEventInTarget(
  event: CalendarEvent,
  targetCalendarId: string
): Promise<string> {
  const calendar = getCalendarClient();
  
  try {
    // 重複チェック
    const isDuplicate = await checkForDuplicateEvent(event, targetCalendarId);
    if (isDuplicate) {
      // 重複している場合は仮のIDを返す（マッピング保存用）
      return `duplicate_${Date.now()}`;
    }
    
    console.log(`📝 イベント作成: ${event.summary} (${event.start.dateTime || event.start.date})`);
    
    const response = await calendar.events.insert({
      calendarId: targetCalendarId,
      requestBody: event,
    });
    
    const createdEventId = response.data.id!;
    console.log(`✅ イベント作成完了: ${createdEventId}`);
    
    return createdEventId;
  } catch (error: any) {
    console.error(`❌ イベント作成エラー:`, error.message);
    throw error;
  }
}

// イベントを同期先カレンダーで更新
export async function updateEventInTarget(
  eventId: string,
  event: CalendarEvent,
  targetCalendarId: string
): Promise<void> {
  const calendar = getCalendarClient();
  
  try {
    console.log(`🔄 イベント更新: ${eventId}`);
    
    await calendar.events.update({
      calendarId: targetCalendarId,
      eventId: eventId,
      requestBody: event,
    });
    
    console.log(`✅ イベント更新完了: ${eventId}`);
  } catch (error: any) {
    console.error(`❌ イベント更新エラー (${eventId}):`, error.message);
    throw error;
  }
}

// イベントを同期先カレンダーから削除
export async function deleteEventFromTarget(
  eventId: string,
  targetCalendarId: string
): Promise<void> {
  const calendar = getCalendarClient();
  
  try {
    console.log(`🗑️ イベント削除: ${eventId}`);
    
    await calendar.events.delete({
      calendarId: targetCalendarId,
      eventId: eventId,
    });
    
    console.log(`✅ イベント削除完了: ${eventId}`);
  } catch (error: any) {
    if (error.code === 404) {
      console.log(`⚠️ 削除対象のイベントが見つかりません: ${eventId} (既に削除済み)`);
      return;
    }
    console.error(`❌ イベント削除エラー (${eventId}):`, error.message);
    throw error;
  }
}

// 単一カレンダーの同期処理
export async function syncSingleCalendar(
  sourceCalendarConfig: SourceCalendarConfig
): Promise<SyncResult> {
  const targetCalendarId = getTargetCalendarId();
  const syncResult: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  };

  try {
    console.log(`\n🔄 同期開始: ${sourceCalendarConfig.name} → プロジェクトA`);
    
    // 同期トークンは使用しない（ステートレス処理）
    
    // 同期範囲（1週間前〜90日後）で毎回全件取得
    const { events, nextSyncToken } = await getCalendarEvents(
      sourceCalendarConfig.id,
      null // syncTokenを使わずに毎回全件取得
    );

    // 各イベントを処理
    for (const event of events) {
      try {
        // イベントが削除されているかチェック
        if (event.summary === 'cancelled') {
          continue;
        }

        // 同期メタデータを作成
        const metadata: SyncMetadata = {
          sourceCalendarId: sourceCalendarConfig.id,
          sourceCalendarName: sourceCalendarConfig.name,
          sourceEventId: event.id!,
          syncedAt: new Date().toISOString(),
        };

        // 同期用イベントを作成
        const syncEvent = createSyncEvent(event, metadata);

        // 新規イベントを作成（重複チェックは内部で実施）
        const newEventId = await createEventInTarget(syncEvent, targetCalendarId);
        // 重複でスキップされた場合はカウントしない
        if (!newEventId.startsWith('duplicate_')) {
          syncResult.created++;
        }
      } catch (error: any) {
        console.error(`❌ イベント処理エラー (${event.id}):`, error.message);
        syncResult.errors.push({
          eventId: event.id,
          error: error.message,
        });
      }
    }

    // 同期完了（ステートレス処理のため保存処理なし）

    console.log(`✅ 同期完了: ${sourceCalendarConfig.name}`);
    console.log(`   - 作成: ${syncResult.created}件`);
    console.log(`   - 更新: ${syncResult.updated}件`);
    console.log(`   - 削除: ${syncResult.deleted}件`);
    console.log(`   - エラー: ${syncResult.errors.length}件`);

  } catch (error: any) {
    console.error(`❌ 同期プロセスエラー (${sourceCalendarConfig.name}):`, error.message);
    syncResult.errors.push({
      error: `同期プロセスエラー: ${error.message}`,
    });
  }

  return syncResult;
}

// 同期先カレンダーから古い「🔒 予定あり」イベントを削除
async function cleanupOldSyncEvents(targetCalendarId: string): Promise<number> {
  const calendar = getCalendarClient();
  let deletedCount = 0;
  
  try {
    console.log(`🧹 同期先カレンダーの古いイベントをクリーンアップ中...`);
    
    // 同期範囲と同じ期間のイベントを取得
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    const response = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      maxResults: 2500,
    });
    
    const events = response.data.items || [];
    
    // 同期で作成されたイベントを削除（extendedPropertiesで判定）
    for (const event of events) {
      if (event.extendedProperties?.private?.sourceCalendarId) {
        try {
          await calendar.events.delete({
            calendarId: targetCalendarId,
            eventId: event.id!,
          });
          deletedCount++;
        } catch (error: any) {
          if (error.code !== 404) {
            console.error(`削除エラー: ${event.id}`, error.message);
          }
        }
      }
    }
    
    if (deletedCount > 0) {
      console.log(`✅ ${deletedCount}件の古いイベントを削除しました`);
    }
    
  } catch (error: any) {
    console.error(`❌ クリーンアップエラー:`, error.message);
  }
  
  return deletedCount;
}

// すべてのソースカレンダーを同期
export async function syncAllCalendars(): Promise<{
  success: boolean;
  results: Record<string, SyncResult>;
  totalCreated: number;
  totalUpdated: number;
  totalDeleted: number;
  totalErrors: number;
}> {
  const sourceCalendars = getSourceCalendars();
  const targetCalendarId = getTargetCalendarId();
  const results: Record<string, SyncResult> = {};
  
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalErrors = 0;

  console.log(`\n🚀 全カレンダー同期開始 (${sourceCalendars.length}個)`);
  
  // クリーンアップは行わず、重複チェックのみで処理
  // const cleanedCount = await cleanupOldSyncEvents(targetCalendarId);
  
  for (const calendar of sourceCalendars) {
    const result = await syncSingleCalendar(calendar);
    results[calendar.name] = result;
    
    totalCreated += result.created;
    totalUpdated += result.updated;
    totalDeleted += result.deleted;
    totalErrors += result.errors.length;
  }

  const success = totalErrors === 0;
  
  console.log(`\n🎉 全同期完了:`);
  console.log(`   - 合計作成: ${totalCreated}件`);
  console.log(`   - 合計更新: ${totalUpdated}件`);
  console.log(`   - 合計削除: ${totalDeleted}件`);
  console.log(`   - 合計エラー: ${totalErrors}件`);

  return {
    success,
    results,
    totalCreated,
    totalUpdated,
    totalDeleted,
    totalErrors,
  };
}