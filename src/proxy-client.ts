/**
 * Proxy Client for Zoom MCP
 *
 * Calls the Cloud Functions proxy to access meetings the user attended
 * but didn't host. Falls back to direct Zoom API for hosted meetings.
 */

import { loadTokens } from './auth/token-store.js';
import type { MeetingInfo, SummaryResponse, TranscriptResponse, ZoomMeetingSummary } from './types.js';

// Proxy URL - this will be set to the Cloud Functions URL after deployment
// For now, it can be configured via environment variable
const PROXY_URL = process.env.ZOOM_PROXY_URL || '';

interface ProxyMeeting {
  instance_uuid: string;
  meeting_id: string;
  topic: string;
  date: string;
  duration_minutes: number;
  host_email: string;
  has_summary: boolean;
  has_recording: boolean;
}

interface ProxySummaryResponse {
  summary: ZoomMeetingSummary;
}

interface ProxyTranscriptResponse {
  transcript: string;
  source: 'recording' | 'ai_summary';
}

/**
 * Check if the proxy is configured
 */
export function isProxyConfigured(): boolean {
  return !!PROXY_URL;
}

/**
 * Get the user's access token for proxy requests
 */
async function getUserToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens?.access_token) {
    throw new Error('Not authenticated. Please run the MCP server to authenticate first.');
  }
  return tokens.access_token;
}

/**
 * Make a request to the proxy API
 */
async function proxyRequest<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!PROXY_URL) {
    throw new Error('Proxy not configured. Set ZOOM_PROXY_URL environment variable.');
  }

  const token = await getUserToken();

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action,
      ...body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Proxy error: ${response.status}`;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error) {
        errorMessage = errorJson.error;
      }
    } catch {
      // Use status-based message
    }

    throw new ProxyError(response.status, errorMessage);
  }

  return response.json() as Promise<T>;
}

export class ProxyError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

/**
 * List meetings from the proxy
 * Returns meetings where user was a participant (including those they didn't host)
 */
export async function listMeetingsFromProxy(
  fromDate: string,
  toDate: string,
  limit: number = 50
): Promise<MeetingInfo[]> {
  const response = await proxyRequest<{ meetings: ProxyMeeting[] }>('list-meetings', {
    from_date: fromDate,
    to_date: toDate,
    limit,
  });

  return response.meetings.map((m) => ({
    meeting_id: m.meeting_id,
    instance_uuid: m.instance_uuid,
    topic: m.topic,
    date: m.date,
    duration_minutes: m.duration_minutes,
    has_recording: m.has_recording,
    has_transcript: m.has_recording, // If there's a recording, there might be a transcript
    has_summary: m.has_summary,
  }));
}

/**
 * Get summary from the proxy
 */
export async function getSummaryFromProxy(instanceUuid: string): Promise<SummaryResponse> {
  const response = await proxyRequest<ProxySummaryResponse>('get-summary', {
    instance_uuid: instanceUuid,
  });

  const summary = response.summary;

  // Use edited summary if available, falling back to original
  const edited = summary.edited_summary;
  const overview = edited?.summary_overview || summary.summary_overview;
  const details = edited?.summary_details || summary.summary_details;
  const nextSteps = edited?.next_steps || summary.next_steps;

  // Extract action items from summary details
  const actionItems: string[] = [];
  const topics: { label: string; summary: string }[] = [];

  if (details) {
    for (const detail of details) {
      if (detail.label.toLowerCase().includes('action')) {
        const items = detail.summary
          .split(/[\n•\-\d+\.]+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        actionItems.push(...items);
      } else {
        topics.push({
          label: detail.label,
          summary: detail.summary,
        });
      }
    }
  }

  return {
    meeting_id: instanceUuid,
    topic: summary.meeting_topic,
    date: summary.meeting_start_time,
    overview: overview || undefined,
    topics: topics.length > 0 ? topics : undefined,
    action_items: actionItems.length > 0 ? actionItems : undefined,
    next_steps: nextSteps && nextSteps.length > 0 ? nextSteps : undefined,
  };
}

/**
 * Get transcript from the proxy
 */
export async function getTranscriptFromProxy(instanceUuid: string): Promise<TranscriptResponse> {
  const response = await proxyRequest<ProxyTranscriptResponse>('get-transcript', {
    instance_uuid: instanceUuid,
  });

  return {
    meeting_id: instanceUuid,
    topic: 'Meeting', // Topic not included in proxy response, will be set later if needed
    date: '',
    source: response.source === 'recording' ? 'recording' : 'summary',
    transcript: response.transcript,
  };
}
