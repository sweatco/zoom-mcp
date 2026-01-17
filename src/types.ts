// Zoom API Types

export interface ZoomTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  expires_at?: number; // Unix timestamp when token expires
}

export interface ZoomUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  type: number;
  account_id: string;
}

export interface ZoomMeeting {
  uuid: string;
  id: number;
  topic: string;
  start_time: string;
  duration: number;
  host_id: string;
  type: number;
  timezone?: string;
}

export interface ZoomRecording {
  uuid: string;
  id: number;
  account_id: string;
  host_id: string;
  topic: string;
  start_time: string;
  duration: number;
  total_size: number;
  recording_count: number;
  share_url?: string;
  recording_files: ZoomRecordingFile[];
}

export interface ZoomRecordingFile {
  id: string;
  meeting_id: string;
  recording_start: string;
  recording_end: string;
  file_type: string;
  file_extension: string;
  file_size: number;
  play_url?: string;
  download_url?: string;
  status: string;
  recording_type: string;
}

export interface ZoomRecordingsResponse {
  from: string;
  to: string;
  page_size: number;
  next_page_token: string;
  meetings: ZoomRecording[];
}

export interface ZoomPastMeetingsResponse {
  from: string;
  to: string;
  page_size: number;
  next_page_token: string;
  meetings: ZoomMeeting[];
}

export interface ZoomPastMeetingDetails {
  uuid: string;
  id: number;
  host_id: string;
  type: number;
  topic: string;
  start_time: string;
  end_time: string;
  duration: number;
  total_minutes: number;
  participants_count: number;
}

export interface ZoomParticipant {
  id: string;
  user_id?: string;
  name: string;
  user_email?: string;
  join_time: string;
  leave_time: string;
  duration: number;
}

export interface ZoomParticipantsResponse {
  page_size: number;
  next_page_token: string;
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
  edited_summary?: ZoomEditedSummary;
}

export interface ZoomSummaryDetail {
  label: string;
  summary: string;
}

export interface ZoomEditedSummary {
  summary_overview?: string;
  summary_details?: ZoomSummaryDetail[];
  next_steps?: string[];
}

export interface ZoomMeetingInstance {
  uuid: string;
  start_time: string;
}

export interface ZoomTranscriptResponse {
  meeting_id: string;
  meeting_topic?: string;
  account_id?: string;
  host_id: string;
  transcript_created_time?: string;
  can_download?: boolean;
  auto_delete?: boolean;
  download_url?: string;
  // Downloaded content (added after fetching)
  transcript_text?: string;
}

// MCP Tool Response Types

export interface MeetingInfo {
  meeting_id: string;
  instance_uuid: string;
  topic: string;
  date: string;
  duration_minutes: number;
  has_recording: boolean;
  has_transcript: boolean;
  has_summary: boolean;
}

export interface TranscriptSegment {
  timestamp: string;
  speaker?: string;
  text: string;
}

export interface TranscriptResponse {
  meeting_id: string;
  topic: string;
  date: string;
  source: 'recording' | 'summary';
  transcript: string;
}

export interface SummaryResponse {
  meeting_id: string;
  topic: string;
  date: string;
  overview?: string;
  topics?: { label: string; summary: string }[];
  action_items?: string[];
  next_steps?: string[];
}

export interface MeetingDetailsResponse {
  meeting_id: string;
  uuid: string;
  topic: string;
  host_id: string;
  date: string;
  end_time: string;
  duration_minutes: number;
  participants_count: number;
  participants: {
    name: string;
    email?: string;
    duration_minutes: number;
  }[];
  has_recording: boolean;
  has_summary: boolean;
}

export interface SearchResult {
  meeting_id: string;
  uuid: string;
  topic: string;
  date: string;
  excerpts: string[];
  source: 'transcript' | 'summary';
}
