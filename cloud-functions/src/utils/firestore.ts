/**
 * Firestore helpers for meeting participants
 */

import { Firestore } from '@google-cloud/firestore';
import { createHash } from 'crypto';
import type { MeetingParticipantRecord, MeetingListItem } from '../types.js';

// Initialize Firestore (uses default credentials in GCP)
// ignoreUndefinedProperties allows optional fields to be omitted from documents
const db = new Firestore({
  ignoreUndefinedProperties: true,
});

const COLLECTION_NAME = 'meeting_participants';

/**
 * Generate a document ID for a participant record
 * Format: {sanitized_instance_uuid}_{sha256(email).slice(0,8)}
 *
 * UUID is sanitized to replace / with _ since Firestore interprets / as path separator
 */
export function generateDocumentId(instanceUuid: string, email: string): string {
  // Zoom UUIDs are base64-encoded and may contain / which Firestore treats as path separator
  const sanitizedUuid = instanceUuid.replace(/\//g, '_');
  const emailHash = createHash('sha256')
    .update(email.toLowerCase())
    .digest('hex')
    .slice(0, 8);
  return `${sanitizedUuid}_${emailHash}`;
}

/**
 * Create a participant record in Firestore
 */
export async function createParticipantRecord(
  record: MeetingParticipantRecord
): Promise<void> {
  const docId = generateDocumentId(record.instance_uuid, record.participant_email);
  await db.collection(COLLECTION_NAME).doc(docId).set(record);
}

/**
 * Create multiple participant records in a batch
 */
export async function createParticipantRecordsBatch(
  records: MeetingParticipantRecord[]
): Promise<void> {
  if (records.length === 0) return;

  // Firestore batch limit is 500
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

/**
 * Check if a participant record exists
 */
export async function participantRecordExists(
  instanceUuid: string,
  email: string
): Promise<boolean> {
  const docId = generateDocumentId(instanceUuid, email);
  const doc = await db.collection(COLLECTION_NAME).doc(docId).get();
  return doc.exists;
}

/**
 * Check if user participated in a specific meeting instance
 */
export async function checkParticipation(
  instanceUuid: string,
  email: string
): Promise<boolean> {
  return participantRecordExists(instanceUuid, email.toLowerCase());
}

/**
 * Query meetings by participant email within a date range
 */
export async function queryMeetingsByEmail(
  email: string,
  fromDate: string,
  toDate: string,
  limit: number = 50
): Promise<MeetingListItem[]> {
  // Convert dates to ISO format for comparison
  const fromIso = new Date(fromDate).toISOString();
  const toIso = new Date(toDate + 'T23:59:59.999Z').toISOString();

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('participant_email', '==', email.toLowerCase())
    .where('start_time', '>=', fromIso)
    .where('start_time', '<=', toIso)
    .orderBy('start_time', 'desc')
    .limit(limit)
    .get();

  const meetings: MeetingListItem[] = [];
  const seenUuids = new Set<string>();

  for (const doc of snapshot.docs) {
    const data = doc.data() as MeetingParticipantRecord;

    // Dedupe by instance_uuid (user might have multiple records for same meeting)
    if (seenUuids.has(data.instance_uuid)) {
      continue;
    }
    seenUuids.add(data.instance_uuid);

    meetings.push({
      instance_uuid: data.instance_uuid,
      meeting_id: data.meeting_id,
      topic: data.topic,
      date: data.start_time,
      duration_minutes: data.duration_minutes,
      host_email: data.host_email,
      has_summary: data.has_summary,
      has_recording: data.has_recording,
    });
  }

  return meetings;
}

/**
 * Query all meetings within a date range (admin only)
 */
export async function queryAllMeetings(
  fromDate: string,
  toDate: string,
  limit: number = 50
): Promise<MeetingListItem[]> {
  const fromIso = new Date(fromDate).toISOString();
  const toIso = new Date(toDate + 'T23:59:59.999Z').toISOString();

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('start_time', '>=', fromIso)
    .where('start_time', '<=', toIso)
    .orderBy('start_time', 'desc')
    .limit(limit * 10) // Fetch more since we dedupe
    .get();

  const meetings: MeetingListItem[] = [];
  const seenUuids = new Set<string>();

  for (const doc of snapshot.docs) {
    const data = doc.data() as MeetingParticipantRecord;

    if (seenUuids.has(data.instance_uuid)) {
      continue;
    }
    seenUuids.add(data.instance_uuid);

    meetings.push({
      instance_uuid: data.instance_uuid,
      meeting_id: data.meeting_id,
      topic: data.topic,
      date: data.start_time,
      duration_minutes: data.duration_minutes,
      host_email: data.host_email,
      has_summary: data.has_summary,
      has_recording: data.has_recording,
    });

    if (meetings.length >= limit) {
      break;
    }
  }

  return meetings;
}

/**
 * Delete records older than a cutoff date
 * Returns the number of records deleted
 */
export async function deleteOldRecords(cutoffDate: Date): Promise<number> {
  const cutoffIso = cutoffDate.toISOString();
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('start_time', '<', cutoffIso)
      .limit(500)
      .get();

    if (snapshot.empty) {
      hasMore = false;
      break;
    }

    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    totalDeleted += snapshot.size;
    console.log(`Deleted batch of ${snapshot.size} records, total: ${totalDeleted}`);

    // If we got fewer than 500, we're done
    if (snapshot.size < 500) {
      hasMore = false;
    }
  }

  return totalDeleted;
}

/**
 * Get the Firestore instance for direct access if needed
 */
export function getFirestore(): Firestore {
  return db;
}
