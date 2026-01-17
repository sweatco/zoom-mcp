// OAuth Configuration

// Zoom OAuth app Client ID (public, safe to commit)
export const ZOOM_CLIENT_ID = '12HSakNTRpGJCHXGOgbPFQ';

// OAuth proxy URL (Cloud Function that securely holds the client secret)
export const OAUTH_PROXY_URL = 'https://europe-west1-zoom-mcp-oauth.cloudfunctions.net/zoom-mcp-oauth';

export const ZOOM_OAUTH_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
export const ZOOM_API_BASE_URL = 'https://api.zoom.us/v2';

export const OAUTH_REDIRECT_PORT = 8888;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;

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
