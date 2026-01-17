import { z } from 'zod';
import { getZoomClient } from '../zoom-client.js';
import type { MeetingDetailsResponse } from '../types.js';

export const getMeetingSchema = z.object({
  instance_uuid: z
    .string()
    .describe('Meeting instance UUID from list_meetings.'),
});

export type GetMeetingInput = z.infer<typeof getMeetingSchema>;

export async function getMeeting(input: GetMeetingInput): Promise<MeetingDetailsResponse> {
  const client = getZoomClient();
  const instanceUuid = input.instance_uuid;

  // Get meeting details
  const meetingDetails = await client.getPastMeetingDetails(instanceUuid);

  // Get participants
  let participants: { name: string; email?: string; duration_minutes: number }[] = [];
  try {
    const participantsResponse = await client.getMeetingParticipants(instanceUuid);
    participants = participantsResponse.participants.map((p) => ({
      name: p.name,
      email: p.user_email,
      duration_minutes: Math.round(p.duration / 60),
    }));
  } catch {
    // Participants might not be available
  }

  // Check for recording availability
  let hasRecording = false;
  try {
    const recording = await client.getMeetingRecordings(instanceUuid);
    hasRecording = recording.recording_files && recording.recording_files.length > 0;
  } catch {
    // Recording not available
  }

  // Check for summary availability
  let hasSummary = false;
  try {
    hasSummary = await client.hasMeetingSummary(instanceUuid);
  } catch {
    // Summary not available
  }

  return {
    meeting_id: String(meetingDetails.id),
    uuid: meetingDetails.uuid,
    topic: meetingDetails.topic,
    host_id: meetingDetails.host_id,
    date: meetingDetails.start_time,
    end_time: meetingDetails.end_time,
    duration_minutes: meetingDetails.duration,
    participants_count: meetingDetails.participants_count,
    participants,
    has_recording: hasRecording,
    has_summary: hasSummary,
  };
}
