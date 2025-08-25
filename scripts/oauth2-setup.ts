#!/usr/bin/env tsx

import { google } from 'googleapis';
import { loadEnvConfig } from '../lib/google-auth';
import * as readline from 'readline';

async function setupOAuth2() {
  console.log('🔐 OAuth2初回認証セットアップ開始\n');

  try {
    const config = loadEnvConfig();

    // OAuth2クライアントの作成
    const oauth2Client = new google.auth.OAuth2({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: 'http://localhost:33000/auth/callback'
    });

    // 認証URLの生成
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ]
    });

    console.log('📋 以下のURLをブラウザで開いて認証を行ってください:');
    console.log(`\n${authUrl}\n`);
    console.log('認証後、リダイレクト先のURLからauthorization codeをコピーしてください。');
    console.log('例: http://localhost:33000/auth/callback?code=4/0AX4XfWh...');
    console.log('この部分をコピー: 4/0AX4XfWh...\n');

    // ユーザーからのコード入力を待つ
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const code = await new Promise<string>((resolve) => {
      rl.question('Authorization codeを入力してください: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    console.log('\n🔄 トークン取得中...');

    // トークンの取得
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('✅ トークン取得成功!\n');
    console.log('📝 以下の設定を.env.localに追加してください:');
    console.log(`GOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"`);
    
    // テスト用にトークンをセット
    oauth2Client.setCredentials(tokens);
    
    // カレンダーアクセステスト
    console.log('\n🔍 カレンダーアクセステスト:');
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    try {
      const list = await calendar.calendarList.list();
      console.log(`✅ アクセス可能なカレンダー数: ${list.data.items?.length || 0}個`);
      
      if (list.data.items && list.data.items.length > 0) {
        console.log('\n📋 カレンダー一覧:');
        list.data.items.forEach((cal, index) => {
          console.log(`   ${index + 1}. ${cal.summary} (${cal.id})`);
          if (cal.primary) console.log('      -> このカレンダーがプライマリです');
        });
      }
    } catch (error: any) {
      console.error('❌ カレンダーアクセステストエラー:', error.message);
    }

  } catch (error: any) {
    console.error('\n❌ OAuth2セットアップエラー:', error.message);
    if (error.response) {
      console.error('   Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  setupOAuth2().catch((error) => {
    console.error('予期せぬエラー:', error);
    process.exit(1);
  });
}