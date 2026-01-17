import { ZOOM_API_BASE_URL } from './auth/constants.js';
import { getValidAccessToken, refreshAccessToken } from './auth/oauth.js';
import { loadTokens, saveTokens, deleteTokens } from './auth/token-store.js';
import type {
  ZoomUser,
  ZoomRecording,
  ZoomRecordingsResponse,
  ZoomPastMeetingsResponse,
  ZoomPastMeetingDetails,
  ZoomParticipantsResponse,
  ZoomMeetingSummary,
  ZoomRecordingFile,
  ZoomMeetingInstance,
  ZoomTranscriptResponse,
} from './types.js';

class ZoomApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ZoomApiError';
  }
}

export class ZoomClient {
  private accessToken: string | null = null;

  private async getToken(): Promise<string> {
    if (!this.accessToken) {
      this.accessToken = await getValidAccessToken();
    }
    return this.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retry = true
  ): Promise<T> {
    const token = await this.getToken();
    const url = endpoint.startsWith('http') ? endpoint : `${ZOOM_API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Handle 401 - token might be expired
    if (response.status === 401 && retry) {
      // Try to refresh the token
      const tokens = await loadTokens();
      if (tokens?.refresh_token) {
        try {
          const newTokens = await refreshAccessToken(tokens.refresh_token);
          await saveTokens(newTokens);
          this.accessToken = newTokens.access_token;
          return this.request<T>(endpoint, options, false);
        } catch {
          // Refresh failed, need to re-auth
          await deleteTokens();
          this.accessToken = null;
          this.accessToken = await getValidAccessToken();
          return this.request<T>(endpoint, options, false);
        }
      }
    }

    if (!response.ok) {
      let errorMessage = `Zoom API error: ${response.status}`;
      let errorCode = 'unknown';

      try {
        const errorBody = await response.json();
        if (errorBody.message) errorMessage = errorBody.message;
        if (errorBody.code) errorCode = String(errorBody.code);
      } catch {
        // Couldn't parse error body
      }

      throw new ZoomApiError(response.status, errorCode, errorMessage);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  }

  // Get current user info
  async getCurrentUser(): Promise<ZoomUser> {
    return this.request<ZoomUser>('/users/me');
  }

  // List user's cloud recordings
  async listRecordings(
    from: string,
    to: string,
    pageSize = 30,
    nextPageToken?: string
  ): Promise<ZoomRecordingsResponse> {
    const params = new URLSearchParams({
      from,
      to,
      page_size: String(pageSize),
    });
    if (nextPageToken) {
      params.set('next_page_token', nextPageToken);
    }
    return this.request<ZoomRecordingsResponse>(`/users/me/recordings?${params}`);
  }

  // Get all recordings with pagination
  async getAllRecordings(from: string, to: string): Promise<ZoomRecording[]> {
    const allRecordings: ZoomRecording[] = [];
    let nextPageToken: string | undefined;

    do {
      const response = await this.listRecordings(from, to, 30, nextPageToken);
      allRecordings.push(...response.meetings);
      nextPageToken = response.next_page_token || undefined;
    } while (nextPageToken);

    return allRecordings;
  }

  // Get recording details for a specific meeting
  async getMeetingRecordings(meetingId: string): Promise<ZoomRecording> {
    // Meeting ID needs to be double-encoded if it contains /
    const encodedId = encodeURIComponent(encodeURIComponent(meetingId));
    return this.request<ZoomRecording>(`/meetings/${encodedId}/recordings`);
  }

  // Download a file (VTT transcript)
  async downloadFile(downloadUrl: string): Promise<string> {
    const token = await this.getToken();

    // Zoom download URLs need the access token as a query parameter
    const url = new URL(downloadUrl);
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new ZoomApiError(response.status, 'download_error', `Failed to download file: ${response.status}`);
    }

    return response.text();
  }

  // Get VTT transcript file from recording
  async getRecordingTranscript(meetingId: string): Promise<string | null> {
    try {
      const recording = await this.getMeetingRecordings(meetingId);

      // Find the VTT transcript file
      const vttFile = recording.recording_files.find(
        (file: ZoomRecordingFile) =>
          file.file_type === 'TRANSCRIPT' || file.file_extension === 'VTT'
      );

      if (!vttFile?.download_url) {
        return null;
      }

      return this.downloadFile(vttFile.download_url);
    } catch (error) {
      if (error instanceof ZoomApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // List past meetings (using previous_meetings type which returns all meetings user hosted)
  async listPastMeetings(
    from: string,
    to: string,
    pageSize = 30,
    nextPageToken?: string
  ): Promise<ZoomPastMeetingsResponse> {
    const params = new URLSearchParams({
      page_size: String(pageSize),
      type: 'previous_meetings',
      from,
      to,
    });
    if (nextPageToken) {
      params.set('next_page_token', nextPageToken);
    }
    return this.request<ZoomPastMeetingsResponse>(`/users/me/meetings?${params}`);
  }

  // List upcoming meetings
  async listUpcomingMeetings(
    pageSize = 30,
    nextPageToken?: string
  ): Promise<ZoomPastMeetingsResponse> {
    const params = new URLSearchParams({
      page_size: String(pageSize),
      type: 'upcoming',
    });
    if (nextPageToken) {
      params.set('next_page_token', nextPageToken);
    }
    return this.request<ZoomPastMeetingsResponse>(`/users/me/meetings?${params}`);
  }

  // List live meetings
  async listLiveMeetings(
    pageSize = 30,
    nextPageToken?: string
  ): Promise<ZoomPastMeetingsResponse> {
    const params = new URLSearchParams({
      page_size: String(pageSize),
      type: 'live',
    });
    if (nextPageToken) {
      params.set('next_page_token', nextPageToken);
    }
    return this.request<ZoomPastMeetingsResponse>(`/users/me/meetings?${params}`);
  }

  // Get past meeting details
  async getPastMeetingDetails(meetingId: string): Promise<ZoomPastMeetingDetails> {
    const encodedId = encodeURIComponent(encodeURIComponent(meetingId));
    return this.request<ZoomPastMeetingDetails>(`/past_meetings/${encodedId}`);
  }

  // Get meeting participants
  async getMeetingParticipants(meetingId: string): Promise<ZoomParticipantsResponse> {
    const encodedId = encodeURIComponent(encodeURIComponent(meetingId));
    return this.request<ZoomParticipantsResponse>(`/past_meetings/${encodedId}/participants`);
  }

  // Get meeting summary (AI Companion)
  async getMeetingSummary(meetingId: string): Promise<ZoomMeetingSummary | null> {
    try {
      const encodedId = encodeURIComponent(encodeURIComponent(meetingId));
      return await this.request<ZoomMeetingSummary>(`/meetings/${encodedId}/meeting_summary`);
    } catch (error) {
      // Summary not available (404) or scope not granted
      if (error instanceof ZoomApiError && (error.status === 404 || error.status === 403)) {
        return null;
      }
      throw error;
    }
  }

  // Check if meeting has a summary
  async hasMeetingSummary(meetingId: string): Promise<boolean> {
    const summary = await this.getMeetingSummary(meetingId);
    return summary !== null;
  }

  // Get meeting instances (past occurrences with their specific UUIDs)
  async getMeetingInstances(meetingId: string): Promise<ZoomMeetingInstance[]> {
    try {
      const encodedId = encodeURIComponent(encodeURIComponent(meetingId));
      const response = await this.request<{ meetings: ZoomMeetingInstance[] }>(
        `/past_meetings/${encodedId}/instances`
      );
      return response.meetings || [];
    } catch (error) {
      if (error instanceof ZoomApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  // Get AI Companion transcript (requires post-meeting instance UUID)
  async getAICompanionTranscript(meetingUuid: string, downloadContent = false): Promise<ZoomTranscriptResponse | null> {
    try {
      // UUID needs to be double-encoded if it contains / or starts with /
      const encodedId = encodeURIComponent(encodeURIComponent(meetingUuid));
      const response = await this.request<ZoomTranscriptResponse>(`/meetings/${encodedId}/transcript`);

      // Optionally download the actual transcript content
      if (downloadContent && response.download_url && response.can_download) {
        try {
          response.transcript_text = await this.downloadFile(response.download_url);
        } catch {
          // Download failed, but we still have metadata
        }
      }

      return response;
    } catch (error) {
      // Transcript not available (404) or error code 3322 (transcript doesn't exist)
      if (error instanceof ZoomApiError && (error.status === 404 || error.code === '3322')) {
        return null;
      }
      throw error;
    }
  }

  // Check if meeting has AI Companion transcript
  async hasAICompanionTranscript(meetingUuid: string): Promise<boolean> {
    const transcript = await this.getAICompanionTranscript(meetingUuid);
    return transcript !== null;
  }
}

// Singleton instance
let clientInstance: ZoomClient | null = null;

export function getZoomClient(): ZoomClient {
  if (!clientInstance) {
    clientInstance = new ZoomClient();
  }
  return clientInstance;
}
