/**
 * Zoom MCP - Cloud Functions Entry Point
 *
 * Exports:
 * - oauth: User OAuth token exchange (MVP1)
 * - webhookHandler: Receives Zoom meeting.ended webhooks (MVP2)
 * - proxyApi: Handles list-meetings, get-summary, get-transcript (MVP2)
 * - cleanup: Monthly cleanup job for data retention (MVP2)
 */

// Load environment variables from .env file for local development
import 'dotenv/config';

import functions from '@google-cloud/functions-framework';
import type { Request, Response } from '@google-cloud/functions-framework';
import { handleOAuth } from './oauth.js';
import { handleWebhook } from './webhook-handler.js';
import { handleListMeetings } from './list-meetings.js';
import { handleGetSummary } from './get-summary.js';
import { handleGetTranscript } from './get-transcript.js';
import { handleCleanup } from './cleanup.js';

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Webhook Handler
 *
 * Receives and processes Zoom webhooks.
 * URL: /zoom-webhook-handler
 */
functions.http('webhookHandler', async (req: Request, res: Response) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set(corsHeaders);
    res.status(204).send('');
    return;
  }

  res.set(corsHeaders);
  await handleWebhook(req, res);
});

/**
 * Proxy API
 *
 * Main API endpoint that routes to different handlers based on path.
 * URL: /zoom-proxy-api
 *
 * Routes:
 * - POST /list-meetings - List meetings user participated in
 * - POST /get-summary - Get AI summary for a meeting
 * - POST /get-transcript - Get transcript for a meeting
 */
functions.http('proxyApi', async (req: Request, res: Response) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set(corsHeaders);
    res.status(204).send('');
    return;
  }

  res.set(corsHeaders);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Route based on path or action parameter
  // Cloud Functions can be invoked with a path like /zoom-proxy-api/list-meetings
  // or with an action parameter in the body
  const path = req.path || '';
  const action = req.body?.action as string | undefined;

  // Determine the action from path or body
  let handler: string;
  if (path.endsWith('/list-meetings') || action === 'list-meetings') {
    handler = 'list-meetings';
  } else if (path.endsWith('/get-summary') || action === 'get-summary') {
    handler = 'get-summary';
  } else if (path.endsWith('/get-transcript') || action === 'get-transcript') {
    handler = 'get-transcript';
  } else {
    res.status(400).json({
      error: 'Unknown action. Valid actions: list-meetings, get-summary, get-transcript',
    });
    return;
  }

  // Route to appropriate handler
  switch (handler) {
    case 'list-meetings':
      await handleListMeetings(req, res);
      break;
    case 'get-summary':
      await handleGetSummary(req, res);
      break;
    case 'get-transcript':
      await handleGetTranscript(req, res);
      break;
  }
});

/**
 * Cleanup Job
 *
 * Monthly job to delete old records (>365 days).
 * URL: /zoom-cleanup
 *
 * Protected by IAM - only invokable by Cloud Scheduler service account.
 */
functions.http('cleanup', async (req: Request, res: Response) => {
  await handleCleanup(req, res);
});

/**
 * OAuth Token Exchange
 *
 * Securely exchanges OAuth codes for tokens without exposing client secret.
 * URL: /zoom-mcp-oauth
 *
 * Also handles OAuth callback redirect:
 * GET /zoom-mcp-oauth/callback - Receives Zoom redirect, forwards to localhost
 */
functions.http('oauth', async (req: Request, res: Response) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set(corsHeaders);
    res.status(204).send('');
    return;
  }

  // Don't set CORS headers for callback redirects (they're browser navigations, not AJAX)
  if (req.method !== 'GET') {
    res.set(corsHeaders);
  }

  await handleOAuth(req, res);
});
