import { z } from 'zod';
import { getZoomClient } from '../zoom-client.js';
import { isProxyConfigured, getSummaryFromProxy, ProxyError } from '../proxy-client.js';
import type { SummaryResponse } from '../types.js';

export const getSummarySchema = z.object({
  instance_uuid: z
    .string()
    .describe('Meeting instance UUID from list_meetings.'),
});

export type GetSummaryInput = z.infer<typeof getSummarySchema>;

export async function getSummary(input: GetSummaryInput): Promise<SummaryResponse> {
  const client = getZoomClient();
  const instanceUuid = input.instance_uuid;

  // Try direct Zoom API first (for meetings user hosted)
  try {
    const summary = await client.getMeetingSummary(instanceUuid);

    if (summary) {
      // Use edited summary if available, falling back to original
      const edited = summary.edited_summary;
      const overview = edited?.summary_overview || summary.summary_overview;
      const details = edited?.summary_details || summary.summary_details;
      const nextSteps = edited?.next_steps || summary.next_steps;

      // Extract action items from summary details (commonly labeled as "Action Items")
      const actionItems: string[] = [];
      const topics: { label: string; summary: string }[] = [];

      if (details) {
        for (const detail of details) {
          // Check if this is an action items section
          if (detail.label.toLowerCase().includes('action')) {
            // Parse action items from the summary text
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
  } catch (error) {
    // Direct API failed - user might not have access to this meeting
    // Try proxy if configured
  }

  // Try proxy (for meetings user attended but didn't host)
  if (isProxyConfigured()) {
    try {
      return await getSummaryFromProxy(instanceUuid);
    } catch (error) {
      if (error instanceof ProxyError) {
        if (error.status === 403) {
          throw new Error(
            `Access denied. You did not participate in meeting ${instanceUuid}.`
          );
        }
        if (error.status === 404) {
          throw new Error(
            `No AI summary available for meeting ${instanceUuid}. ` +
              'AI Companion may not have been enabled for this meeting.'
          );
        }
      }
      throw error;
    }
  }

  throw new Error(
    `No AI summary available for meeting ${instanceUuid}. ` +
      'AI Companion may not have been enabled for this meeting, or the summary may still be processing.'
  );
}
