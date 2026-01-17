/**
 * Get Transcript Endpoint
 *
 * Returns the meeting transcript (from recording or AI summary fallback).
 * Verifies user participation before returning data (unless admin).
 */

import type { Request, Response } from '@google-cloud/functions-framework';
import type { GetContentRequest, GetTranscriptResponse } from './types.js';
import { validateUserToken, extractBearerToken } from './utils/validate-token.js';
import { checkParticipation } from './utils/firestore.js';
import { getMeetingRecordings, downloadTranscript, getMeetingSummary } from './utils/admin-client.js';

/**
 * Parse VTT content to plain text with speaker labels
 */
function parseVttToText(vttContent: string): string {
  const lines = vttContent.split('\n');
  const textLines: string[] = [];
  let currentSpeaker = '';
  let lastText = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header, timestamps, empty lines
    if (
      !trimmed ||
      trimmed === 'WEBVTT' ||
      trimmed.includes('-->') ||
      /^\d+$/.test(trimmed)
    ) {
      continue;
    }

    // Check for speaker label (format: "Name: text" or "<v Name>text</v>")
    const speakerMatch = trimmed.match(/^<v ([^>]+)>(.*)$/);
    if (speakerMatch) {
      const [, speaker, text] = speakerMatch;
      const cleanText = text.replace(/<\/v>$/, '').trim();

      if (speaker !== currentSpeaker) {
        currentSpeaker = speaker;
        if (cleanText) {
          textLines.push(`${speaker}: ${cleanText}`);
          lastText = cleanText;
        }
      } else if (cleanText && cleanText !== lastText) {
        // Same speaker, append or continue
        const lastLine = textLines[textLines.length - 1];
        if (lastLine && lastLine.startsWith(`${speaker}:`)) {
          textLines[textLines.length - 1] = `${lastLine} ${cleanText}`;
        } else {
          textLines.push(cleanText);
        }
        lastText = cleanText;
      }
    } else if (trimmed.includes(':') && !trimmed.includes('-->')) {
      // Simple "Speaker: text" format
      const colonIndex = trimmed.indexOf(':');
      const speaker = trimmed.slice(0, colonIndex).trim();
      const text = trimmed.slice(colonIndex + 1).trim();

      if (speaker && text && speaker !== currentSpeaker) {
        currentSpeaker = speaker;
        textLines.push(`${speaker}: ${text}`);
        lastText = text;
      } else if (text && text !== lastText) {
        textLines.push(trimmed);
        lastText = text;
      }
    } else if (trimmed !== lastText) {
      // Plain text line
      textLines.push(trimmed);
      lastText = trimmed;
    }
  }

  return textLines.join('\n');
}

/**
 * Handle get-transcript request
 */
export async function handleGetTranscript(req: Request, res: Response): Promise<void> {
  // Extract and validate user token
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  let userInfo;
  try {
    userInfo = await validateUserToken(token);
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Parse request
  const params = req.body as GetContentRequest;
  if (!params.instance_uuid) {
    res.status(400).json({ error: 'Missing instance_uuid' });
    return;
  }

  // Check participation (unless admin)
  if (!userInfo.isAdmin) {
    const hasAccess = await checkParticipation(params.instance_uuid, userInfo.email);
    if (!hasAccess) {
      res.status(403).json({
        error: 'Access denied. You did not participate in this meeting.',
      });
      return;
    }
  }

  // Try to get transcript from recording first
  try {
    const recordings = await getMeetingRecordings(params.instance_uuid);

    // Find VTT transcript file
    const transcriptFile = recordings.recording_files?.find(
      (f) => f.file_type === 'TRANSCRIPT' || f.file_extension === 'VTT'
    );

    if (transcriptFile && transcriptFile.download_url) {
      const vttContent = await downloadTranscript(transcriptFile.download_url);
      const parsedText = parseVttToText(vttContent);

      const response: GetTranscriptResponse = {
        transcript: parsedText,
        source: 'recording',
      };
      res.json(response);
      return;
    }
  } catch (error) {
    console.log('No recording transcript available, trying AI summary fallback');
  }

  // Fallback to AI summary
  try {
    const summary = await getMeetingSummary(params.instance_uuid);

    // Build transcript from summary content
    const parts: string[] = [];

    if (summary.summary_overview) {
      parts.push('## Overview\n' + summary.summary_overview);
    }

    if (summary.summary_details?.length) {
      parts.push('\n## Discussion Topics');
      for (const detail of summary.summary_details) {
        parts.push(`\n### ${detail.label}\n${detail.summary}`);
      }
    }

    if (summary.next_steps?.length) {
      parts.push('\n## Next Steps');
      for (const step of summary.next_steps) {
        parts.push(`- ${step}`);
      }
    }

    // Use edited summary if available
    const edited = summary.edited_summary;
    if (edited) {
      const editedParts: string[] = ['\n---\n## Edited Summary'];

      if (edited.summary_overview) {
        editedParts.push('\n### Overview\n' + edited.summary_overview);
      }

      if (edited.summary_details?.length) {
        editedParts.push('\n### Discussion Topics');
        for (const detail of edited.summary_details) {
          editedParts.push(`\n#### ${detail.label}\n${detail.summary}`);
        }
      }

      if (edited.next_steps?.length) {
        editedParts.push('\n### Next Steps');
        for (const step of edited.next_steps) {
          editedParts.push(`- ${step}`);
        }
      }

      parts.push(editedParts.join('\n'));
    }

    const response: GetTranscriptResponse = {
      transcript: parts.join('\n'),
      source: 'ai_summary',
    };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching transcript:', message);

    if (message.includes('404') || message.includes('not found')) {
      res.status(404).json({ error: 'Transcript not available for this meeting' });
      return;
    }

    res.status(500).json({ error: 'Failed to fetch transcript' });
  }
}
