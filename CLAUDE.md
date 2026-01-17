# Zoom MCP Server

## Project Overview
MCP (Model Context Protocol) server for Zoom that enables LLMs to access meeting transcripts and AI summaries. Installable via `npx @sweatco/zoom-mcp`.

## Tech Stack
- TypeScript with ESM modules
- `@modelcontextprotocol/sdk` for MCP server implementation
- Zoom OAuth 2.0 with localhost browser flow (user-friendly, no setup needed)
- Token storage: OS keychain (primary) + `~/.config/zoom-mcp/` (fallback)
- stdio transport for local execution

## Key Commands
```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode for development
npm start          # Run the MCP server
npx .              # Test locally as MCP server
```

## Project Structure
```
src/
├── index.ts              # MCP server entry point
├── auth/
│   ├── constants.ts      # OAuth config (client ID, scopes)
│   ├── oauth.ts          # Browser OAuth flow
│   └── token-store.ts    # Token persistence (keychain + file)
├── zoom-client.ts        # Zoom API client
├── tools/
│   ├── list-meetings.ts  # list_meetings tool
│   ├── get-transcript.ts # get_transcript tool
│   ├── get-summary.ts    # get_summary tool
│   ├── get-meeting.ts    # get_meeting tool
│   └── search.ts         # search_meetings tool
├── utils/
│   └── vtt-parser.ts     # VTT to plain text converter
└── types.ts              # TypeScript interfaces
```

## MCP Tools
- `list_meetings` - List recent meetings with transcript/summary availability
- `get_transcript` - Get full meeting transcript (VTT or AI summary fallback)
- `get_summary` - Get AI Companion meeting summary
- `get_meeting` - Get meeting details and participants
- `search_meetings` - Search across transcripts and summaries

## OAuth Scopes Required
- `cloud_recording:read:list_user_recordings:master`
- `cloud_recording:read:list_recording_files:master`
- `meeting_summary:read`
- `meeting:read`
- `user:read`

## Zoom API Endpoints Used
- `GET /users/me/recordings` - List recordings
- `GET /meetings/{id}/recordings` - Get recording files + VTT
- `GET /meetings/{id}/meeting_summary` - Get AI summary
- `GET /past_meetings/{id}` - Get meeting details
- `GET /past_meetings/{id}/participants` - Get participants

## Testing
```bash
# Build first
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Logout (clear stored tokens)
npx . --logout
```

## Configuration for Claude
Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"]
    }
  }
}
```
