import 'dotenv/config';

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ADMIN_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_ADMIN_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_ADMIN_CLIENT_SECRET;

const MEETING_ID = process.argv[2];

if (!MEETING_ID) {
  console.log('Usage: npx tsx scripts/check-meeting.ts <meeting_id>');
  process.exit(1);
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

async function main() {
  const token = await getToken();
  console.log('✅ Got token\n');
  console.log(`Meeting ID: ${MEETING_ID}\n`);

  // Get meeting instances
  console.log('=== Meeting Instances ===');
  const instancesRes = await fetch(`https://api.zoom.us/v2/past_meetings/${MEETING_ID}/instances`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!instancesRes.ok) {
    console.log('Error:', instancesRes.status, await instancesRes.text());
    return;
  }

  const instances = (await instancesRes.json()) as { meetings: { uuid: string; start_time: string }[] };
  console.log(`Found ${instances.meetings?.length || 0} instances\n`);

  // Get the most recent instance
  if (!instances.meetings?.length) {
    console.log('No instances found');
    return;
  }

  const sorted = [...instances.meetings].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );
  const latestInstance = sorted[0];
  console.log(`Latest instance: ${latestInstance.start_time}`);
  console.log(`UUID: ${latestInstance.uuid}\n`);

  // Get meeting details
  const encodedUuid = encodeURIComponent(encodeURIComponent(latestInstance.uuid));

  console.log('=== Meeting Details ===');
  const detailsRes = await fetch(`https://api.zoom.us/v2/past_meetings/${encodedUuid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (detailsRes.ok) {
    const details = (await detailsRes.json()) as {
      topic: string;
      host_email: string;
      start_time: string;
      end_time: string;
      duration: number;
      participants_count: number;
    };
    console.log(`Topic: ${details.topic}`);
    console.log(`Host: ${details.host_email}`);
    console.log(`Start: ${details.start_time}`);
    console.log(`End: ${details.end_time}`);
    console.log(`Duration: ${details.duration} minutes`);
    console.log(`Participants count: ${details.participants_count}\n`);
  } else {
    console.log('Error getting details:', detailsRes.status);
  }

  // Get participants
  console.log('=== Participants ===');
  const participantsRes = await fetch(`https://api.zoom.us/v2/past_meetings/${encodedUuid}/participants?page_size=300`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (participantsRes.ok) {
    const data = (await participantsRes.json()) as {
      participants: {
        name: string;
        user_email: string;
        join_time: string;
        leave_time: string;
        duration: number;
      }[];
      total_records: number;
    };

    console.log(`Total records: ${data.total_records}\n`);

    // Dedupe by email (same person may join multiple times)
    const byEmail = new Map<string, { name: string; email: string; totalDuration: number }>();

    for (const p of data.participants) {
      const email = p.user_email || `no-email-${p.name}`;
      const existing = byEmail.get(email);
      if (existing) {
        existing.totalDuration += p.duration;
      } else {
        byEmail.set(email, {
          name: p.name,
          email: p.user_email || '(no email)',
          totalDuration: p.duration,
        });
      }
    }

    console.log(`Unique participants: ${byEmail.size}\n`);

    const sorted = [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const p of sorted) {
      const mins = Math.round(p.totalDuration / 60);
      console.log(`  ${p.name.padEnd(30)} ${p.email.padEnd(40)} ${mins} min`);
    }
  } else {
    console.log('Error getting participants:', participantsRes.status, await participantsRes.text());
  }
}

main().catch(console.error);
