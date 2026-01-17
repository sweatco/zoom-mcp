/**
 * Zoom MCP Proxy Types
 */

// ============ Firestore Records ============

export interface MeetingParticipantRecord {
  // Identifiers
  instance_uuid: string; // Primary - used for API calls
  meeting_id: string; // Secondary - human readable

  // Meeting metadata
  topic: string;
  host_email?: string; // Optional - webhook may not include it
  start_time: string; // ISO timestamp
  end_time: string;
  duration_minutes: number;

  // Participant info
  participant_email: string; // Indexed for queries
  participant_name: string;

  // Feature availability
  has_summary: boolean;
  has_recording: boolean;

  // Record metadata
  indexed_at: string;
  source: 'webhook' | 'backfill' | 'preregistration' | 'manual_grant';
  granted_by?: string; // Admin email (for preregistration/manual_grant)
}

// ============ User Validation ============

export interface UserInfo {
  email: string;
  role_id: number;
  isAdmin: boolean; // role_id <= 1
}

// ============ Zoom Webhook Types ============

export interface ZoomWebhookEvent {
  event: string;
  event_ts: number;
  payload: {
    account_id: string;
    object: ZoomMeetingObject;
  };
}

export interface ZoomMeetingObject {
  id: string | number;
  uuid: string;
  topic: string;
  host_id: string;
  host_email?: string; // May not be present in webhook payload
  user_name?: string; // Host's display name
  start_time: string;
  end_time?: string;
  duration: number;
  participant?: ZoomWebhookParticipant[];
}

export interface ZoomWebhookParticipant {
  user_name: string;
  email?: string;
  user_id?: string;
  participant_uuid?: string;
}

// ============ Zoom API Types ============

export interface ZoomUserMeResponse {
  id: string;
  email: string;
  role_id: string;
  first_name: string;
  last_name: string;
  type: number;
}

export interface ZoomPastMeetingResponse {
  id: number;
  uuid: string;
  topic: string;
  host_id: string;
  host_email: string;
  start_time: string;
  end_time: string;
  duration: number;
  participants_count: number;
}

export interface ZoomParticipant {
  id?: string;
  name: string;
  user_email?: string;
  join_time: string;
  leave_time: string;
  duration: number;
  user_id?: string;
}

export interface ZoomParticipantsResponse {
  page_size: number;
  total_records: number;
  next_page_token?: string;
  participants: ZoomParticipant[];
}

export interface ZoomMeetingSummary {
  meeting_host_id: string;
  meeting_host_email: string;
  meeting_uuid: string;
  meeting_id: number;
  meeting_topic: string;
  meeting_start_time: string;
  meeting_end_time: string;
  summary_start_time: string;
  summary_end_time: string;
  summary_overview?: string;
  summary_details?: ZoomSummaryDetail[];
  next_steps?: string[];
  edited_summary?: {
    summary_overview?: string;
    summary_details?: ZoomSummaryDetail[];
    next_steps?: string[];
  };
}

export interface ZoomSummaryDetail {
  label: string;
  summary: string;
}

export interface ZoomRecordingFile {
  id: string;
  file_type: string;
  file_extension: string;
  download_url: string;
  status: string;
  recording_type: string;
}

export interface ZoomRecordingResponse {
  uuid: string;
  id: number;
  host_id: string;
  host_email: string;
  topic: string;
  start_time: string;
  duration: number;
  recording_files: ZoomRecordingFile[];
}

// ============ API Request/Response Types ============

export interface ListMeetingsRequest {
  from_date?: string; // YYYY-MM-DD, default: 30 days ago
  to_date?: string; // YYYY-MM-DD, default: today
  limit?: number; // default: 50
  // Admin-only parameters
  user_email?: string; // Query meetings for specific user
  all_meetings?: boolean; // Return all meetings, not filtered by participation
}

export interface ListMeetingsResponse {
  meetings: MeetingListItem[];
}

export interface MeetingListItem {
  instance_uuid: string;
  meeting_id: string;
  topic: string;
  date: string;
  duration_minutes: number;
  host_email?: string;
  has_summary: boolean;
  has_recording: boolean;
}

export interface GetContentRequest {
  instance_uuid: string;
}

export interface GetSummaryResponse {
  summary: ZoomMeetingSummary;
}

export interface GetTranscriptResponse {
  transcript: string;
  source: 'recording' | 'ai_summary';
}

// ============ Error Types ============

export interface ApiError {
  error: string;
  code?: string;
}
