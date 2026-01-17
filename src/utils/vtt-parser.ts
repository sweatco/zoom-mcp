import type { TranscriptSegment } from '../types.js';

/**
 * Parse VTT (WebVTT) format to plain text with timestamps and speaker labels.
 * VTT format example:
 *
 * WEBVTT
 *
 * 00:00:00.000 --> 00:00:05.000
 * <v John Smith>Hello everyone, welcome to the meeting.
 *
 * 00:00:05.500 --> 00:00:10.000
 * <v Jane Doe>Thanks John, let's get started.
 */
export function parseVtt(vttContent: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = vttContent.split('\n');

  let currentTimestamp = '';
  let currentSpeaker: string | undefined;
  let currentText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip WEBVTT header and empty lines
    if (line === 'WEBVTT' || line === '' || line.startsWith('NOTE')) {
      // If we have accumulated text, save it
      if (currentText && currentTimestamp) {
        segments.push({
          timestamp: currentTimestamp,
          speaker: currentSpeaker,
          text: currentText.trim(),
        });
        currentText = '';
        currentTimestamp = '';
        currentSpeaker = undefined;
      }
      continue;
    }

    // Check for timestamp line (e.g., "00:00:00.000 --> 00:00:05.000")
    const timestampMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (timestampMatch) {
      // Save previous segment if exists
      if (currentText && currentTimestamp) {
        segments.push({
          timestamp: currentTimestamp,
          speaker: currentSpeaker,
          text: currentText.trim(),
        });
        currentText = '';
        currentSpeaker = undefined;
      }
      // Format: start time only, truncated to seconds
      currentTimestamp = timestampMatch[1].replace(/\.\d{3}$/, '');
      continue;
    }

    // Check for cue identifier (numeric or string identifier before timestamp)
    if (/^\d+$/.test(line)) {
      continue;
    }

    // Parse text content, extracting speaker if present
    // Speaker format: <v Speaker Name>text
    const speakerMatch = line.match(/^<v\s+([^>]+)>(.*)/);
    if (speakerMatch) {
      currentSpeaker = speakerMatch[1].trim();
      const text = speakerMatch[2].trim();
      if (text) {
        currentText += (currentText ? ' ' : '') + text;
      }
    } else {
      // Regular text line (continuation or no speaker)
      // Remove any HTML-like tags
      const cleanedLine = line.replace(/<[^>]+>/g, '').trim();
      if (cleanedLine) {
        currentText += (currentText ? ' ' : '') + cleanedLine;
      }
    }
  }

  // Don't forget the last segment
  if (currentText && currentTimestamp) {
    segments.push({
      timestamp: currentTimestamp,
      speaker: currentSpeaker,
      text: currentText.trim(),
    });
  }

  return segments;
}

/**
 * Format parsed VTT segments into readable plain text.
 * Output format:
 * [00:00:00] John Smith: Hello everyone, welcome to the meeting.
 * [00:00:05] Jane Doe: Thanks John, let's get started.
 */
export function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => {
      const prefix = `[${segment.timestamp}]`;
      if (segment.speaker) {
        return `${prefix} ${segment.speaker}: ${segment.text}`;
      }
      return `${prefix} ${segment.text}`;
    })
    .join('\n');
}

/**
 * Parse VTT content and return formatted plain text transcript.
 */
export function vttToPlainText(vttContent: string): string {
  const segments = parseVtt(vttContent);
  return formatTranscript(segments);
}

/**
 * Extract plain text from VTT without timestamps or speaker labels.
 * Useful for search indexing.
 */
export function vttToSearchableText(vttContent: string): string {
  const segments = parseVtt(vttContent);
  return segments.map((s) => s.text).join(' ');
}
