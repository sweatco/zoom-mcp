/**
 * Check Firestore Records Script
 *
 * Queries Firestore for meeting participant records for a specific email.
 *
 * Usage:
 *   npx tsx scripts/check-firestore.ts <email> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 */

import 'dotenv/config';
import { Firestore } from '@google-cloud/firestore';

const db = new Firestore();
const COLLECTION_NAME = 'meeting_participants';

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
  console.log('Usage: npx tsx scripts/check-firestore.ts <email> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]');
  process.exit(1);
}

// Default: last 7 days
if (!toDate) toDate = new Date().toISOString().split('T')[0];
if (!fromDate) {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  fromDate = d.toISOString().split('T')[0];
}

async function main() {
  console.log(`\nQuerying Firestore for: ${email}`);
  console.log(`Date range: ${fromDate} to ${toDate}\n`);

  const fromIso = new Date(fromDate!).toISOString();
  const toIso = new Date(toDate + 'T23:59:59.999Z').toISOString();

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('participant_email', '==', email!.toLowerCase())
    .where('start_time', '>=', fromIso)
    .where('start_time', '<=', toIso)
    .orderBy('start_time', 'desc')
    .get();

  console.log(`=== Firestore Records for ${email} ===\n`);
  console.log(`Total records: ${snapshot.size}\n`);

  if (snapshot.empty) {
    console.log('No records found in this date range.');
    return;
  }

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const date = new Date(data.start_time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    console.log(
      `${date.padEnd(20)} ${(data.topic || 'No topic').substring(0, 50).padEnd(52)} ${data.duration_minutes} min  source: ${data.source}`
    );
  }

  console.log(`\n${snapshot.size} records listed`);
}

main().catch(console.error);
