# Zoom MCP Server

MCP server that lets Claude access Zoom meeting transcripts and AI summaries. Users can query their meetings, get transcripts, and search across meeting content.

## Git Policy

**Do not commit or push automatically.** Always wait for explicit user confirmation before running git commit or git push.

## Architecture

**MVP1 (implemented)**: User OAuth flow - each user authorizes their own Zoom account, can only access meetings they hosted.

**MVP2 (implemented)**: Admin proxy - Server-to-Server OAuth with admin scopes enables org-wide access. Users can access meetings they attended (not just hosted). See `docs/plans/mvp2.md`.

**MVP3 (planned)**: Pre-registration rules & admin tools - Admins can pre-register users for meetings and grant/revoke access on-demand. See `docs/plans/mvp3.md`.

## Tech Stack

- TypeScript + ESM modules
- `@modelcontextprotocol/sdk` for MCP protocol
- Zoom OAuth 2.0 with browser flow
- Token storage: OS keychain (primary), file fallback
- Google Cloud Functions + Firestore (MVP2 proxy)

## Commands

```bash
npm run build           # Compile TypeScript
npm run dev             # Watch mode
npm start               # Run MCP server
npm run test:admin-api  # Test S2S OAuth (requires .env)
```

### Cloud Functions Commands
```bash
cd cloud-functions
npm run build           # Compile cloud functions
npm run deploy:oauth    # Deploy OAuth token exchange (MVP1)
npm run deploy:webhook  # Deploy webhook handler (MVP2)
npm run deploy:api      # Deploy proxy API (MVP2)
npm run deploy:cleanup  # Deploy cleanup job (MVP2)
```

### Scripts
```bash
npx tsx scripts/backfill.ts --from=2025-12-01 --to=2026-01-17  # Backfill historical data
npx tsx scripts/check-meeting.ts <meeting_id>                   # Debug meeting participants
npx tsx scripts/check-roles.ts <email>                          # Check user roles
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
- `cloud-functions/` - All cloud functions (OAuth, webhook, API proxy)
- `scripts/` - Development and testing utilities
- `docs/plans/` - Architecture plans (mvp1, mvp2, mvp3)

## Environment Variables

### MCP Client
- `ZOOM_PROXY_URL` - URL of the deployed proxy API (enables MVP2 features)

### Cloud Functions
- `ZOOM_CLIENT_ID` - User OAuth client ID (for OAuth function)
- `ZOOM_CLIENT_SECRET` - User OAuth client secret (stored in Secret Manager)
- `ZOOM_ADMIN_ACCOUNT_ID` - Zoom S2S OAuth account ID (for MVP2 functions)
- `ZOOM_ADMIN_CLIENT_ID` - Zoom S2S OAuth client ID (for MVP2 functions)
- `ZOOM_ADMIN_CLIENT_SECRET` - Zoom S2S OAuth client secret (stored in Secret Manager)
- `ZOOM_WEBHOOK_SECRET_TOKEN` - Webhook validation token (stored in Secret Manager)

## Testing

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Clear stored tokens
npx . --logout
```

## MVP2 Deployment

See `docs/plans/mvp2.md` for full setup guide. Quick reference:

1. Create Zoom S2S OAuth app with admin scopes
2. Configure `meeting.ended` webhook
3. Create Firestore database and deploy indexes
4. Store secrets in GCP Secret Manager
5. Deploy cloud functions
6. Run backfill script for historical data
7. Set `ZOOM_PROXY_URL` in MCP client config
