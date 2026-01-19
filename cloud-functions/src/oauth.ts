/**
 * OAuth token exchange proxy
 *
 * Keeps the client secret secure on the server side.
 * Used by the MCP client for user OAuth flow.
 *
 * Also handles OAuth callback redirect for production apps that require HTTPS redirect URLs.
 */

import type { Request, Response } from '@google-cloud/functions-framework';

const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

// Local redirect port for MCP client
const LOCAL_REDIRECT_PORT = 8888;

/**
 * Handle OAuth callback from Zoom (GET request)
 *
 * Zoom redirects here with code and state params.
 * We forward them to the local MCP client running on localhost.
 */
export function handleOAuthCallback(req: Request, res: Response): void {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  // Build local redirect URL
  const localUrl = new URL(`http://localhost:${LOCAL_REDIRECT_PORT}/callback`);

  if (error) {
    localUrl.searchParams.set('error', error);
  }
  if (code) {
    localUrl.searchParams.set('code', code);
  }
  if (state) {
    localUrl.searchParams.set('state', state);
  }

  // Redirect to local MCP client
  res.redirect(302, localUrl.toString());
}

/**
 * Handle OAuth token exchange requests (POST request)
 */
export async function handleOAuth(req: Request, res: Response): Promise<void> {
  // Handle GET requests for OAuth callback
  if (req.method === 'GET' && req.path?.endsWith('/callback')) {
    handleOAuthCallback(req, res);
    return;
  }

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
    let body: URLSearchParams;

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
        error:
          'Invalid request. Required: action=token with code+redirect_uri, or action=refresh with refresh_token',
      });
      return;
    }

    const response = await fetch(ZOOM_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
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
}
