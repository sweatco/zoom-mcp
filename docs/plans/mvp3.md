# MVP3: Pre-registration Rules & Admin Tools

## Overview

MVP3 adds the ability for admins to pre-register users for meetings, granting them access to transcripts/summaries even if they didn't attend. It also provides MCP tools for admins to manage both pre-registration rules and individual meeting access grants.

**Dependency**: Requires MVP2 (proxy architecture) to be complete.

## Features

### 1. Pre-registration Rules

Admins can define rules that automatically grant meeting access to specified users when a meeting ends.

**Use cases**:
- Recurring team standups: all team members get access even if they miss one
- All-hands meetings: entire company (or department) gets access
- Project meetings: all project members get access regardless of attendance

### 2. Individual Access Grants

Admins can grant access to specific meeting instances on-demand.

**Use cases**:
- Sharing meeting content with someone who should have context
- Compliance/HR access to specific meetings
- Granting access to a recording after the fact

## Data Model

### Firestore Collection: `meeting_access_rules`

One document per meeting_id + email combination (same pattern as `meeting_participants`).

```typescript
interface MeetingAccessRule {
  // Identifiers (composite key: meeting_id + email)
  meeting_id: string;            // Zoom meeting ID (not instance UUID)
  email: string;                 // User who should have access

  // Audit trail
  created_by: string;            // Admin email who created the rule
  created_at: string;            // ISO timestamp

  // Optional metadata
  description?: string;          // Human-readable description (e.g., "Backend Team Standup")
}
```

**Document ID**: `{meeting_id}_{sha256(email).slice(0,8)}`
- Prevents duplicates (same meeting + email)
- Allows direct lookup

**Indexes**:
- `meeting_id` (for webhook lookup)
- `email` (for listing rules by user)

### Enhanced `meeting_participants` Record

Add a field to distinguish source:

```typescript
interface MeetingParticipantRecord {
  // ... existing fields ...

  // Source tracking
  source: 'webhook' | 'backfill' | 'preregistration' | 'manual_grant';
  granted_by?: string;           // Admin email (for preregistration/manual_grant)
}
```

## Webhook Handler Enhancement

When `meeting.ended` fires, after processing actual participants:

```typescript
async function processPreregisteredUsers(
  meetingId: string,
  instanceUuid: string,
  meetingData: MeetingData,
  adminToken: string
): Promise<void> {
  // 1. Look up pre-registration rules for this meeting ID
  const rules = await db.collection('meeting_access_rules')
    .where('meeting_id', '==', meetingId)
    .get();

  if (rules.empty) return;

  // 2. Process each pre-registered email
  const batch = db.batch();

  for (const ruleDoc of rules.docs) {
    const rule = ruleDoc.data();
    const email = rule.email;

    // Skip if already a participant (check by document ID pattern)
    const participantDocId = `${instanceUuid}_${sha256(email).slice(0, 8)}`;
    const existingDoc = await db.collection('meeting_participants').doc(participantDocId).get();
    if (existingDoc.exists) continue;

    // Validate email against Zoom (filter out departed employees)
    const userCheck = await fetch(`https://api.zoom.us/v2/users/${email}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!userCheck.ok) continue;  // Skip invalid/departed users silently

    // Create participation record
    batch.set(db.collection('meeting_participants').doc(participantDocId), {
      instance_uuid: instanceUuid,
      meeting_id: meetingId,
      topic: meetingData.topic,
      host_email: meetingData.host_email,
      start_time: meetingData.start_time,
      end_time: meetingData.end_time,
      duration_minutes: meetingData.duration,
      participant_email: email,
      participant_name: email.split('@')[0],  // Fallback name
      has_summary: meetingData.has_summary,
      has_recording: meetingData.has_recording,
      indexed_at: new Date().toISOString(),
      source: 'preregistration',
    });
  }

  await batch.commit();
}
```

## MCP Admin Tools

### Tool: `manage_meeting_access_rule`

Add or remove pre-registration rules (one email at a time, or batch).

```typescript
// MCP Tool Definition
{
  name: 'manage_meeting_access_rule',
  description: 'Add or remove meeting access rules. Admin only.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'list'],
        description: 'Action to perform'
      },
      meeting_id: {
        type: 'string',
        description: 'Zoom meeting ID (required for add/remove)'
      },
      emails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Emails to add/remove access for'
      },
      description: {
        type: 'string',
        description: 'Human-readable description (for add)'
      }
    },
    required: ['action']
  }
}

// Implementation
async function manageAccessRule(params: ManageAccessRuleParams): Promise<ToolResult> {
  // 1. Validate caller is admin
  const userInfo = await validateUserToken(userToken);
  if (!userInfo.isAdmin) {
    return { error: 'Admin access required' };
  }

  switch (params.action) {
    case 'add':
      const batch = db.batch();
      for (const email of params.emails) {
        const docId = `${params.meeting_id}_${sha256(email).slice(0, 8)}`;
        batch.set(db.collection('meeting_access_rules').doc(docId), {
          meeting_id: params.meeting_id,
          email: email,
          description: params.description,
          created_by: userInfo.email,
          created_at: new Date().toISOString(),
        });
      }
      await batch.commit();
      return { success: true, added: params.emails.length };

    case 'remove':
      const deleteBatch = db.batch();
      for (const email of params.emails) {
        const docId = `${params.meeting_id}_${sha256(email).slice(0, 8)}`;
        deleteBatch.delete(db.collection('meeting_access_rules').doc(docId));
      }
      await deleteBatch.commit();
      return { success: true, removed: params.emails.length };

    case 'list':
      // List by meeting_id or list all
      let query = db.collection('meeting_access_rules');
      if (params.meeting_id) {
        query = query.where('meeting_id', '==', params.meeting_id);
      }
      const rules = await query.get();

      // Group by meeting_id for readability
      const grouped: Record<string, { emails: string[], description?: string }> = {};
      for (const doc of rules.docs) {
        const data = doc.data();
        if (!grouped[data.meeting_id]) {
          grouped[data.meeting_id] = { emails: [], description: data.description };
        }
        grouped[data.meeting_id].emails.push(data.email);
      }
      return { rules: grouped };
  }
}
```

### Tool: `grant_meeting_access`

Grant access to a specific meeting instance.

```typescript
// MCP Tool Definition
{
  name: 'grant_meeting_access',
  description: 'Grant a user access to a specific meeting instance. Admin only.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_uuid: {
        type: 'string',
        description: 'Meeting instance UUID'
      },
      email: {
        type: 'string',
        description: 'Email to grant access to'
      }
    },
    required: ['instance_uuid', 'email']
  }
}

// Implementation
async function grantMeetingAccess(params: GrantAccessParams): Promise<ToolResult> {
  // 1. Validate caller is admin
  const userInfo = await validateUserToken(userToken);
  if (!userInfo.isAdmin) {
    return { error: 'Admin access required' };
  }

  // 2. Validate the email exists in Zoom
  const userCheck = await fetch(`https://api.zoom.us/v2/users/${params.email}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (!userCheck.ok) {
    return { error: `User ${params.email} not found in Zoom account` };
  }

  // 3. Get meeting details to populate the record
  const encodedUuid = encodeURIComponent(encodeURIComponent(params.instance_uuid));
  const meetingRes = await fetch(`https://api.zoom.us/v2/past_meetings/${encodedUuid}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (!meetingRes.ok) {
    return { error: `Meeting ${params.instance_uuid} not found` };
  }
  const meeting = await meetingRes.json();

  // 4. Check if record already exists
  const existingDoc = await db.collection('meeting_participants')
    .where('instance_uuid', '==', params.instance_uuid)
    .where('participant_email', '==', params.email)
    .limit(1)
    .get();

  if (!existingDoc.empty) {
    return { success: true, message: 'User already has access' };
  }

  // 5. Create participation record
  const docId = `${params.instance_uuid}_${sha256(params.email).slice(0, 8)}`;
  await db.collection('meeting_participants').doc(docId).set({
    instance_uuid: params.instance_uuid,
    meeting_id: meeting.id.toString(),
    topic: meeting.topic,
    host_email: meeting.host_email,
    start_time: meeting.start_time,
    end_time: meeting.end_time,
    duration_minutes: meeting.duration,
    participant_email: params.email,
    participant_name: params.email.split('@')[0],
    has_summary: true,  // Assume available, will fail gracefully if not
    has_recording: true,
    indexed_at: new Date().toISOString(),
    source: 'manual_grant',
    granted_by: userInfo.email,
  });

  return { success: true, message: `Access granted to ${params.email}` };
}
```

### Tool: `revoke_meeting_access`

Revoke manually-granted access (not applicable to actual participants).

```typescript
// MCP Tool Definition
{
  name: 'revoke_meeting_access',
  description: 'Revoke manually-granted access to a meeting instance. Admin only.',
  inputSchema: {
    type: 'object',
    properties: {
      instance_uuid: {
        type: 'string',
        description: 'Meeting instance UUID'
      },
      email: {
        type: 'string',
        description: 'Email to revoke access from'
      }
    },
    required: ['instance_uuid', 'email']
  }
}

// Implementation
async function revokeMeetingAccess(params: RevokeAccessParams): Promise<ToolResult> {
  // 1. Validate caller is admin
  const userInfo = await validateUserToken(userToken);
  if (!userInfo.isAdmin) {
    return { error: 'Admin access required' };
  }

  // 2. Find the record
  const docs = await db.collection('meeting_participants')
    .where('instance_uuid', '==', params.instance_uuid)
    .where('participant_email', '==', params.email)
    .get();

  if (docs.empty) {
    return { error: 'No access record found' };
  }

  // 3. Only allow revoking manual grants or preregistration
  const doc = docs.docs[0];
  const data = doc.data();
  if (data.source === 'webhook' || data.source === 'backfill') {
    return { error: 'Cannot revoke access for actual meeting participants' };
  }

  // 4. Delete the record
  await doc.ref.delete();

  return { success: true, message: `Access revoked for ${params.email}` };
}
```

## API Endpoints

### New Endpoint: `POST /manage-access-rule`

Proxies `manage_meeting_access_rule` tool calls.

### New Endpoint: `POST /grant-access`

Proxies `grant_meeting_access` tool calls.

### New Endpoint: `POST /revoke-access`

Proxies `revoke_meeting_access` tool calls.

## Security Considerations

1. **Admin-only**: All management tools require `role_id <= 1`
2. **Audit trail**: All operations store `created_by`/`granted_by` with admin email
3. **Validation**: Pre-registered emails are validated against Zoom at webhook time
4. **Departed employees**: Invalid emails are silently skipped (self-cleaning)
5. **Cannot revoke real participants**: Only manual grants can be revoked

## Cleanup Job: Stale Rule Removal

### Overview

A periodic job that validates all emails in `meeting_access_rules` against active Zoom users and removes rules for departed employees. This keeps the rules table clean and prevents unnecessary processing during webhooks.

### Implementation

```typescript
// Cloud Function: cleanup-access-rules
// Trigger: Cloud Scheduler (weekly, e.g., Sunday 2am UTC)

async function cleanupStaleAccessRules(): Promise<{ removed: number; checked: number }> {
  const adminToken = await getAdminToken();

  // 1. Get all active Zoom users (paginated)
  const activeEmails = new Set<string>();
  let nextPageToken: string | undefined;

  do {
    const url = new URL('https://api.zoom.us/v2/users');
    url.searchParams.set('page_size', '300');
    url.searchParams.set('status', 'active');
    if (nextPageToken) {
      url.searchParams.set('next_page_token', nextPageToken);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json();

    for (const user of data.users || []) {
      activeEmails.add(user.email.toLowerCase());
    }

    nextPageToken = data.next_page_token;
  } while (nextPageToken);

  console.log(`Found ${activeEmails.size} active Zoom users`);

  // 2. Get all access rules
  const allRules = await db.collection('meeting_access_rules').get();
  console.log(`Checking ${allRules.size} access rules`);

  // 3. Find rules for emails not in active users list
  const batch = db.batch();
  let removedCount = 0;
  const removedEmails = new Set<string>();

  for (const doc of allRules.docs) {
    const email = doc.data().email.toLowerCase();
    if (!activeEmails.has(email)) {
      batch.delete(doc.ref);
      removedCount++;
      removedEmails.add(email);
    }
  }

  if (removedCount > 0) {
    await batch.commit();
    console.log(`Removed ${removedCount} stale rules for departed users:`, [...removedEmails]);
  }

  return { removed: removedCount, checked: allRules.size };
}
```

### Deployment

```bash
# Deploy cleanup function (authenticated only)
gcloud functions deploy zoom-cleanup-access-rules \
  --runtime=nodejs20 \
  --trigger-http \
  --no-allow-unauthenticated \
  --set-env-vars=ZOOM_ADMIN_ACCOUNT_ID=xxx,ZOOM_ADMIN_CLIENT_ID=yyy \
  --set-secrets=ZOOM_ADMIN_CLIENT_SECRET=zoom-admin-client-secret:latest \
  --project=zoom-mcp-oauth

# Create Cloud Scheduler job (every Sunday at 2am UTC)
gcloud scheduler jobs create http zoom-cleanup-access-rules-weekly \
  --location=us-central1 \
  --schedule="0 2 * * 0" \
  --uri="https://us-central1-zoom-mcp-oauth.cloudfunctions.net/zoom-cleanup-access-rules" \
  --oidc-service-account-email=zoom-mcp-oauth@appspot.gserviceaccount.com \
  --project=zoom-mcp-oauth
```

### Considerations

- **Efficiency**: Fetches full user list once (~1-2 API calls for 133 users) instead of N calls per email
- **Case-insensitive**: Emails normalized to lowercase for comparison
- **Frequency**: Weekly is sufficient — departed employees are also filtered at webhook time
- **Batch size**: Firestore batch limit is 500; for large rule sets, split into multiple batches
- **Logging**: Log removed emails for audit trail

## Implementation Plan

### Phase 1: Data Model
- [ ] Add `meeting_access_rules` collection
- [ ] Add `source` and `granted_by` fields to `meeting_participants` schema
- [ ] Deploy Firestore index for `meeting_access_rules.meeting_id`

### Phase 2: Webhook Enhancement
- [ ] Add `processPreregisteredUsers` function to webhook handler
- [ ] Test with a sample rule

### Phase 3: Admin Endpoints
- [ ] Implement `/manage-access-rule` endpoint
- [ ] Implement `/grant-access` endpoint
- [ ] Implement `/revoke-access` endpoint
- [ ] Deploy to Cloud Functions

### Phase 4: MCP Tools
- [ ] Add `manage_meeting_access_rule` tool to MCP client
- [ ] Add `grant_meeting_access` tool to MCP client
- [ ] Add `revoke_meeting_access` tool to MCP client
- [ ] Test end-to-end

### Phase 5: Cleanup Job
- [ ] Implement `cleanup-access-rules` Cloud Function
- [ ] Set up Cloud Scheduler for weekly execution
- [ ] Test with sample departed user

## Decisions

1. **Pre-registration validated at webhook time**: Emails are checked against Zoom when meeting ends, not when rule is created. This automatically handles departed employees.
2. **Cannot revoke real participants**: Only manual grants and preregistration records can be revoked. Actual participants always retain access.
3. **Meeting ID vs Instance UUID**: Rules use meeting ID (persistent across instances), grants use instance UUID (specific meeting occurrence).

## Files to Create/Modify

### Cloud Functions
```
cloud-functions/src/
├── webhook-handler.ts         # Add processPreregisteredUsers
├── manage-access-rule.ts      # New endpoint
├── grant-access.ts            # New endpoint
├── revoke-access.ts           # New endpoint
├── cleanup-access-rules.ts    # Weekly cleanup of departed employees
└── utils/
    └── firestore.ts           # Add meeting_access_rules helpers
```

### MCP Client
```
zoom-mcp/src/tools/
├── manage-access-rule.ts      # New tool
├── grant-access.ts            # New tool
└── revoke-access.ts           # New tool
```
