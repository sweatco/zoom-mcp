# Zoom MCP Proxy Architecture Plan

## Problem Statement

The Zoom API only allows users to access meetings they host. Users cannot access summaries/transcripts for meetings they attended but didn't host, even when those summaries are shared with them in the Zoom UI.

## Solution Overview

Create a proxy layer using Cloud Functions + Firestore that:
1. Indexes meeting participation via webhooks
2. Verifies user identity via their OAuth token
3. Uses admin credentials to fetch data for meetings where user was a verified participant

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Zoom Webhook: meeting.ended                    │
│  Fires when any meeting ends in the Zoom account                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloud Function: webhook-handler                     │
│  - Receives meeting.ended event                                  │
│  - Extracts meeting info + all participants                      │
│  - Stores one record per participant in Firestore               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Firestore                                 │
│  Collection: meeting_participants                                │
│  Index: participant_email + start_time                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloud Functions: API Endpoints                      │
│  - POST /list-meetings     (query by user email)                │
│  - POST /get-summary       (verify participation, fetch data)   │
│  - POST /get-transcript    (verify participation, fetch data)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   MCP Client (local)                             │
│  - Authenticates user via normal OAuth flow                      │
│  - Passes user token to proxy for identity verification         │
│  - Receives data for meetings user participated in              │
└─────────────────────────────────────────────────────────────────┘
```

## Firestore Setup

### Database Configuration

Use **Firestore Native mode** (not Datastore mode):
- Better for composite queries (email + date range)
- Simple document structure
- Low volume workload

```bash
# Create Firestore database (Native mode is default)
gcloud firestore databases create --project=zoom-mcp-oauth --location=us-central1
```

### Volume Analysis (based on actual account data)

| Metric | Value |
|--------|-------|
| Active users | 133 |
| Avg meetings per user (30 days) | 6.0 |
| Avg participants per meeting | 3.1 |
| Estimated meetings/month | ~800 |
| Estimated participant records/month | ~2,500 |
| With all-hands (4x/month, 100 ppl) | ~2,900 |
| **Estimated records/year** | **~35,000** |

### Cost Estimate (Firestore pricing)

| Operation | Monthly Volume | Free Tier | Cost |
|-----------|---------------|-----------|------|
| Document writes | ~2,900 | 20K/day free | $0 |
| Document reads | ~10,000 (est.) | 50K/day free | $0 |
| Storage | ~35KB/month (~1KB/doc) | 1GB free | $0 |

**Conclusion**: Well within free tier. Even at 10x growth, costs would be negligible (~$1/month).

## Data Model

### Firestore Collection: `meeting_participants`

```typescript
interface MeetingParticipantRecord {
  // Identifiers
  instance_uuid: string;        // Primary - used for API calls
  meeting_id: string;           // Secondary - human readable

  // Meeting metadata
  topic: string;
  host_email: string;
  start_time: string;           // ISO timestamp
  end_time: string;
  duration_minutes: number;

  // Participant info
  participant_email: string;    // Indexed for queries
  participant_name: string;

  // Feature availability
  has_summary: boolean;
  has_recording: boolean;

  // Record metadata
  indexed_at: string;
}
```

**Document ID**: `{instance_uuid}_{sha256(participant_email).slice(0,8)}`
- Prevents duplicates if webhook fires multiple times
- Allows direct lookup if needed

### Firestore Indexes

```
Collection: meeting_participants
Composite Index:
  - participant_email ASC
  - start_time DESC
```

## Components

### 1. Webhook Handler

**Trigger**: Zoom `meeting.ended` webhook

**Responsibilities**:
- Validate webhook signature
- Extract meeting data and participant list
- Create one Firestore document per participant
- Handle idempotency (same meeting won't create duplicates)

**Webhook Payload** (relevant fields):
```json
{
  "event": "meeting.ended",
  "payload": {
    "object": {
      "id": "86239292937",
      "uuid": "abc123xyz==",
      "topic": "Team Standup",
      "host_id": "...",
      "host_email": "manager@sweatco.in",
      "start_time": "2026-01-16T10:00:00Z",
      "end_time": "2026-01-16T10:30:00Z",
      "duration": 30,
      "participant": [
        { "user_name": "Egor", "email": "egor@sweatco.in" },
        { "user_name": "Victor", "email": "victor@sweatco.in" }
      ]
    }
  }
}
```

### 2. List Meetings Endpoint

**URL**: `POST /list-meetings`

**Request**:
```typescript
Headers: {
  Authorization: "Bearer <user_oauth_token>"
}
Body: {
  from_date?: string;  // YYYY-MM-DD, default: 30 days ago
  to_date?: string;    // YYYY-MM-DD, default: today
  limit?: number;      // default: 50
}
```

**Flow**:
1. Validate user token via `GET /users/me` → extract email
2. Query Firestore by participant_email + date range
3. Return meeting list

**Response**:
```typescript
{
  meetings: [
    {
      instance_uuid: string;
      meeting_id: string;
      topic: string;
      date: string;
      duration_minutes: number;
      host_email: string;
      has_summary: boolean;
      has_recording: boolean;
    }
  ]
}
```

### 3. Get Summary Endpoint

**URL**: `POST /get-summary`

**Request**:
```typescript
Headers: {
  Authorization: "Bearer <user_oauth_token>"
}
Body: {
  instance_uuid: string;
}
```

**Flow**:
1. Validate user token → extract email
2. Check Firestore: is user a participant of this instance_uuid?
3. If no → 403 Forbidden
4. If yes → use admin credentials to fetch summary from Zoom API
5. Return summary data

### 4. Get Transcript Endpoint

**URL**: `POST /get-transcript`

Same pattern as get-summary.

### 5. Backfill Worker

**Trigger**: Manual (one-time or periodic)

**Purpose**: Import historical meeting data for meetings that occurred before webhook was set up.

**Flow**:
1. Use admin credentials to list all users in account
2. For each user, list their hosted meetings in date range
3. For each meeting, get participants
4. Store participant records in Firestore

**Considerations**:
- Rate limiting (Zoom API limits)
- Pagination handling
- Progress tracking (to resume if interrupted)

## Security

### Authentication Flow

```
User                    MCP Client              Cloud Function           Zoom API
  │                         │                         │                      │
  │  OAuth login ──────────►│                         │                      │
  │                         │  Redirect to Zoom ─────────────────────────────►
  │                         │                         │                      │
  │  ◄─────────────────────────────────────────────── Access token ◄────────│
  │                         │                         │                      │
  │  list meetings ────────►│                         │                      │
  │                         │  POST /list-meetings ──►│                      │
  │                         │  + Bearer token         │                      │
  │                         │                         │  GET /users/me ─────►│
  │                         │                         │  (validate token)    │
  │                         │                         │  ◄── user email ─────│
  │                         │                         │                      │
  │                         │                         │  Query Firestore     │
  │                         │                         │  (by email)          │
  │                         │                         │                      │
  │                         │  ◄── meetings list ─────│                      │
  │  ◄── meetings ──────────│                         │                      │
```

### Admin Credentials Storage

- **Client Secret**: Store in Google Cloud Secret Manager (sensitive)
- **Account ID & Client ID**: Regular environment variables (not sensitive)
- Access via Cloud Function IAM
- Never exposed to client
- Rotate periodically

```bash
# Create secret for client secret only
gcloud secrets create zoom-admin-client-secret --project=zoom-mcp-oauth
echo -n "YOUR_CLIENT_SECRET" | gcloud secrets versions add zoom-admin-client-secret --data-file=-

# Deploy with env vars + secret
gcloud functions deploy zoom-proxy-api \
  --set-env-vars=ZOOM_ADMIN_ACCOUNT_ID=xxx,ZOOM_ADMIN_CLIENT_ID=yyy \
  --set-secrets=ZOOM_ADMIN_CLIENT_SECRET=zoom-admin-client-secret:latest
```

### Required Admin Scopes (Server-to-Server OAuth)

Zoom uses granular scope names. The following scopes have been tested and verified:

```
user:read:list_users:admin                  - List all users in account
user:read:user:admin                        - Get user details by ID/email
meeting:read:past_meeting:admin             - Get past meeting details
meeting:read:list_past_instances:admin      - Get meeting instances by meeting ID
meeting:read:list_past_participants:admin   - Get participants for any meeting
meeting:read:summary:admin                  - Get AI summary for any meeting
cloud_recording:read:list_user_recordings:admin   - List recordings by user
cloud_recording:read:list_recording_files:admin   - Get recording files/transcripts
report:read:user:admin                      - Access user reports
report:read:list_history_meetings:admin     - List all meetings hosted by a user
```

## Zoom API Endpoints Reference

All endpoints tested and verified with admin scopes:

### Authentication
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://zoom.us/oauth/token` | POST | Get S2S OAuth token (grant_type=account_credentials) |

### Users
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/users` | GET | List all users in account (page_size up to 300) |
| `/v2/users/{userId}` | GET | Get user by ID or email |
| `/v2/users/me` | GET | Get current user (validates OAuth token) |

### Meetings
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/past_meetings/{meetingId}/instances` | GET | Get all instances of a recurring meeting |
| `/v2/past_meetings/{instanceUuid}` | GET | Get past meeting details (double-encode UUID) |
| `/v2/past_meetings/{instanceUuid}/participants` | GET | Get meeting participants |
| `/v2/meetings/{instanceUuid}/meeting_summary` | GET | Get AI Companion summary |
| `/v2/meetings/{instanceUuid}/recordings` | GET | Get recording files including VTT transcript |

### Reports (for listing hosted meetings)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/report/users/{userId}/meetings` | GET | List all meetings hosted by user (requires from/to dates) |

### Important Notes

1. **Instance UUID encoding**: UUIDs containing `/` or `=` must be double URL-encoded:
   ```typescript
   const encodedUuid = encodeURIComponent(encodeURIComponent(instanceUuid));
   ```

2. **Report API date range**: Max 30 days per request, dates in YYYY-MM-DD format

3. **Pagination**: Most list endpoints support `page_size` (max 300) and `next_page_token`

4. **Rate limits**: ~10 requests/second for most endpoints

## Implementation Plan

### Phase 1: Infrastructure Setup
- [ ] Create Firestore database in `zoom-mcp-oauth` project
- [ ] Create composite index on meeting_participants collection
- [ ] Set up Secret Manager with admin Zoom credentials
- [ ] Configure Zoom webhook for `meeting.ended`

### Phase 2: Webhook Handler
- [ ] Create Cloud Function `zoom-webhook-handler`
- [ ] Implement webhook signature validation
- [ ] Implement participant record creation
- [ ] Deploy and test with real meetings

### Phase 3: API Endpoints
- [ ] Create Cloud Function `zoom-proxy-api`
- [ ] Implement `/list-meetings` endpoint
- [ ] Implement `/get-summary` endpoint
- [ ] Implement `/get-transcript` endpoint
- [ ] Deploy and test

### Phase 4: MCP Client Update
- [ ] Add proxy URL constant
- [ ] Update `listMeetings` to use proxy for past meetings
- [ ] Update `getSummary` to use proxy
- [ ] Update `getTranscript` to use proxy
- [ ] Keep direct API calls for user's own hosted meetings (fallback)

### Phase 5: Backfill
- [ ] Create backfill worker Cloud Function
- [ ] Run initial backfill for last 30-90 days
- [ ] Verify data integrity

## API Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/webhook` | POST | Zoom signature | Receive meeting.ended events |
| `/list-meetings` | POST | User token | List meetings user participated in |
| `/get-summary` | POST | User token | Get summary (with participation check) |
| `/get-transcript` | POST | User token | Get transcript (with participation check) |
| `/backfill` | POST | Admin only | Trigger historical data import |

## Open Questions

1. **Webhook setup**: Who has admin access to configure Zoom webhooks?
2. **Historical depth**: How far back should we backfill? (30 days? 90 days? 1 year?)
3. **Data retention**: Should we auto-delete old records? What's the retention policy?
4. **Rate limits**: How to handle Zoom API rate limits during backfill?
5. **Costs**: Firestore read/write costs - need to estimate based on meeting volume

## Files to Create/Modify

### New Files (Cloud Functions)
```
cloud-functions/
├── src/
│   ├── webhook-handler.ts      # Process meeting.ended
│   ├── list-meetings.ts        # Query participated meetings
│   ├── get-summary.ts          # Fetch summary with auth
│   ├── get-transcript.ts       # Fetch transcript with auth
│   ├── backfill.ts             # Historical data import
│   ├── admin-client.ts         # Zoom client with admin creds
│   └── utils/
│       ├── validate-token.ts   # User token validation
│       └── firestore.ts        # Firestore helpers
├── package.json
└── tsconfig.json
```

### Modified Files (MCP Client)
```
zoom-mcp/src/
├── tools/
│   ├── list-meetings.ts        # Add proxy call path
│   ├── get-summary.ts          # Add proxy call path
│   └── get-transcript.ts       # Add proxy call path
└── proxy-client.ts             # New: proxy API client
```
