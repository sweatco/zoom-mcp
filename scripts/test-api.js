import { getZoomClient } from './dist/zoom-client.js';

const client = getZoomClient();

async function listAllMeetingTypes() {
  // Try different meeting types
  const types = ['scheduled', 'live', 'upcoming', 'previous_meetings', 'past'];

  for (const type of types) {
    console.log(`\n=== Type: ${type} ===`);
    try {
      const token = await client.getCurrentUser(); // Just to ensure we're authenticated

      const params = new URLSearchParams({
        page_size: '30',
        type: type,
      });

      const response = await fetch(`https://api.zoom.us/v2/users/me/meetings?${params}`, {
        headers: {
          Authorization: `Bearer ${(await import('./dist/auth/oauth.js')).getValidAccessToken ? await (await import('./dist/auth/oauth.js')).getValidAccessToken() : ''}`,
        },
      });

      if (!response.ok) {
        console.log(`  Error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      console.log(`  Total: ${data.total_records || data.meetings?.length || 0}`);

      if (data.meetings) {
        for (const m of data.meetings.slice(0, 10)) {
          console.log(`  - ${m.topic} (ID: ${m.id}) - ${m.start_time || 'no start time'}`);
        }
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

listAllMeetingTypes().catch(e => {
  console.error('Error:', e.message);
});
