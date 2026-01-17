# Zoom MCP Server

MCP server that lets Claude access Zoom meeting transcripts and AI summaries. Users can query their meetings, get transcripts, and search across meeting content.

## Architecture

**MVP1 (implemented)**: User OAuth flow - each user authorizes their own Zoom account, can only access meetings they hosted.

**MVP2 (planned)**: Admin proxy - Server-to-Server OAuth with admin scopes enables org-wide access. Users can access meetings they attended (not just hosted). See `docs/plans/mvp2.md`.

## Tech Stack

- TypeScript + ESM modules
- `@modelcontextprotocol/sdk` for MCP protocol
- Zoom OAuth 2.0 with browser flow
- Token storage: OS keychain (primary), file fallback

## Commands

```bash
npm run build           # Compile TypeScript
npm run dev             # Watch mode
npm start               # Run MCP server
npm run test:admin-api  # Test S2S OAuth (requires .env)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_meetings` | List recent meetings with transcript/summary availability |
| `get_transcript` | Get full meeting transcript (VTT or AI summary fallback) |
| `get_summary` | Get AI Companion meeting summary |
| `get_meeting` | Get meeting details and participants |
| `search_meetings` | Search across transcripts and summaries |

## Key Directories

- `src/` - MCP server implementation
- `cloud-function/` - GCP proxy scaffold (MVP2)
- `scripts/` - Development and testing utilities
- `docs/plans/` - Architecture plans (mvp1, mvp2)

## Testing

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Clear stored tokens
npx . --logout
```
