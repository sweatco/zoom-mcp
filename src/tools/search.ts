import { z } from 'zod';
import { getZoomClient } from '../zoom-client.js';
import { vttToSearchableText } from '../utils/vtt-parser.js';
import type { SearchResult, ZoomRecording } from '../types.js';

export const searchMeetingsSchema = z.object({
  query: z
    .string()
    .describe('Search keywords to find in meeting transcripts and summaries.'),
  from_date: z
    .string()
    .optional()
    .describe('Start date (YYYY-MM-DD). Defaults to 30 days ago.'),
  to_date: z
    .string()
    .optional()
    .describe('End date (YYYY-MM-DD). Defaults to today.'),
});

export type SearchMeetingsInput = z.infer<typeof searchMeetingsSchema>;

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getDefaultFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return formatDate(date);
}

function getDefaultToDate(): string {
  return formatDate(new Date());
}

// Extract excerpts containing the search query
function extractExcerpts(text: string, query: string, maxExcerpts = 3): string[] {
  const excerpts: string[] = [];
  const queryLower = query.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const textLower = text.toLowerCase();

  // Find positions of query matches
  const positions: number[] = [];

  // Search for full query
  let pos = textLower.indexOf(queryLower);
  while (pos !== -1 && positions.length < maxExcerpts * 2) {
    positions.push(pos);
    pos = textLower.indexOf(queryLower, pos + 1);
  }

  // If no exact matches, search for individual words
  if (positions.length === 0 && words.length > 0) {
    for (const word of words) {
      pos = textLower.indexOf(word);
      while (pos !== -1 && positions.length < maxExcerpts * 2) {
        if (!positions.some((p) => Math.abs(p - pos) < 50)) {
          positions.push(pos);
        }
        pos = textLower.indexOf(word, pos + 1);
      }
    }
  }

  // Extract excerpts around each position
  const contextLength = 100; // Characters before and after
  for (const position of positions.slice(0, maxExcerpts)) {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(text.length, position + query.length + contextLength);

    let excerpt = text.substring(start, end).trim();

    // Add ellipsis if truncated
    if (start > 0) excerpt = '...' + excerpt;
    if (end < text.length) excerpt = excerpt + '...';

    excerpts.push(excerpt);
  }

  return excerpts;
}

// Check if text contains the search query
function matchesQuery(text: string, query: string): boolean {
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Check for exact query match
  if (textLower.includes(queryLower)) {
    return true;
  }

  // Check for word matches (all words must be present)
  const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 0) {
    return words.every((word) => textLower.includes(word));
  }

  return false;
}

export async function searchMeetings(input: SearchMeetingsInput): Promise<SearchResult[]> {
  const client = getZoomClient();

  const fromDate = input.from_date || getDefaultFromDate();
  const toDate = input.to_date || getDefaultToDate();
  const query = input.query;

  // Get all recordings
  const recordings = await client.getAllRecordings(fromDate, toDate);

  const results: SearchResult[] = [];

  // Search through each meeting
  for (const recording of recordings) {
    // Try to get VTT transcript
    let transcriptText: string | null = null;
    try {
      const vttContent = await client.getRecordingTranscript(recording.uuid);
      if (vttContent) {
        transcriptText = vttToSearchableText(vttContent);
      }
    } catch {
      // Transcript not available
    }

    // Check transcript for matches
    if (transcriptText && matchesQuery(transcriptText, query)) {
      results.push({
        meeting_id: String(recording.id),
        uuid: recording.uuid,
        topic: recording.topic,
        date: recording.start_time,
        excerpts: extractExcerpts(transcriptText, query),
        source: 'transcript',
      });
      continue; // Don't double-count from summary
    }

    // Try to search in summary
    try {
      const summary = await client.getMeetingSummary(recording.uuid);
      if (summary) {
        // Build searchable text from summary
        let summaryText = '';
        if (summary.summary_overview) summaryText += summary.summary_overview + ' ';
        if (summary.summary_details) {
          for (const detail of summary.summary_details) {
            summaryText += detail.label + ' ' + detail.summary + ' ';
          }
        }
        if (summary.next_steps) {
          summaryText += summary.next_steps.join(' ');
        }

        if (matchesQuery(summaryText, query)) {
          results.push({
            meeting_id: String(recording.id),
            uuid: recording.uuid,
            topic: recording.topic,
            date: recording.start_time,
            excerpts: extractExcerpts(summaryText, query),
            source: 'summary',
          });
        }
      }
    } catch {
      // Summary not available
    }
  }

  // Sort by date descending
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return results;
}
