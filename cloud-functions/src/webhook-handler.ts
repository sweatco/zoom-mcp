/**
 * Webhook Handler for Zoom meeting.ended events
 *
 * This handler:
 * 1. Validates the webhook signature
 * 2. Handles Zoom's endpoint URL validation challenge
 * 3. Processes meeting.ended events
 * 4. Stores participant records in Firestore
 */

import type { Request, Response } from '@google-cloud/functions-framework';
import type {
  ZoomWebhookEvent,
  ZoomWebhookParticipant,
  MeetingParticipantRecord,
} from './types.js';
import {
  validateWebhookSignature,
  createValidationResponse,
} from './utils/webhook-validation.js';
import { createParticipantRecordsBatch } from './utils/firestore.js';
import { getPastMeeting, getMeetingParticipants, checkUserExists } from './utils/admin-client.js';

const WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

interface ParticipantInfo {
  email: string;
  name: string;
  is_host: boolean;
}

/**
 * Main webhook handler function
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!WEBHOOK_SECRET_TOKEN) {
    console.error('Missing ZOOM_WEBHOOK_SECRET_TOKEN');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Get raw body for signature validation
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-zm-signature'] as string | undefined;
  const timestamp = req.headers['x-zm-request-timestamp'] as string | undefined;

  // Validate signature
  if (!validateWebhookSignature(signature, timestamp, rawBody, WEBHOOK_SECRET_TOKEN)) {
    console.error('Invalid webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = req.body as ZoomWebhookEvent & {
    event: string;
    payload?: {
      plainToken?: string;
    };
  };

  // Handle URL validation challenge
  if (event.event === 'endpoint.url_validation') {
    const plainToken = event.payload?.plainToken;
    if (plainToken) {
      const response = createValidationResponse(plainToken, WEBHOOK_SECRET_TOKEN);
      console.log('Responding to URL validation challenge');
      res.json(response);
      return;
    }
    res.status(400).json({ error: 'Missing plainToken' });
    return;
  }

  // Handle meeting.ended event
  if (event.event === 'meeting.ended') {
    try {
      await processMeetingEnded(event as ZoomWebhookEvent);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error processing meeting.ended:', error);
      res.status(500).json({ error: 'Failed to process event' });
    }
    return;
  }

  // Unknown event type
  console.log(`Ignoring unknown event type: ${event.event}`);
  res.status(200).json({ success: true, ignored: true });
}

/**
 * Process a meeting.ended webhook event
 */
async function processMeetingEnded(event: ZoomWebhookEvent): Promise<void> {
  const meeting = event.payload.object;
  const instanceUuid = meeting.uuid;
  const meetingId = String(meeting.id);

  console.log(`Processing meeting.ended: ${meeting.topic} (ID: ${meetingId}, UUID: ${instanceUuid})`);

  // Collect participants from webhook payload
  const participants = new Map<string, ParticipantInfo>();

  // Always add the host first (they should always have access)
  if (meeting.host_email) {
    participants.set(meeting.host_email.toLowerCase(), {
      email: meeting.host_email.toLowerCase(),
      name: meeting.user_name || 'Host',
      is_host: true,
    });
  }

  // Add participants from webhook payload
  for (const p of meeting.participant || []) {
    if (p.email) {
      const email = p.email.toLowerCase();
      const existing = participants.get(email);
      participants.set(email, {
        email,
        name: p.user_name || email.split('@')[0],
        is_host: existing?.is_host || false,
      });
    }
  }

  // Webhook payload might not include all participants
  // Fetch complete list from Zoom API
  try {
    const apiParticipants = await getMeetingParticipants(instanceUuid);
    for (const p of apiParticipants.participants) {
      if (p.user_email) {
        const email = p.user_email.toLowerCase();
        const existing = participants.get(email);
        participants.set(email, {
          email,
          name: p.name || email.split('@')[0],
          is_host: existing?.is_host || false,
        });
      }
    }
  } catch (error) {
    console.warn('Could not fetch participants from API, using webhook data only:', error);
  }

  console.log(`Found ${participants.size} unique participants`);

  // Get meeting details for additional metadata
  let hasSummary = false;
  let hasRecording = false;
  let endTime = meeting.end_time || new Date().toISOString();
  let durationMinutes = meeting.duration || 0;
  let hostEmail: string | undefined = meeting.host_email;

  try {
    const meetingDetails = await getPastMeeting(instanceUuid);
    endTime = meetingDetails.end_time || endTime;
    durationMinutes = meetingDetails.duration || durationMinutes;
    // Get host email from API if not in webhook
    if (!hostEmail && meetingDetails.host_email) {
      hostEmail = meetingDetails.host_email;
    }
    // We'll assume summary/recording might be available later
    // These could be checked separately, but for now we'll mark as potentially available
    hasSummary = true;
    hasRecording = true;
  } catch (error) {
    console.warn('Could not fetch meeting details:', error);
  }

  // Create participant records
  const records: MeetingParticipantRecord[] = [];
  const now = new Date().toISOString();

  for (const [, participant] of participants) {
    records.push({
      instance_uuid: instanceUuid,
      meeting_id: meetingId,
      topic: meeting.topic,
      host_email: hostEmail,
      start_time: meeting.start_time,
      end_time: endTime,
      duration_minutes: durationMinutes,
      participant_email: participant.email,
      participant_name: participant.name,
      has_summary: hasSummary,
      has_recording: hasRecording,
      indexed_at: now,
      source: 'webhook',
    });
  }

  // Write to Firestore
  await createParticipantRecordsBatch(records);
  console.log(`Stored ${records.length} participant records`);
}
