/**
 * OAuth token exchange proxy for zoom-mcp
 *
 * Keeps the client secret secure on the server side.
 *
 * Deploy with:
 *   gcloud functions deploy zoom-mcp-oauth \
 *     --gen2 \
 *     --runtime=nodejs20 \
 *     --trigger-http \
 *     --allow-unauthenticated \
 *     --set-secrets=ZOOM_CLIENT_SECRET=zoom-mcp-client-secret:latest \
 *     --set-env-vars=ZOOM_CLIENT_ID=your-client-id
 */

import functions from '@google-cloud/functions-framework';

const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

functions.http('zoom-mcp-oauth', async (req, res) => {
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

  const { action, code, redirect_uri, refresh_token } = req.body;

  if (!ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  try {
    let body;

    if (action === 'token' && code && redirect_uri) {
      // Exchange auth code for tokens
      body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
      });
    } else if (action === 'refresh' && refresh_token) {
      // Refresh access token
      body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
      });
    } else {
      res.status(400).json({
        error: 'Invalid request. Required: action=token with code+redirect_uri, or action=refresh with refresh_token'
      });
      return;
    }

    const response = await fetch(ZOOM_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body,
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }

    res.json(data);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});
