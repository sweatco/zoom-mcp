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

```json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"],
      "env": {
        "ZOOM_PROXY_URL": "https://your-proxy-url.cloudfunctions.net/zoom-proxy-api"
      }
    }
  }
}
```

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

## Organization Proxy (MVP2)

With `ZOOM_PROXY_URL` configured, you can access meetings you **attended** (not just hosted). This requires your organization admin to set up the proxy backend. Without the proxy, you can only access meetings you hosted.

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

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test locally
npx .

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
