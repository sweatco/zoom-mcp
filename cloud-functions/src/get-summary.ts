/**
 * Get Summary Endpoint
 *
 * Returns the AI Companion summary for a meeting.
 * Verifies user participation before returning data (unless admin).
 */

import type { Request, Response } from '@google-cloud/functions-framework';
import type { GetContentRequest, GetSummaryResponse, ZoomMeetingSummary } from './types.js';
import { validateUserToken, extractBearerToken } from './utils/validate-token.js';
import { checkParticipation } from './utils/firestore.js';
import { getMeetingSummary } from './utils/admin-client.js';

/**
 * Handle get-summary request
 */
export async function handleGetSummary(req: Request, res: Response): Promise<void> {
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

  // Fetch summary using admin credentials
  try {
    const summary = await getMeetingSummary(params.instance_uuid);
    const response: GetSummaryResponse = { summary };
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching summary:', message);

    // Check for specific error types
    if (message.includes('404') || message.includes('not found')) {
      res.status(404).json({ error: 'Summary not available for this meeting' });
      return;
    }

    res.status(500).json({ error: 'Failed to fetch summary' });
  }
}
