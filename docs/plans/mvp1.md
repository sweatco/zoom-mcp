# Zoom MCP Server - Implementation Plan

## Overview
Create a Model Context Protocol (MCP) server for Zoom that enables LLMs to access meeting transcripts and summaries. The server will be installable via `npx` with a user-friendly OAuth flow.

## What This MCP Does

1. **List recent meetings** - See all your past meetings
2. **Get recording transcripts** - Full verbatim transcript from cloud-recorded meetings (VTT format)
3. **Get AI meeting summaries** - AI Companion generated summaries (when meeting wasn't recorded but had AI note-taker)
4. **Search transcripts** - Find meetings by keywords in transcripts
5. **Get meeting details** - Participants, duration, etc.

## Architecture

### Technology Stack
- **Runtime**: Node.js with TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk` (latest stable)
- **Transport**: stdio (for local npx usage)
- **Authentication**: Zoom OAuth 2.0 with local browser flow
- **Build**: TypeScript with ESM modules

### Project Structure
```
zoom-mcp/
├── src/
│   ├── index.ts              # Entry point, MCP server setup
│   ├── auth/
│   │   ├── oauth.ts          # OAuth flow with localhost callback
│   │   ├── token-store.ts    # Token persistence (keychain + file fallback)
│   │   └── constants.ts      # Client ID, scopes (hardcoded)
│   ├── zoom-client.ts        # Zoom API client
│   ├── tools/
│   │   ├── list-meetings.ts
│   │   ├── get-transcript.ts
│   │   ├── get-summary.ts
│   │   ├── search.ts
│   │   └── get-meeting.ts
│   ├── utils/
│   │   └── vtt-parser.ts     # Parse VTT to plain text
│   └── types.ts              # TypeScript interfaces
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

## MCP Tools

### 1. `list_meetings`
List all past meetings with available transcripts/summaries.

**Parameters:**
- `from_date` (optional): Start date, defaults to 30 days ago
- `to_date` (optional): End date, defaults to today
- `type` (optional): `all` | `recorded` | `with_summary`

**Returns:** Array of meetings with:
- Meeting ID, UUID
- Topic, date, duration
- Flags: `has_recording`, `has_transcript`, `has_summary`

### 2. `get_transcript`
Get the full transcript for a meeting.

**Parameters:**
- `meeting_id` (required): Meeting ID or UUID

**Returns:**
- Plain text transcript with timestamps and speaker labels
- Falls back to AI summary transcript if no recording transcript

**Logic:**
1. Try to get VTT transcript from cloud recording
2. If not available, try to get transcript from AI Companion summary
3. Return formatted plain text

### 3. `get_summary`
Get the AI Companion meeting summary.

**Parameters:**
- `meeting_id` (required): Meeting ID or UUID

**Returns:**
- Summary overview
- Key topics discussed
- Action items
- Next steps

### 4. `get_meeting`
Get detailed meeting information.

**Parameters:**
- `meeting_id` (required): Meeting ID or UUID

**Returns:**
- Topic, host, date, duration
- Participant list
- Recording availability
- Summary availability

### 5. `search_meetings`
Search across meeting transcripts and summaries.

**Parameters:**
- `query` (required): Search keywords
- `from_date` (optional): Start date
- `to_date` (optional): End date

**Returns:** Matching meetings with relevant excerpts

## Authentication

### OAuth Flow (User-Friendly)
- Single shared OAuth app - users just authorize, no setup needed
- Tokens stored in OS keychain (with file fallback to `~/.config/zoom-mcp/`)
- Silent token refresh - no re-auth needed

### First-Time Experience
```
$ npx @sweatco/zoom-mcp

No Zoom authorization found. Opening browser to connect...
[Browser opens → Zoom login → Authorize → Done]
✓ Successfully connected to Zoom!
```

## Zoom API Endpoints Used

| Endpoint | Purpose | Scope Required |
|----------|---------|----------------|
| `GET /users/me/recordings` | List recordings with transcripts | `cloud_recording:read:list_user_recordings:master` |
| `GET /meetings/{id}/recordings` | Get recording files + VTT | `cloud_recording:read:list_recording_files:master` |
| `GET /meetings/{id}/meeting_summary` | Get AI summary | `meeting_summary:read` |
| `GET /past_meetings/{id}` | Get meeting details | `meeting:read` |
| `GET /past_meetings/{id}/participants` | Get participants | `meeting:read` |
| `GET /users/me/meetings` | List past meetings | `meeting:read` |
| VTT download URL | Download transcript file | (uses access token) |

## Required Scopes

Add ALL these scopes to the OAuth app:

| Scope | Purpose |
|-------|---------|
| `cloud_recording:read:list_user_recordings:master` | List user's cloud recordings |
| `cloud_recording:read:list_recording_files:master` | Get recording files including VTT |
| `meeting_summary:read` | Get AI Companion summaries |
| `meeting:read` | Get meeting details |
| `user:read` | Get user info for "me" endpoint |

> ⚠️ **Note**: The `meeting_summary:read` scope has [known availability issues](https://devforum.zoom.us/t/important-update-for-zoom-api-users-ongoing-issue-with-meeting-summary-scopes/99961). If it's not available, the MCP will gracefully handle this and only provide recording transcripts.

## Configuration

### Claude Desktop / Claude Code
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

No environment variables needed!

## Implementation Steps

### 1. Project Setup
- Initialize npm package with proper metadata
- Configure TypeScript with ESM modules
- Add `bin` field for npx execution
- Dependencies: `@modelcontextprotocol/sdk`, `zod`, `open`, `keytar`

### 2. OAuth Infrastructure
- Localhost callback server (port 8888)
- Browser-based authorization flow
- Token storage (keychain primary, `~/.config/zoom-mcp/tokens.json` fallback)
- Automatic token refresh

### 3. Zoom API Client
- Authenticated API requests
- Automatic token refresh on 401
- Rate limit handling
- Error handling with clear messages

### 4. Tool Implementations
- `list_meetings`: Combine `/users/me/recordings` and `/users/me/meetings`
- `get_transcript`: Try recording VTT first, then summary transcript
- `get_summary`: Call `/meetings/{id}/meeting_summary`
- `get_meeting`: Call `/past_meetings/{id}` + participants
- `search_meetings`: Filter meetings by transcript content

### 5. VTT Parser
- Parse VTT format to plain text
- Extract speaker names and timestamps
- Format for LLM consumption (clean, readable)

### 6. Package for npx
- Shebang in entry point
- `bin` field in package.json
- Test with `npx .`

## Zoom OAuth App Setup (Maintainer)

### Create the App
1. Go to [Zoom App Marketplace](https://marketplace.zoom.us/) → Develop → Build App
2. Select **OAuth** (NOT Server-to-Server)
3. App Type: **User-managed app**

### Configure OAuth
- Redirect URL: `http://localhost:8888/callback`
- Add all scopes listed above

### Credentials
- **Client ID**: Hardcoded in package (public, safe)
- **Client Secret**: Used for token exchange

### Activation
- Development mode: Add test users manually
- Published: Submit for Zoom review

---

## README.md Content

```markdown
# @sweatco/zoom-mcp

MCP server for Zoom - access meeting transcripts and AI summaries from Claude.

## Features

- **List meetings** - Browse your recent Zoom meetings
- **Get transcripts** - Full verbatim transcripts from recorded meetings
- **Get AI summaries** - AI Companion meeting summaries and action items
- **Search** - Find meetings by keywords
- **Zero config** - Just authorize with your Zoom account

## Prerequisites

- Zoom Pro, Business, or Enterprise account
- Cloud recording OR AI Companion enabled for your meetings

## Installation

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

\`\`\`json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"]
    }
  }
}
\`\`\`

## First Use

1. Restart Claude after adding the config
2. Ask Claude about your Zoom meetings
3. Browser opens for one-time Zoom authorization
4. Done! No re-authorization needed.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_meetings` | List recent meetings with transcript/summary availability |
| `get_transcript` | Get full meeting transcript |
| `get_summary` | Get AI Companion meeting summary |
| `get_meeting` | Get meeting details and participants |
| `search_meetings` | Search meetings by keywords |

## Example Prompts

- "Show me my Zoom meetings from last week"
- "Get the transcript from my meeting with John yesterday"
- "What were the action items from yesterday's standup?"
- "Search my meetings for discussions about the product launch"
- "Summarize my meeting from this morning"

## Transcript Sources

The MCP automatically finds the best available transcript:

| Source | When Available |
|--------|----------------|
| Cloud Recording VTT | Meeting was cloud recorded with "Audio transcript" enabled |
| AI Companion Summary | AI Companion was enabled (recording not required) |

## Troubleshooting

**"No meetings found"**
- Check that you have cloud recordings or AI Companion enabled
- Verify your Zoom account is Pro/Business/Enterprise

**"Authorization required" keeps appearing**
- Run `npx @sweatco/zoom-mcp --logout` and re-authorize
- Check your Zoom account permissions

**"No transcript available"**
- The meeting may not have been recorded
- AI Companion may not have been enabled
- Transcript may still be processing (wait ~2x meeting duration)

## Privacy

- Credentials stored in your OS keychain (or `~/.config/zoom-mcp/`)
- Data only flows between your machine and Zoom's API
- Revoke access anytime: [Zoom App Marketplace](https://marketplace.zoom.us/user/installed)

## License

MIT
\`\`\`

---

## Publishing Guide

```bash
# Build
npm run build

# Version bump
npm version patch|minor|major

# Publish
npm publish --access public

# Push tags
git push && git push --tags
```

## Verification Checklist

- [ ] `npm run build` compiles without errors
- [ ] First run opens browser for OAuth
- [ ] Second run uses stored tokens (no browser)
- [ ] `list_meetings` returns meetings
- [ ] `get_transcript` returns formatted transcript
- [ ] `get_summary` returns AI summary (if available)
- [ ] `search_meetings` finds relevant meetings
- [ ] `--logout` clears tokens
- [ ] Works in Claude Desktop
- [ ] Works in Claude Code
