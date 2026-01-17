import { z } from 'zod';
import { getZoomClient } from '../zoom-client.js';
import { vttToPlainText } from '../utils/vtt-parser.js';
import type { TranscriptResponse } from '../types.js';

export const getTranscriptSchema = z.object({
  instance_uuid: z
    .string()
    .describe('Meeting instance UUID from list_meetings.'),
});

export type GetTranscriptInput = z.infer<typeof getTranscriptSchema>;

export async function getTranscript(input: GetTranscriptInput): Promise<TranscriptResponse> {
  const client = getZoomClient();
  const instanceUuid = input.instance_uuid;

  // First, try to get VTT transcript from cloud recording
  const vttContent = await client.getRecordingTranscript(instanceUuid);

  if (vttContent) {
    // Get meeting details for topic
    let topic = 'Unknown Meeting';
    let date = '';

    try {
      const recording = await client.getMeetingRecordings(instanceUuid);
      topic = recording.topic;
      date = recording.start_time;
    } catch {
      // Couldn't get recording details, use defaults
    }

    return {
      meeting_id: instanceUuid,
      topic,
      date,
      source: 'recording',
      transcript: vttToPlainText(vttContent),
    };
  }

  // Second, try AI Companion transcript (using instance UUID)
  const aiTranscript = await client.getAICompanionTranscript(instanceUuid, true);

  if (aiTranscript && aiTranscript.transcript_text) {
    // The transcript is in VTT format, convert to plain text
    const transcriptText = aiTranscript.transcript_text.startsWith('WEBVTT')
      ? vttToPlainText(aiTranscript.transcript_text)
      : aiTranscript.transcript_text;

    return {
      meeting_id: instanceUuid,
      topic: aiTranscript.meeting_topic || 'Unknown Meeting',
      date: aiTranscript.transcript_created_time || '',
      source: 'recording',
      transcript: transcriptText,
    };
  }

  // Fallback: Try to get content from AI summary (using instance UUID)
  const summary = await client.getMeetingSummary(instanceUuid);

  if (summary) {
    // AI summaries don't have a full transcript, but we can provide the summary details
    // as a transcript-like format
    let transcriptText = '';

    if (summary.summary_overview) {
      transcriptText += `Overview:\n${summary.summary_overview}\n\n`;
    }

    if (summary.summary_details && summary.summary_details.length > 0) {
      transcriptText += 'Key Topics:\n';
      for (const detail of summary.summary_details) {
        transcriptText += `\n${detail.label}:\n${detail.summary}\n`;
      }
      transcriptText += '\n';
    }

    // Check for edited summary content
    const edited = summary.edited_summary;
    if (edited) {
      if (edited.summary_overview) {
        transcriptText = `Overview:\n${edited.summary_overview}\n\n` + transcriptText.replace(/^Overview:[\s\S]*?\n\n/, '');
      }
      if (edited.summary_details && edited.summary_details.length > 0) {
        // Replace key topics section
        const beforeTopics = transcriptText.split('Key Topics:')[0];
        transcriptText = beforeTopics + 'Key Topics:\n';
        for (const detail of edited.summary_details) {
          transcriptText += `\n${detail.label}:\n${detail.summary}\n`;
        }
        transcriptText += '\n';
      }
    }

    if (summary.next_steps && summary.next_steps.length > 0) {
      transcriptText += 'Next Steps:\n';
      for (const step of summary.next_steps) {
        transcriptText += `- ${step}\n`;
      }
    } else if (edited?.next_steps && edited.next_steps.length > 0) {
      transcriptText += 'Next Steps:\n';
      for (const step of edited.next_steps) {
        transcriptText += `- ${step}\n`;
      }
    }

    return {
      meeting_id: instanceUuid,
      topic: summary.meeting_topic,
      date: summary.meeting_start_time,
      source: 'summary',
      transcript: transcriptText.trim(),
    };
  }

  // No transcript available from either source
  throw new Error(
    `No transcript available for meeting ${instanceUuid}. The meeting may not have been recorded, ` +
      'or AI Companion may not have been enabled.'
  );
}
