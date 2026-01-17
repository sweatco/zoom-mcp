import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import open from 'open';
import type { ZoomTokens } from '../types.js';
import {
  ZOOM_CLIENT_ID,
  ZOOM_OAUTH_AUTHORIZE_URL,
  OAUTH_PROXY_URL,
  OAUTH_REDIRECT_PORT,
  OAUTH_REDIRECT_URI,
  ZOOM_SCOPES,
} from './constants.js';
import { saveTokens, loadTokens, deleteTokens, isTokenExpired } from './token-store.js';

// Generate a random state for CSRF protection
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Exchange authorization code for tokens via proxy
async function exchangeCodeForTokens(code: string): Promise<ZoomTokens> {
  const response = await fetch(OAUTH_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'token',
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${response.status} ${JSON.stringify(errorData)}`);
  }

  return (await response.json()) as ZoomTokens;
}

// Refresh access token via proxy
export async function refreshAccessToken(refreshToken: string): Promise<ZoomTokens> {
  const response = await fetch(OAUTH_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'refresh',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${response.status} ${JSON.stringify(errorData)}`);
  }

  return (await response.json()) as ZoomTokens;
}

// Start OAuth flow with local callback server
export async function startOAuthFlow(): Promise<ZoomTokens> {
  return new Promise((resolve, reject) => {
    const state = generateState();
    let timeoutId: NodeJS.Timeout;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${OAUTH_REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          clearTimeout(timeoutId);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Failed</h1>
                <p>State mismatch - possible CSRF attack.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          clearTimeout(timeoutId);
          server.close();
          reject(new Error('State mismatch'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Failed</h1>
                <p>No authorization code received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          clearTimeout(timeoutId);
          server.close();
          reject(new Error('No authorization code'));
          return;
        }

        try {
          const tokens = await exchangeCodeForTokens(code);
          await saveTokens(tokens);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Successfully Connected to Zoom!</h1>
                <p>You can close this window and return to Claude.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `);

          clearTimeout(timeoutId);
          server.close();
          resolve(tokens);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authorization Failed</h1>
                <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          clearTimeout(timeoutId);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(OAUTH_REDIRECT_PORT, () => {
      // Build authorization URL
      const authUrl = new URL(ZOOM_OAUTH_AUTHORIZE_URL);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', ZOOM_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
      authUrl.searchParams.set('scope', ZOOM_SCOPES);
      authUrl.searchParams.set('state', state);

      // Log to stderr so it doesn't interfere with MCP stdio
      console.error('\nNo Zoom authorization found. Opening browser to connect...');
      console.error(`If browser doesn't open, visit: ${authUrl.toString()}\n`);

      // Open browser
      open(authUrl.toString()).catch(() => {
        // Browser open failed, user will need to use the URL manually
      });
    });

    // Timeout after 5 minutes
    timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out after 5 minutes'));
    }, 5 * 60 * 1000);

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeoutId);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${OAUTH_REDIRECT_PORT} is already in use. ` +
          'Please close any application using this port and try again.'
        ));
      } else {
        reject(err);
      }
    });
  });
}

// Get valid access token, refreshing or starting OAuth flow if needed
export async function getValidAccessToken(): Promise<string> {
  let tokens = await loadTokens();

  if (!tokens) {
    // No tokens stored, start OAuth flow
    tokens = await startOAuthFlow();
    return tokens.access_token;
  }

  if (isTokenExpired(tokens)) {
    // Token expired, try to refresh
    try {
      tokens = await refreshAccessToken(tokens.refresh_token);
      await saveTokens(tokens);
      return tokens.access_token;
    } catch {
      // Refresh failed, start new OAuth flow
      await deleteTokens();
      tokens = await startOAuthFlow();
      return tokens.access_token;
    }
  }

  return tokens.access_token;
}

// Logout - clear stored tokens
export async function logout(): Promise<void> {
  await deleteTokens();
  console.error('Successfully logged out from Zoom.');
}
