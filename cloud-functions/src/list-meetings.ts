/**
 * List Meetings Endpoint
 *
 * Returns meetings the user participated in (or all meetings for admins).
 */

import type { Request, Response } from '@google-cloud/functions-framework';
import type { ListMeetingsRequest, ListMeetingsResponse } from './types.js';
import { validateUserToken, extractBearerToken } from './utils/validate-token.js';
import { queryMeetingsByEmail, queryAllMeetings } from './utils/firestore.js';

/**
 * Handle list-meetings request
 */
export async function handleListMeetings(req: Request, res: Response): Promise<void> {
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

  // Parse request parameters
  const params = req.body as ListMeetingsRequest;

  // Default date range: last 30 days
  const toDate = params.to_date || new Date().toISOString().split('T')[0];
  const fromDate =
    params.from_date ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const limit = params.limit || 50;

  // Determine which email to query for
  let queryEmail: string | null = userInfo.email.toLowerCase();
  let queryAllFlag = false;

  // Admin-only parameters
  if (params.user_email) {
    if (!userInfo.isAdmin) {
      res.status(403).json({ error: 'Admin access required to query other users' });
      return;
    }
    queryEmail = params.user_email.toLowerCase();
  } else if (params.all_meetings) {
    if (!userInfo.isAdmin) {
      res.status(403).json({ error: 'Admin access required for all_meetings' });
      return;
    }
    queryAllFlag = true;
    queryEmail = null;
  }

  try {
    let meetings;
    if (queryAllFlag) {
      meetings = await queryAllMeetings(fromDate, toDate, limit);
    } else {
      meetings = await queryMeetingsByEmail(queryEmail!, fromDate, toDate, limit);
    }

    const response: ListMeetingsResponse = { meetings };
    res.json(response);
  } catch (error) {
    console.error('Error querying meetings:', error);
    res.status(500).json({ error: 'Failed to query meetings' });
  }
}
