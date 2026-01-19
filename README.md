# @sweatco/zoom-mcp

MCP server for Zoom - access meeting transcripts and AI summaries from Claude.

## Features

- **List meetings** - Browse your recent Zoom meetings
- **Get transcripts** - Full verbatim transcripts from recorded meetings
- **Get AI summaries** - AI Companion meeting summaries with action items
- **Search** - Find meetings by keywords
- **Admin queries** - Admins can query any user's meetings (with proxy)

## Quick Start (Basic Setup)

Works with any organization. Just needs a Zoom OAuth app.

### Prerequisites

- Zoom Pro, Business, or Enterprise account
- Cloud recording OR AI Companion enabled for meetings

### Installation

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"],
      "env": {
        "ZOOM_CLIENT_ID": "xp0xI4xSSVSrzL0JRzOOgQ",
        "ZOOM_OAUTH_URL": "https://europe-west1-zoom-mcp-oauth.cloudfunctions.net/zoom-mcp-oauth"
      }
    }
  }
}
```

### First Use

1. Restart Claude after adding the config
2. Ask Claude about your Zoom meetings
3. Browser opens for one-time Zoom authorization
4. Done! No re-authorization needed.

## Zoom API Limitations

The basic setup uses Zoom's standard API, which has some limitations:

| Limitation | Impact |
|------------|--------|
| **Only hosted meetings** | You can only access meetings you hosted, not meetings you attended |
| **6-month history** | Report API only returns meetings from the last 6 months |
| **No cross-user queries** | Cannot query another user's meetings, even as admin |
| **Rate limits** | ~10 requests/second |

To overcome these limitations, set up the [Organization Proxy](#organization-proxy).

## Organization Proxy

The proxy removes API limitations by indexing meeting participation in your own infrastructure (Google Cloud). Benefits:

### What the Proxy Enables

| Feature | Without Proxy | With Proxy |
|---------|--------------|------------|
| Meetings you hosted | ✅ | ✅ |
| Meetings you attended | ❌ | ✅ |
| Historical data | 6 months | Unlimited (with backfill) |
| Admin: query any user | ❌ | ✅ |
| Admin: org-wide search | ❌ | ✅ |

### How It Works

1. **Webhook** captures `meeting.ended` events and indexes all participants
2. **Firestore** stores participant records in your GCP project
3. **Proxy API** verifies user identity and returns authorized meetings
4. **Backfill script** imports historical data

All data stays in your organization's infrastructure.

### Admin Capabilities

With the proxy, Zoom Owners and Admins (role_id 0 or 1) can:

- **Query any user's meetings**: `list_meetings` with `user_email` parameter
- **Access any meeting's transcript/summary**: No participation check required
- **Audit access**: All queries logged in Cloud Functions

Example: As admin, ask Claude "Show me meetings for user@company.com last week"

### Setup

See the full **[Proxy Setup Guide](docs/proxy-setup.md)** for step-by-step instructions.

Quick overview:
1. Create GCP project with Firestore
2. Create Zoom Server-to-Server OAuth app with admin scopes
3. Configure `meeting.ended` webhook
4. Deploy Cloud Functions (webhook handler, proxy API, cleanup job)
5. Run backfill script for historical data
6. Add `ZOOM_PROXY_URL` to MCP client config

### Configuration with Proxy

```json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"],
      "env": {
        "ZOOM_CLIENT_ID": "your-zoom-client-id",
        "ZOOM_OAUTH_URL": "https://REGION-PROJECT.cloudfunctions.net/zoom-mcp-oauth",
        "ZOOM_PROXY_URL": "https://REGION-PROJECT.cloudfunctions.net/zoom-proxy-api"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_meetings` | List recent meetings with transcript/summary availability |
| `get_transcript` | Get full meeting transcript |
| `get_summary` | Get AI Companion meeting summary |
| `get_meeting` | Get meeting details and participants |
| `search_meetings` | Search meetings by keywords |

### Admin-only Parameters

With proxy configured:

```
list_meetings:
  user_email: "user@company.com"  # Query another user's meetings (admin only)
```

## Example Prompts

**Basic:**
- "Show me my Zoom meetings from last week"
- "Get the transcript from my meeting with John yesterday"
- "What were the action items from yesterday's standup?"
- "Summarize my meeting from this morning"

**Admin (with proxy):**
- "Show me meetings for katie@company.com last week"
- "Get the summary of the all-hands meeting"
- "What did the product team discuss in their sync?"

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
- Without proxy: you can only see meetings you hosted

**"Authorization required" keeps appearing**
- Run `npx @sweatco/zoom-mcp --logout` and re-authorize
- Check your Zoom account permissions

**"No transcript available"**
- The meeting may not have been recorded
- AI Companion may not have been enabled
- Transcript may still be processing (wait ~2x meeting duration)

**"Admin access required"**
- Only Zoom Owners (role_id=0) and Admins (role_id=1) can query other users
- Requires proxy to be configured

## Privacy & Data

**Basic setup:**
- Credentials stored in your OS keychain (or `~/.config/zoom-mcp/`)
- Data flows only between your machine and Zoom's API

**With proxy:**
- Meeting participant data stored in your organization's GCP Firestore
- All data stays within your infrastructure
- Monthly cleanup job removes records older than 1 year

Revoke access anytime: [Zoom App Marketplace](https://marketplace.zoom.us/user/installed)

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

# Clear stored tokens
npx . --logout
```

### Cloud Functions

```bash
cd cloud-functions
npm install
npm run build
npm run deploy:oauth     # Deploy OAuth function
npm run deploy:webhook   # Deploy webhook handler
npm run deploy:api       # Deploy proxy API
npm run deploy:cleanup   # Deploy cleanup job
```

### Scripts

```bash
# Backfill historical data
npx tsx scripts/backfill.ts --from=2025-08-01 --to=2025-08-31

# Debug: check user meetings from Zoom API
npx tsx scripts/check-user-meetings.ts user@company.com

# Debug: check Firestore records
npx tsx scripts/check-firestore.ts user@company.com
```

## License

MIT
