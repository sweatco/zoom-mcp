/**
 * Check User Meetings Script
 *
 * Queries the Zoom Report API for meetings hosted by a user.
 *
 * Usage:
 *   npx tsx scripts/check-user-meetings.ts <email> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 */

import 'dotenv/config';

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ADMIN_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_ADMIN_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_ADMIN_CLIENT_SECRET;

// Parse args
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
let fromDate: string | undefined;
let toDate: string | undefined;

for (const arg of args) {
  if (arg.startsWith('--from=')) fromDate = arg.slice(7);
  if (arg.startsWith('--to=')) toDate = arg.slice(5);
}

if (!email) {
  console.log('Usage: npx tsx scripts/check-user-meetings.ts <email> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]');
  process.exit(1);
}

// Default: last 7 days
if (!toDate) toDate = new Date().toISOString().split('T')[0];
if (!fromDate) {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  fromDate = d.toISOString().split('T')[0];
}

async function getToken(): Promise<string> {
  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: ZOOM_ACCOUNT_ID!,
    }),
  });
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

interface Meeting {
  id: number;
  uuid: string;
  topic: string;
  start_time: string;
  end_time: string;
  duration: number;
  participants_count: number;
}

async function main() {
  const token = await getToken();
  console.log(`\nQuerying meetings for: ${email}`);
  console.log(`Date range: ${fromDate} to ${toDate}\n`);

  // First get user ID from email
  const userRes = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email!)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!userRes.ok) {
    console.log('Error getting user:', userRes.status, await userRes.text());
    return;
  }

  const user = (await userRes.json()) as { id: string; email: string; first_name: string; last_name: string };
  console.log(`User: ${user.first_name} ${user.last_name} (${user.email})`);
  console.log(`User ID: ${user.id}\n`);

  // Query meetings from Report API
  const url = new URL(`https://api.zoom.us/v2/report/users/${user.id}/meetings`);
  url.searchParams.set('from', fromDate!);
  url.searchParams.set('to', toDate!);
  url.searchParams.set('page_size', '300');
  url.searchParams.set('type', 'past');

  console.log(`=== Meetings Hosted by ${email} ===\n`);

  const meetingsRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!meetingsRes.ok) {
    console.log('Error:', meetingsRes.status, await meetingsRes.text());
    return;
  }

  const data = (await meetingsRes.json()) as { meetings: Meeting[]; total_records: number };
  console.log(`Total meetings: ${data.total_records}\n`);

  if (data.meetings.length === 0) {
    console.log('No meetings found in this date range.');
    return;
  }

  // Sort by date descending
  const sorted = [...data.meetings].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );

  for (const m of sorted) {
    const date = new Date(m.start_time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    console.log(`${date.padEnd(20)} ${m.topic.substring(0, 50).padEnd(52)} ${m.duration} min  ${m.participants_count} participants`);
  }

  console.log(`\n${sorted.length} meetings listed`);
}

main().catch(console.error);
