#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logout, getValidAccessToken } from './auth/oauth.js';
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

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

// Log startup to stderr (so it doesn't interfere with MCP stdio)
console.error('Zoom MCP server started');
