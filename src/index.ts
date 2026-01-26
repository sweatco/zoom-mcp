#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logout, getValidAccessToken, startOAuthFlow } from './auth/oauth.js';
import { loadTokens, getLastTokenSource, type TokenSource } from './auth/token-store.js';
import { ZOOM_CLIENT_ID, OAUTH_URL } from './auth/constants.js';
import { listMeetings } from './tools/list-meetings.js';
import { getTranscript } from './tools/get-transcript.js';
import { getSummary } from './tools/get-summary.js';
import { getMeeting } from './tools/get-meeting.js';
import { searchMeetings } from './tools/search.js';

// Handle --logout flag
if (process.argv.includes('--logout')) {
  await logout();
  process.exit(0);
}

// Handle --export-token flag (for headless setup)
if (process.argv.includes('--export-token')) {
  // First try to load existing tokens
  let tokens = await loadTokens();

  if (!tokens || !tokens.refresh_token) {
    // No tokens stored, start OAuth flow to get them
    console.error('No existing tokens found. Starting OAuth flow...\n');
    tokens = await startOAuthFlow();
  }

  console.log('\n=== Zoom Refresh Token ===\n');
  console.log('Add this to your MCP config for headless environments:\n');
  console.log(JSON.stringify({
    mcpServers: {
      zoom: {
        command: 'npx',
        args: ['-y', '@sweatco/zoom-mcp'],
        env: {
          ZOOM_REFRESH_TOKEN: tokens.refresh_token,
        },
      },
    },
  }, null, 2));
  console.log('\nOr set the environment variable directly:');
  console.log(`\nZOOM_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  process.exit(0);
}

// Authenticate on startup (will open browser if no tokens)
await getValidAccessToken();
console.error('✓ Authenticated with Zoom');

// Create MCP server
const server = new McpServer({
  name: 'zoom-mcp',
  version: '0.1.0',
});

// Register tools using the new registerTool API
server.registerTool(
  'list_meetings',
  {
    title: 'List Meetings',
    description:
      'List your Zoom meetings. Can list past meetings (with transcripts/summaries), upcoming scheduled meetings, or currently live meetings.',
    inputSchema: {
      meeting_type: z
        .enum(['past', 'upcoming', 'live'])
        .optional()
        .describe('Type of meetings to list: past (default), upcoming, or live.'),
      from_date: z.string().optional().describe('Start date (YYYY-MM-DD). Only for past meetings. Defaults to 30 days ago.'),
      to_date: z.string().optional().describe('End date (YYYY-MM-DD). Only for past meetings. Defaults to today.'),
      type: z
        .enum(['all', 'recorded', 'with_summary'])
        .optional()
        .describe('Filter by type: all, recorded, or with_summary. Defaults to all.'),
      user_email: z
        .string()
        .optional()
        .describe('Email of user to query meetings for. Admin only - requires Zoom admin privileges.'),
    },
  },
  async (args) => {
    try {
      const result = await listMeetings(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'get_transcript',
  {
    title: 'Get Transcript',
    description:
      'Get the full transcript for a Zoom meeting. ' +
      'Returns the verbatim transcript from cloud recording (VTT format), ' +
      'or falls back to AI Companion summary content if no recording transcript exists.',
    inputSchema: {
      instance_uuid: z.string().describe('Meeting instance UUID from list_meetings.'),
    },
  },
  async (args) => {
    try {
      const result = await getTranscript(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'get_summary',
  {
    title: 'Get Summary',
    description:
      'Get the AI Companion meeting summary for a Zoom meeting. ' +
      'Returns the overview, key topics discussed, action items, and next steps.',
    inputSchema: {
      instance_uuid: z.string().describe('Meeting instance UUID from list_meetings.'),
    },
  },
  async (args) => {
    try {
      const result = await getSummary(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'get_meeting',
  {
    title: 'Get Meeting',
    description:
      'Get detailed information about a Zoom meeting including participants, duration, ' +
      'and availability of recordings and summaries.',
    inputSchema: {
      instance_uuid: z.string().describe('Meeting instance UUID from list_meetings.'),
    },
  },
  async (args) => {
    try {
      const result = await getMeeting(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'search_meetings',
  {
    title: 'Search Meetings',
    description:
      'Search across your Zoom meeting transcripts and summaries for specific keywords or topics. ' +
      'Returns matching meetings with relevant excerpts.',
    inputSchema: {
      query: z.string().describe('Search keywords to find in meeting transcripts and summaries.'),
      from_date: z.string().optional().describe('Start date (YYYY-MM-DD). Defaults to 30 days ago.'),
      to_date: z.string().optional().describe('End date (YYYY-MM-DD). Defaults to today.'),
    },
  },
  async (args) => {
    try {
      const result = await searchMeetings(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Health/debug tool for troubleshooting
server.registerTool(
  'debug_status',
  {
    title: 'Debug Status',
    description:
      'Get debug information about the Zoom MCP server configuration and authentication status. ' +
      'Useful for troubleshooting connection issues in headless environments.',
    inputSchema: {},
  },
  async () => {
    try {
      const tokens = await loadTokens();
      const tokenSource = getLastTokenSource();
      const proxyUrl = process.env.ZOOM_PROXY_URL || null;

      const status = {
        authentication: {
          token_source: tokenSource,
          has_access_token: !!tokens?.access_token,
          has_refresh_token: !!tokens?.refresh_token,
          token_expires_at: tokens?.expires_at
            ? new Date(tokens.expires_at).toISOString()
            : null,
          token_expired: tokens?.expires_at
            ? Date.now() > tokens.expires_at
            : null,
          env_refresh_token_set: !!process.env.ZOOM_REFRESH_TOKEN,
        },
        configuration: {
          oauth_client_id: ZOOM_CLIENT_ID ? `${ZOOM_CLIENT_ID.slice(0, 8)}...` : null,
          oauth_url: OAUTH_URL,
          proxy_url: proxyUrl,
          proxy_enabled: !!proxyUrl,
        },
        environment: {
          node_version: process.version,
          platform: process.platform,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

// Log startup to stderr (so it doesn't interfere with MCP stdio)
console.error('Zoom MCP server started');
