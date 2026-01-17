/**
 * Zoom Admin API Client
 *
 * Uses Server-to-Server OAuth to make admin-level API calls.
 * Handles token caching and automatic refresh.
 */

import type {
  ZoomMeetingSummary,
  ZoomPastMeetingResponse,
  ZoomParticipantsResponse,
  ZoomRecordingResponse,
} from '../types.js';

// Environment variables
const ZOOM_ADMIN_ACCOUNT_ID = process.env.ZOOM_ADMIN_ACCOUNT_ID;
const ZOOM_ADMIN_CLIENT_ID = process.env.ZOOM_ADMIN_CLIENT_ID;
const ZOOM_ADMIN_CLIENT_SECRET = process.env.ZOOM_ADMIN_CLIENT_SECRET;

// Token cache
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Get a Server-to-Server OAuth token with admin scopes
 * Caches the token until it's close to expiry
 */
export async function getAdminToken(): Promise<string> {
  // Return cached token if still valid (with 5 minute buffer)
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 5 * 60 * 1000) {
    return cachedToken;
  }

  if (!ZOOM_ADMIN_ACCOUNT_ID || !ZOOM_ADMIN_CLIENT_ID || !ZOOM_ADMIN_CLIENT_SECRET) {
    throw new Error('Missing Zoom admin credentials in environment');
  }

  const credentials = Buffer.from(
    `${ZOOM_ADMIN_CLIENT_ID}:${ZOOM_ADMIN_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: ZOOM_ADMIN_ACCOUNT_ID,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get admin token: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  };

  cachedToken = data.access_token;
  tokenExpiry = now + data.expires_in * 1000;

  return cachedToken;
}

/**
 * Double URL-encode a meeting instance UUID
 * Required for Zoom API when UUID contains / or =
 */
export function encodeInstanceUuid(uuid: string): string {
  return encodeURIComponent(encodeURIComponent(uuid));
}

/**
 * Get past meeting details
 */
export async function getPastMeeting(instanceUuid: string): Promise<ZoomPastMeetingResponse> {
  const token = await getAdminToken();
  const encodedUuid = encodeInstanceUuid(instanceUuid);

  const response = await fetch(`https://api.zoom.us/v2/past_meetings/${encodedUuid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get past meeting: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ZoomPastMeetingResponse>;
}

/**
 * Get meeting participants
 */
export async function getMeetingParticipants(
  instanceUuid: string
): Promise<ZoomParticipantsResponse> {
  const token = await getAdminToken();
  const encodedUuid = encodeInstanceUuid(instanceUuid);

  const response = await fetch(
    `https://api.zoom.us/v2/past_meetings/${encodedUuid}/participants?page_size=300`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get participants: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ZoomParticipantsResponse>;
}

/**
 * Get AI Companion meeting summary
 */
export async function getMeetingSummary(instanceUuid: string): Promise<ZoomMeetingSummary> {
  const token = await getAdminToken();
  const encodedUuid = encodeInstanceUuid(instanceUuid);

  const response = await fetch(
    `https://api.zoom.us/v2/meetings/${encodedUuid}/meeting_summary`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get meeting summary: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ZoomMeetingSummary>;
}

/**
 * Get meeting recordings (including transcript files)
 */
export async function getMeetingRecordings(instanceUuid: string): Promise<ZoomRecordingResponse> {
  const token = await getAdminToken();
  const encodedUuid = encodeInstanceUuid(instanceUuid);

  const response = await fetch(
    `https://api.zoom.us/v2/meetings/${encodedUuid}/recordings`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get recordings: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<ZoomRecordingResponse>;
}

/**
 * Download a transcript file from a recording
 */
export async function downloadTranscript(downloadUrl: string): Promise<string> {
  const token = await getAdminToken();

  // Zoom download URLs require the access_token as a query parameter
  const url = new URL(downloadUrl);
  url.searchParams.set('access_token', token);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to download transcript: ${response.status} - ${errorText}`);
  }

  return response.text();
}

/**
 * Check if a user exists in the Zoom account
 */
export async function checkUserExists(email: string): Promise<boolean> {
  const token = await getAdminToken();

  const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return response.ok;
}
