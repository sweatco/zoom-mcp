/**
 * Test script for Zoom Admin API access
 *
 * This script tests whether Server-to-Server OAuth with admin scopes
 * can access meetings hosted by other users in the account.
 *
 * Usage:
 *   1. Create .env file with admin credentials (see .env.example)
 *   2. Run: npx tsx scripts/test-admin-api.ts
 */

import 'dotenv/config';

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ADMIN_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_ADMIN_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_ADMIN_CLIENT_SECRET;

// Test meeting ID - one you attended but didn't host
const TEST_MEETING_ID = process.env.TEST_MEETING_ID || '00000000000';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

async function getS2SToken(): Promise<string> {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error(
      'Missing credentials. Set ZOOM_ADMIN_ACCOUNT_ID, ZOOM_ADMIN_CLIENT_ID, ZOOM_ADMIN_CLIENT_SECRET in .env'
    );
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: ZOOM_ACCOUNT_ID,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get S2S token: ${response.status} ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  console.log('✅ Got S2S OAuth token');
  console.log('   Scopes granted:');
  // Print scopes one per line for readability
  data.scope.split(' ').forEach((scope) => {
    console.log(`     - ${scope}`);
  });
  return data.access_token;
}

async function testEndpoint(
  token: string,
  name: string,
  url: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  console.log(`\n📡 Testing: ${name}`);
  console.log(`   URL: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.log(`   ❌ Failed: ${response.status}`);
      console.log(`   Error:`, JSON.stringify(data, null, 2));
      return { success: false, error: JSON.stringify(data) };
    }

    console.log(`   ✅ Success: ${response.status}`);
    return { success: true, data };
  } catch (error) {
    console.log(`   ❌ Error:`, error);
    return { success: false, error: String(error) };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Zoom Admin API Test Script');
  console.log('='.repeat(60));
  console.log(`\nTest Meeting ID: ${TEST_MEETING_ID}`);

  // Get token
  const token = await getS2SToken();

  const results: Record<string, { success: boolean; data?: unknown; error?: string }> = {};

  // Test 1: List users in account
  results['list_users'] = await testEndpoint(
    token,
    'List Users (user:read:admin)',
    'https://api.zoom.us/v2/users?page_size=10'
  );

  if (results['list_users'].success) {
    const users = results['list_users'].data as { users: { email: string; id: string }[] };
    console.log(
      '   Users:',
      users.users?.slice(0, 5).map((u) => u.email)
    );
  }

  // Test 2: Get meeting instances
  results['meeting_instances'] = await testEndpoint(
    token,
    'Get Meeting Instances (meeting:read:admin)',
    `https://api.zoom.us/v2/past_meetings/${TEST_MEETING_ID}/instances`
  );

  let instanceUuid: string | null = null;
  if (results['meeting_instances'].success) {
    const instances = results['meeting_instances'].data as {
      meetings: { uuid: string; start_time: string }[];
    };
    if (instances.meetings?.length > 0) {
      // Sort by start_time descending and get most recent instance
      const sorted = [...instances.meetings].sort(
        (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      );
      instanceUuid = sorted[0].uuid;
      console.log('   Most recent instance UUID:', instanceUuid);
      console.log('   Most recent date:', sorted[0].start_time);
      console.log('   Total instances:', instances.meetings.length);
    }
  }

  // Test 3: Get past meeting details (using instance UUID)
  if (instanceUuid) {
    const encodedUuid = encodeURIComponent(encodeURIComponent(instanceUuid));
    results['past_meeting_details'] = await testEndpoint(
      token,
      'Get Past Meeting Details (meeting:read:admin)',
      `https://api.zoom.us/v2/past_meetings/${encodedUuid}`
    );

    if (results['past_meeting_details'].success) {
      const details = results['past_meeting_details'].data as {
        topic: string;
        host_email: string;
        participants_count: number;
      };
      console.log('   Topic:', details.topic);
      console.log('   Host:', details.host_email);
      console.log('   Participants:', details.participants_count);
    }
  }

  // Test 4: Get meeting participants
  if (instanceUuid) {
    const encodedUuid = encodeURIComponent(encodeURIComponent(instanceUuid));
    results['meeting_participants'] = await testEndpoint(
      token,
      'Get Meeting Participants (meeting:read:list_past_participants:admin)',
      `https://api.zoom.us/v2/past_meetings/${encodedUuid}/participants`
    );

    if (results['meeting_participants'].success) {
      const participants = results['meeting_participants'].data as {
        participants: { name: string; user_email: string }[];
      };
      console.log(
        '   Participants:',
        participants.participants?.map((p) => p.user_email || p.name)
      );
    }
  }

  // Test 5: Get meeting summary
  if (instanceUuid) {
    const encodedUuid = encodeURIComponent(encodeURIComponent(instanceUuid));
    results['meeting_summary'] = await testEndpoint(
      token,
      'Get Meeting Summary (meeting_summary:read:admin)',
      `https://api.zoom.us/v2/meetings/${encodedUuid}/meeting_summary`
    );

    if (results['meeting_summary'].success) {
      const summary = results['meeting_summary'].data as {
        meeting_topic: string;
        summary_overview: string;
      };
      console.log('   Topic:', summary.meeting_topic);
      console.log(
        '   Overview:',
        summary.summary_overview?.slice(0, 100) + (summary.summary_overview?.length > 100 ? '...' : '')
      );
    }
  }

  // Test 6: Get meeting recordings
  if (instanceUuid) {
    const encodedUuid = encodeURIComponent(encodeURIComponent(instanceUuid));
    results['meeting_recordings'] = await testEndpoint(
      token,
      'Get Meeting Recordings (cloud_recording:read:admin)',
      `https://api.zoom.us/v2/meetings/${encodedUuid}/recordings`
    );

    if (results['meeting_recordings'].success) {
      const recordings = results['meeting_recordings'].data as {
        recording_files: { file_type: string; file_size: number }[];
      };
      console.log('   Recording files:', recordings.recording_files?.length || 0);
    }
  }

  // Test 7: List past meetings for a user (using report API)
  // Get a user ID from the list_users result
  let testUserId: string | null = null;
  if (results['list_users'].success) {
    const users = results['list_users'].data as { users: { email: string; id: string }[] };
    testUserId = users.users?.[0]?.id || null;
  }

  if (testUserId) {
    const reportFromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const reportToDate = new Date().toISOString().split('T')[0];

    results['user_past_meetings'] = await testEndpoint(
      token,
      'List User Past Meetings (report:read:list_history_meetings:admin)',
      `https://api.zoom.us/v2/report/users/${testUserId}/meetings?from=${reportFromDate}&to=${reportToDate}&page_size=30`
    );

    if (results['user_past_meetings'].success) {
      const report = results['user_past_meetings'].data as {
        meetings: { id: number; topic: string; start_time: string; participants: number }[];
      };
      console.log('   User meetings (last 30 days):', report.meetings?.length || 0);
      console.log('\n   Recent meetings:');
      report.meetings?.slice(0, 10).forEach((m, i) => {
        console.log(`     ${i + 1}. ${m.topic}`);
        console.log(`        Date: ${m.start_time} | Participants: ${m.participants}`);
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const successful = Object.entries(results).filter(([, r]) => r.success);
  const failed = Object.entries(results).filter(([, r]) => !r.success);

  console.log(`\n✅ Successful: ${successful.length}`);
  successful.forEach(([name]) => console.log(`   - ${name}`));

  console.log(`\n❌ Failed: ${failed.length}`);
  failed.forEach(([name, r]) => console.log(`   - ${name}: ${r.error?.slice(0, 100)}`));

  // Recommendations
  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(60));

  if (results['meeting_participants']?.success && results['meeting_summary']?.success) {
    console.log('\n✅ Admin API access confirmed!');
    console.log('   You can proceed with building the proxy architecture.');
    console.log('   Required scopes are working:');
    console.log('   - meeting:read:admin (or equivalent)');
    console.log('   - meeting:read:list_past_participants:admin');
    console.log('   - meeting_summary:read:admin');
  } else {
    console.log('\n⚠️  Some endpoints failed.');
    console.log('   Check that your S2S OAuth app has these scopes:');
    console.log('   - user:read:admin');
    console.log('   - meeting:read:admin');
    console.log('   - meeting:read:list_past_participants:admin');
    console.log('   - meeting_summary:read:admin');
    console.log('   - cloud_recording:read:admin');
    console.log('   - report:read:admin');
  }
}

main().catch(console.error);
