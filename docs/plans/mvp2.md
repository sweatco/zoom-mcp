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

**Required Index**: Composite index on `participant_email` (ASC) + `start_time` (DESC). See Setup Guide for deployment.

## Components

### 1. Webhook Handler

**Trigger**: Zoom `meeting.ended` webhook

**Responsibilities**:
- Validate webhook signature
- Extract meeting data and participant list
- **Always create a record for the host** (even if not in participant list)
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
      "host_email": "manager@example.com",
      "start_time": "2026-01-16T10:00:00Z",
      "end_time": "2026-01-16T10:30:00Z",
      "duration": 30,
      "participant": [
        { "user_name": "Alice", "email": "alice@example.com" },
        { "user_name": "Bob", "email": "bob@example.com" }
      ]
    }
  }
}
```

**Host Handling**:
```typescript
// Always ensure host has a participation record
const participants = new Map<string, ParticipantInfo>();

// Add host first (from webhook payload, always available)
if (payload.object.host_email) {
  participants.set(payload.object.host_email, {
    email: payload.object.host_email,
    name: payload.object.user_name || 'Host',
    is_host: true,
  });
}

// Add all participants (may include host, Map dedupes by email)
for (const p of payload.object.participant || []) {
  if (p.email) {
    const existing = participants.get(p.email);
    participants.set(p.email, {
      email: p.email,
      name: p.user_name,
      is_host: existing?.is_host || false,
    });
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

### 5. Backfill Worker (Local Script)

**Location**: `scripts/backfill.ts` (run locally, not deployed to GCP)

**Purpose**: Import historical meeting data for meetings that occurred before webhook was set up.

**Usage**:
```bash
# Set up .env with admin credentials
npm run backfill -- --from=2025-12-01 --to=2026-01-17
```

**Flow**:
1. Use admin credentials to list all users in account
2. For each user, list their hosted meetings in date range
3. For each meeting, get participants
4. Store participant records in Firestore

**Considerations**:
- Rate limiting (Zoom API limits ~10 req/sec)
- Pagination handling
- Progress tracking (to resume if interrupted)
- Requires `GOOGLE_APPLICATION_CREDENTIALS` for Firestore access

### 6. Cleanup Job (Cloud Scheduler)

**Trigger**: Cloud Scheduler, runs monthly (1st of each month)

**Purpose**: Delete meeting records older than 1 year to maintain data retention policy.

**Implementation**:
```typescript
// Delete documents where start_time < (now - 365 days)
const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
const oldDocs = await db.collection('meeting_participants')
  .where('start_time', '<', cutoff.toISOString())
  .limit(500)
  .get();

// Batch delete (Firestore limit: 500 per batch)
const batch = db.batch();
oldDocs.docs.forEach(doc => batch.delete(doc.ref));
await batch.commit();
```

**Setup**: See Step 8 in Setup Guide.

## Admin Mode

### Overview

Zoom account Owners and Admins can query **any meeting** in the account without the participation check. This enables privileged users to access all meeting data for support, compliance, or administrative purposes.

### Zoom Role IDs (Fixed)

Zoom uses fixed role IDs across all accounts ([confirmed by Zoom](https://devforum.zoom.us/t/default-roles-in-all-zoom-account/60303)):

| Role | role_id | Access Level |
|------|---------|--------------|
| Owner | 0 | Full admin mode |
| Admin | 1 | Full admin mode |
| Member | 2 | Participation-based only |

### Implementation

When validating a user's token, also fetch their `role_id`:

```typescript
// In validate-token.ts
interface UserInfo {
  email: string;
  role_id: number;
  isAdmin: boolean;  // role_id <= 1
}

async function validateUserToken(token: string): Promise<UserInfo> {
  const res = await fetch('https://api.zoom.us/v2/users/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const user = await res.json();
  return {
    email: user.email,
    role_id: user.role_id,
    isAdmin: user.role_id <= 1
  };
}
```

### Modified Endpoint Behavior

#### `/list-meetings`

```typescript
// Request body gains optional parameters for admins
Body: {
  from_date?: string;
  to_date?: string;
  limit?: number;
  // Admin-only parameters:
  user_email?: string;      // Query meetings for specific user (admin only)
  all_meetings?: boolean;   // Return all meetings, not filtered by participation
}
```

**Flow**:
1. Validate token → get email + role_id
2. If `isAdmin` AND (`user_email` OR `all_meetings`):
   - Query Firestore without participation filter (or filter by specified user_email)
3. Else:
   - Standard flow: filter by authenticated user's email

#### `/get-summary` and `/get-transcript`

**Flow**:
1. Validate token → get email + role_id
2. If `isAdmin`:
   - Skip participation check, fetch data directly
3. Else:
   - Check Firestore for participation record
   - 403 if not a participant

### Security Considerations

- Role check happens server-side using the user's OAuth token
- Admin status cannot be spoofed (derived from Zoom's `/users/me` response)
- All admin access is auditable via Cloud Function logs
- Consider adding explicit audit logging for admin queries

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

## Setup Guide

### Step 1: Create Zoom Server-to-Server OAuth App

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/) → Develop → Build App
2. Choose **Server-to-Server OAuth** app type
3. Fill in app name (e.g., "Zoom MCP Proxy")
4. Note down:
   - **Account ID**
   - **Client ID**
   - **Client Secret**
5. Add required scopes (see "Required Admin Scopes" section above)
6. Activate the app

### Step 2: Configure Webhook

1. In the same app, go to **Feature** → **Event Subscriptions**
2. Toggle "Event Subscriptions" ON
3. Click **Add Event Subscription**:
   - Subscription Name: `meeting-ended`
   - Event notification endpoint URL: `https://<region>-<project>.cloudfunctions.net/zoom-webhook-handler`
4. Click **Add Events** → Meeting → `meeting.ended`
5. Save and note down the **Secret Token** (generated automatically)

### Step 3: Set Up GCP Project

```bash
# Set project
gcloud config set project zoom-mcp-oauth

# Enable required APIs
gcloud services enable \
  cloudfunctions.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com
```

### Step 4: Create Firestore Database

```bash
# Create Firestore database (Native mode is default)
gcloud firestore databases create --location=us-central1
```

### Step 5: Deploy Firestore Indexes

Create `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "meeting_participants",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "participant_email", "order": "ASCENDING" },
        { "fieldPath": "start_time", "order": "DESCENDING" }
      ]
    }
  ]
}
```

Deploy:
```bash
firebase deploy --only firestore:indexes --project=zoom-mcp-oauth
```

### Step 6: Store Secrets

```bash
# Store Client Secret
gcloud secrets create zoom-admin-client-secret
echo -n "YOUR_CLIENT_SECRET" | gcloud secrets versions add zoom-admin-client-secret --data-file=-

# Store Webhook Secret Token
gcloud secrets create zoom-webhook-secret-token
echo -n "YOUR_WEBHOOK_SECRET_TOKEN" | gcloud secrets versions add zoom-webhook-secret-token --data-file=-
```

### Step 7: Deploy Cloud Functions

```bash
# Deploy webhook handler
gcloud functions deploy zoom-webhook-handler \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars=ZOOM_ADMIN_ACCOUNT_ID=xxx,ZOOM_ADMIN_CLIENT_ID=yyy \
  --set-secrets=ZOOM_ADMIN_CLIENT_SECRET=zoom-admin-client-secret:latest,ZOOM_WEBHOOK_SECRET_TOKEN=zoom-webhook-secret-token:latest \
  --source=cloud-functions/

# Deploy API endpoints
gcloud functions deploy zoom-proxy-api \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars=ZOOM_ADMIN_ACCOUNT_ID=xxx,ZOOM_ADMIN_CLIENT_ID=yyy \
  --set-secrets=ZOOM_ADMIN_CLIENT_SECRET=zoom-admin-client-secret:latest \
  --source=cloud-functions/
```

### Step 8: Deploy Cleanup Job

```bash
# Deploy cleanup function (authenticated only - no public access)
gcloud functions deploy zoom-cleanup \
  --runtime=nodejs20 \
  --trigger-http \
  --no-allow-unauthenticated \
  --project=zoom-mcp-oauth

# Grant Cloud Scheduler's service account permission to invoke the function
gcloud functions add-invoker-policy-binding zoom-cleanup \
  --member="serviceAccount:zoom-mcp-oauth@appspot.gserviceaccount.com" \
  --project=zoom-mcp-oauth

# Create Cloud Scheduler job (1st of month at 3am UTC)
gcloud scheduler jobs create http zoom-cleanup-monthly \
  --location=us-central1 \
  --schedule="0 3 1 * *" \
  --uri="https://us-central1-zoom-mcp-oauth.cloudfunctions.net/zoom-cleanup" \
  --oidc-service-account-email=zoom-mcp-oauth@appspot.gserviceaccount.com \
  --project=zoom-mcp-oauth
```

**Security**: The function uses `--no-allow-unauthenticated`, meaning only requests with valid IAM credentials can invoke it. Cloud Scheduler authenticates using OIDC tokens signed by the project's App Engine service account.

### Step 9: Update Webhook URL in Zoom

After deploying, update the webhook URL in Zoom app settings with the actual Cloud Function URL.

### Step 10: Validate Webhook

Zoom will send a validation challenge to your endpoint. The webhook handler must respond with:
```json
{
  "plainToken": "<received_plain_token>",
  "encryptedToken": "<hmac_sha256(plain_token, secret_token)>"
}
```

### Credentials Summary

| Credential | Source | Storage | Usage |
|------------|--------|---------|-------|
| Account ID | Zoom App | Env var `ZOOM_ADMIN_ACCOUNT_ID` | S2S OAuth token request |
| Client ID | Zoom App | Env var `ZOOM_ADMIN_CLIENT_ID` | S2S OAuth token request |
| Client Secret | Zoom App | Secret Manager | S2S OAuth token request |
| Webhook Secret Token | Zoom App | Secret Manager | Webhook signature validation |

---

## Implementation Plan

### Phase 1: Infrastructure Setup
- [ ] Create Zoom S2S OAuth app with required scopes
- [ ] Configure webhook subscription for `meeting.ended`
- [ ] Create GCP project and enable APIs
- [ ] Create Firestore database
- [ ] Deploy Firestore indexes
- [ ] Store secrets in Secret Manager

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
- [ ] Create local backfill script (`scripts/backfill.ts`)
- [ ] Run initial backfill for last 180 days
- [ ] Verify data integrity

### Phase 6: Cleanup Job
- [ ] Create cleanup Cloud Function
- [ ] Set up Cloud Scheduler for monthly execution
- [ ] Test deletion logic

## API Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/webhook` | POST | Zoom signature | Receive meeting.ended events |
| `/list-meetings` | POST | User token | List meetings (participation filter; admins can query all) |
| `/get-summary` | POST | User token | Get summary (participation check; admins bypass) |
| `/get-transcript` | POST | User token | Get transcript (participation check; admins bypass) |

## Decisions

1. **Webhook setup**: Egor has admin access and will configure
2. **Historical depth**: Backfill last 180 days
3. **Data retention**: Keep 1 year of data. Monthly cleanup job deletes records older than 365 days
4. **Rate limits**: Backfill script implements throttling (~10 req/sec with exponential backoff on 429)
5. **Costs**: Within free tier (miniscule volume)
6. **Admin mode**: Owners (role_id=0) and Admins (role_id=1) can query any meeting without participation check
7. **Participation check**: Firestore-only (no Zoom API fallback). Requires reliable webhook + backfill coverage.
8. **Host access**: Host always gets a participation record, even if they didn't join the meeting
9. **Pre-registration & admin tools**: Deferred to MVP3 (see `docs/plans/mvp3.md`)

## Files to Create/Modify

### New Files (Cloud Functions)
```
cloud-functions/
├── src/
│   ├── webhook-handler.ts      # Process meeting.ended
│   ├── list-meetings.ts        # Query participated meetings
│   ├── get-summary.ts          # Fetch summary with auth
│   ├── get-transcript.ts       # Fetch transcript with auth
│   ├── cleanup.ts              # Monthly data retention cleanup
│   ├── admin-client.ts         # Zoom client with admin creds
│   └── utils/
│       ├── validate-token.ts   # User token validation
│       └── firestore.ts        # Firestore helpers
├── package.json
└── tsconfig.json
```

### New Files (Local Scripts)
```
scripts/
└── backfill.ts                 # Historical data import (run locally)
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
