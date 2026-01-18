/**
 * Backfill Script
 *
 * Imports historical meeting data from Zoom into Firestore.
 * Run locally with admin credentials to populate meeting_participants collection.
 *
 * Usage:
 *   npx tsx scripts/backfill.ts --from=2025-12-01 --to=2026-01-17
 *   npx tsx scripts/backfill.ts --from=2025-12-01 --to=2026-01-17 --dry-run
 *
 * Options:
 *   --dry-run  Test Zoom API connection without writing to Firestore
 *
 * Requires:
 *   - .env with ZOOM_ADMIN_ACCOUNT_ID, ZOOM_ADMIN_CLIENT_ID, ZOOM_ADMIN_CLIENT_SECRET
 *   - GOOGLE_APPLICATION_CREDENTIALS for Firestore access (or running on GCP) - not needed for --dry-run
 */

import 'dotenv/config';
import { Firestore } from '@google-cloud/firestore';
import { createHash } from 'crypto';

// Configuration
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ADMIN_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_ADMIN_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_ADMIN_CLIENT_SECRET;

// Rate limiting
const REQUESTS_PER_SECOND = 8; // Stay under 10 to be safe
const REQUEST_INTERVAL = 1000 / REQUESTS_PER_SECOND;

// Firestore
// ignoreUndefinedProperties allows optional fields (like host_email) to be omitted
const db = new Firestore({ ignoreUndefinedProperties: true });
const COLLECTION_NAME = 'meeting_participants';

// Types
interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  type: number;
}

interface Meeting {
  id: number;
  uuid: string;
  topic: string;
  host_email: string;
  start_time: string;
  end_time: string;
  duration: number;
  participants_count: number;
}

interface Participant {
  name: string;
  user_email?: string;
  join_time: string;
  leave_time: string;
  duration: number;
}

interface MeetingParticipantRecord {
  instance_uuid: string;
  meeting_id: string;
  topic: string;
  host_email?: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  participant_email: string;
  participant_name: string;
  has_summary: boolean;
  has_recording: boolean;
  indexed_at: string;
  source: 'webhook' | 'backfill' | 'preregistration' | 'manual_grant';
  granted_by?: string;
}

// Token management
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 60000) {
    return cachedToken;
  }

  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Missing Zoom admin credentials in environment');
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
    throw new Error(`Failed to get token: ${response.status}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiry = now + data.expires_in * 1000;

  return cachedToken;
}

// Rate-limited fetch
let lastRequestTime = 0;

async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_INTERVAL) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  const token = await getToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  // Handle rate limiting with exponential backoff
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
    console.log(`Rate limited, waiting ${retryAfter}s...`);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return rateLimitedFetch(url, options);
  }

  return response;
}

// Generate document ID
// UUID is sanitized to replace / with _ since Firestore interprets / as path separator
function generateDocumentId(instanceUuid: string, email: string): string {
  const sanitizedUuid = instanceUuid.replace(/\//g, '_');
  const emailHash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 8);
  return `${sanitizedUuid}_${emailHash}`;
}

// Get all users in the account
async function getAllUsers(): Promise<User[]> {
  const users: User[] = [];
  let nextPageToken: string | undefined;

  console.log('Fetching all users...');

  do {
    const url = new URL('https://api.zoom.us/v2/users');
    url.searchParams.set('page_size', '300');
    url.searchParams.set('status', 'active');
    if (nextPageToken) {
      url.searchParams.set('next_page_token', nextPageToken);
    }

    const response = await rateLimitedFetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }

    const data = (await response.json()) as {
      users: User[];
      next_page_token?: string;
    };

    users.push(...data.users);
    nextPageToken = data.next_page_token;

    console.log(`  Fetched ${users.length} users...`);
  } while (nextPageToken);

  console.log(`Found ${users.length} total users`);
  return users;
}

// Get meetings hosted by a user within a date range
async function getUserMeetings(userId: string, fromDate: string, toDate: string): Promise<Meeting[]> {
  const meetings: Meeting[] = [];

  // Report API has a 30-day limit per request
  const from = new Date(fromDate);
  const to = new Date(toDate);

  // Process in 30-day chunks
  let currentFrom = from;
  while (currentFrom < to) {
    const currentTo = new Date(Math.min(currentFrom.getTime() + 29 * 24 * 60 * 60 * 1000, to.getTime()));

    const url = new URL(`https://api.zoom.us/v2/report/users/${userId}/meetings`);
    url.searchParams.set('from', currentFrom.toISOString().split('T')[0]);
    url.searchParams.set('to', currentTo.toISOString().split('T')[0]);
    url.searchParams.set('page_size', '300');
    url.searchParams.set('type', 'past');

    let nextPageToken: string | undefined;

    do {
      if (nextPageToken) {
        url.searchParams.set('next_page_token', nextPageToken);
      }

      const response = await rateLimitedFetch(url.toString());

      if (response.status === 404) {
        // User has no meetings
        break;
      }

      if (!response.ok) {
        console.warn(`Failed to fetch meetings for ${userId}: ${response.status}`);
        break;
      }

      const data = (await response.json()) as {
        meetings: Meeting[];
        next_page_token?: string;
      };

      meetings.push(...(data.meetings || []));
      nextPageToken = data.next_page_token;
    } while (nextPageToken);

    currentFrom = new Date(currentTo.getTime() + 24 * 60 * 60 * 1000);
  }

  return meetings;
}

// Get participants for a meeting instance
async function getMeetingParticipants(instanceUuid: string): Promise<Participant[]> {
  const encodedUuid = encodeURIComponent(encodeURIComponent(instanceUuid));

  const response = await rateLimitedFetch(
    `https://api.zoom.us/v2/past_meetings/${encodedUuid}/participants?page_size=300`
  );

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    console.warn(`Failed to fetch participants for ${instanceUuid}: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as { participants: Participant[] };
  return data.participants || [];
}

// Create participant records in Firestore
async function createRecords(records: MeetingParticipantRecord[], dryRun: boolean): Promise<void> {
  if (records.length === 0) return;

  if (dryRun) {
    // In dry-run mode, just log what would be created
    return;
  }

  // Batch write (max 500 per batch)
  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = db.batch();
    const chunk = records.slice(i, i + batchSize);

    for (const record of chunk) {
      const docId = generateDocumentId(record.instance_uuid, record.participant_email);
      batch.set(db.collection(COLLECTION_NAME).doc(docId), record);
    }

    await batch.commit();
  }
}

// Main backfill function
async function backfill(fromDate: string, toDate: string, dryRun: boolean): Promise<void> {
  console.log(`\nStarting backfill from ${fromDate} to ${toDate}${dryRun ? ' (DRY RUN)' : ''}\n`);

  const users = await getAllUsers();

  // Sort users by email
  users.sort((a, b) => a.email.localeCompare(b.email));

  let totalMeetings = 0;
  let totalParticipants = 0;
  let processedUsers = 0;

  for (const user of users) {
    processedUsers++;
    const userPrefix = `[${processedUsers}/${users.length}] ${user.email}`;

    const meetings = await getUserMeetings(user.id, fromDate, toDate);

    if (meetings.length === 0) {
      console.log(`${userPrefix}: 0 meetings`);
      continue;
    }

    let userParticipants = 0;

    for (const meeting of meetings) {
      totalMeetings++;

      // Get participants
      const participants = await getMeetingParticipants(meeting.uuid);

      // Build participant map (dedupe by email)
      const participantMap = new Map<string, { email: string; name: string }>();

      // Always add host
      if (meeting.host_email) {
        participantMap.set(meeting.host_email.toLowerCase(), {
          email: meeting.host_email.toLowerCase(),
          name: user.first_name || meeting.host_email.split('@')[0],
        });
      }

      // Add all participants with email
      for (const p of participants) {
        if (p.user_email) {
          const email = p.user_email.toLowerCase();
          participantMap.set(email, {
            email,
            name: p.name || email.split('@')[0],
          });
        }
      }

      if (participantMap.size === 0) {
        continue;
      }

      // Create records
      const now = new Date().toISOString();
      const records: MeetingParticipantRecord[] = [];

      for (const [, participant] of participantMap) {
        records.push({
          instance_uuid: meeting.uuid,
          meeting_id: String(meeting.id),
          topic: meeting.topic,
          host_email: meeting.host_email,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          duration_minutes: meeting.duration,
          participant_email: participant.email,
          participant_name: participant.name,
          has_summary: true, // Assume available
          has_recording: true, // Assume available
          indexed_at: now,
          source: 'backfill',
        });
      }

      await createRecords(records, dryRun);
      totalParticipants += records.length;
      userParticipants += records.length;
    }

    console.log(`${userPrefix}: ${meetings.length} meetings, ${userParticipants} participants`);
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`Users processed: ${processedUsers}`);
  console.log(`Meetings found: ${totalMeetings}`);
  console.log(`Participant records created: ${totalParticipants}`);
}

// Parse command line arguments
function parseArgs(): { fromDate: string; toDate: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--from=')) {
      fromDate = arg.slice(7);
    } else if (arg.startsWith('--to=')) {
      toDate = arg.slice(5);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!fromDate || !toDate) {
    // Default: last 180 days
    const now = new Date();
    toDate = now.toISOString().split('T')[0];
    const past = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    fromDate = past.toISOString().split('T')[0];

    console.log('No date range specified, using last 180 days');
  }

  return { fromDate, toDate, dryRun };
}

// Main
const { fromDate, toDate, dryRun } = parseArgs();
backfill(fromDate, toDate, dryRun).catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
