// OAuth Configuration

// Default hosted OAuth service provided by Sweatco
const DEFAULT_ZOOM_CLIENT_ID = 'xp0xI4xSSVSrzL0JRzOOgQ';
const DEFAULT_OAUTH_URL = 'https://europe-west1-zoom-mcp-oauth.cloudfunctions.net/zoom-mcp-oauth';

// Zoom OAuth app Client ID (uses Sweatco's hosted service by default)
export const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID || DEFAULT_ZOOM_CLIENT_ID;

// OAuth URL (Cloud Function that securely holds the client secret)
export const OAUTH_URL = process.env.ZOOM_OAUTH_URL || DEFAULT_OAUTH_URL;

/**
 * Validate that OAuth configuration is valid.
 * Called before operations that need them (not at import time,
 * so --logout can work without env vars).
 */
export function validateConfig(): void {
  if (!ZOOM_CLIENT_ID) {
    throw new Error('ZOOM_CLIENT_ID is not configured');
  }
  if (!OAUTH_URL) {
    throw new Error('ZOOM_OAUTH_URL is not configured');
  }
}

export const ZOOM_OAUTH_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
export const ZOOM_API_BASE_URL = 'https://api.zoom.us/v2';

export const OAUTH_REDIRECT_PORT = 8888;

// For production Zoom apps that require HTTPS redirect URLs,
// the cloud function callback receives the OAuth redirect from Zoom
// and forwards it to the local MCP client on localhost.
export const OAUTH_REDIRECT_URI = `${OAUTH_URL}/callback`;

// Required OAuth scopes for all MCP features
// Using granular scopes (Zoom's new naming convention)
export const ZOOM_SCOPES = [
  // Recordings - list and download
  'cloud_recording:read:list_user_recordings',
  'cloud_recording:read:list_recording_files',
  // AI Companion transcript
  'cloud_recording:read:meeting_transcript',
  // Meetings - list, details, participants, summary
  'meeting:read:list_meetings',
  'meeting:read:meeting',
  'meeting:read:list_past_participants',
  'meeting:read:list_past_instances',
  'meeting:read:past_meeting',
  'meeting:read:summary',
  // User info
  'user:read:user',
].join(' ');

// Keychain service name for storing tokens
export const KEYCHAIN_SERVICE = 'zoom-mcp';
export const KEYCHAIN_ACCOUNT = 'oauth-tokens';

// Fallback config directory
export const CONFIG_DIR = '.config/zoom-mcp';
export const TOKENS_FILE = 'tokens.json';
