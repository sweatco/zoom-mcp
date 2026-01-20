# Proxy Setup Guide

This guide explains how to set up the Zoom MCP Proxy on Google Cloud Platform. The proxy enables advanced features like accessing meetings you attended (not just hosted) and admin capabilities.

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and configured
- Zoom account with admin access (to create apps and configure webhooks)
- Node.js 20+ and npm

## Overview

The proxy consists of:
1. **Webhook Handler** - Receives `meeting.ended` events from Zoom and indexes participants
2. **Proxy API** - Handles MCP requests with user authentication
3. **Firestore Database** - Stores meeting participant records
4. **Cleanup Job** - Monthly job to delete old records (data retention)

All data is stored in your organization's GCP project.

## Step 1: Clone Repository and Set Variables

```bash
# Clone the repository
git clone https://github.com/sweatco/zoom-mcp.git
cd zoom-mcp

# Set variables (used throughout this guide)
export PROJECT=zoom-mcp-proxy
export REGION=us-central1  # Choose your preferred region
```

## Step 2: Create GCP Project

```bash
# Create project (or use existing)
gcloud projects create $PROJECT --name="Zoom MCP Proxy"

# Set as current project
gcloud config set project $PROJECT

# Enable required APIs
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

## Step 3: Create Firestore Database and Deploy Indexes

```bash
# Create Firestore database in Native mode
gcloud firestore databases create --location=$REGION

# Deploy indexes using Firebase CLI
npm install -g firebase-tools
firebase login
cd cloud-functions
firebase deploy --only firestore:indexes --project=$PROJECT
cd ..
```

## Step 4: Create Zoom Server-to-Server OAuth App

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/) → Develop → Build App
2. Choose **Server-to-Server OAuth** app type
3. Fill in app name (e.g., "Zoom MCP Proxy")
4. Note down:
   - **Account ID**
   - **Client ID**
   - **Client Secret**
5. Add required scopes:
   ```
   user:read:list_users:admin
   user:read:user:admin
   meeting:read:past_meeting:admin
   meeting:read:list_past_instances:admin
   meeting:read:list_past_participants:admin
   meeting:read:summary:admin
   cloud_recording:read:list_user_recordings:admin
   cloud_recording:read:list_recording_files:admin
   report:read:user:admin
   report:read:list_history_meetings:admin
   ```
6. Activate the app

## Step 5: Configure Zoom Webhook

1. In the same Zoom app, go to **Feature** → **Event Subscriptions**
2. Toggle "Event Subscriptions" ON
3. Click **Add Event Subscription**:
   - Subscription Name: `meeting-ended`
   - Event notification endpoint URL: `https://$REGION-$PROJECT.cloudfunctions.net/zoom-webhook-handler`
     (Use a placeholder for now - update after deploying in Step 8)
4. Click **Add Events** → Meeting → `meeting.ended`
5. Save and note down the **Secret Token**

## Step 6: Store Secrets in GCP

```bash
# Store admin client secret
gcloud secrets create zoom-admin-client-secret
echo -n "YOUR_ZOOM_CLIENT_SECRET" | gcloud secrets versions add zoom-admin-client-secret --data-file=-

# Store webhook secret token
gcloud secrets create zoom-webhook-secret-token
echo -n "YOUR_WEBHOOK_SECRET_TOKEN" | gcloud secrets versions add zoom-webhook-secret-token --data-file=-

# Grant Cloud Functions service account access to secrets
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding zoom-admin-client-secret \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding zoom-webhook-secret-token \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Step 7: Deploy OAuth Function (Optional)

The OAuth function handles user authentication. You have two options:

**Option A: Use Sweatco's hosted OAuth function** (recommended for quick setup)
- Skip this step
- Use `ZOOM_OAUTH_URL=https://europe-west1-zoom-mcp-oauth.cloudfunctions.net/zoom-mcp-oauth` in MCP client config

**Option B: Deploy your own OAuth function** (full control)

1. Create a Zoom User OAuth app at [Zoom Marketplace](https://marketplace.zoom.us/):
   - Choose **OAuth** app type (not Server-to-Server)
   - Set redirect URL: `http://localhost:8888/callback`
   - Add scopes: `user:read:user`, `meeting:read:meeting`, `meeting:read:summary`, `cloud_recording:read:recording`
   - Note the **Client ID** and **Client Secret**

2. Store the client secret and grant access:
```bash
gcloud secrets create zoom-client-secret
echo -n "YOUR_USER_OAUTH_CLIENT_SECRET" | gcloud secrets versions add zoom-client-secret --data-file=-

# Grant Cloud Functions access to this secret
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding zoom-client-secret \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

3. Deploy the OAuth function:
```bash
cd cloud-functions
npm install
npm run build

# Set your User OAuth Client ID and deploy
export ZOOM_CLIENT_ID=your-user-oauth-client-id
npm run deploy:oauth
```

4. After deployment, the CLI will show the function URL (e.g., `https://europe-west1-your-project-id.cloudfunctions.net/zoom-mcp-oauth`)
   - Use this URL as `ZOOM_OAUTH_URL` in MCP client config (Step 12)

## Step 8: Deploy Proxy Functions

Build (if not already done in Step 7):
```bash
cd cloud-functions
npm install
npm run build
```

Deploy the proxy functions:
```bash
# Set your S2S OAuth credentials
export ZOOM_ADMIN_ACCOUNT_ID=your-account-id
export ZOOM_ADMIN_CLIENT_ID=your-admin-client-id

# Deploy webhook handler
npm run deploy:webhook

# Deploy proxy API
npm run deploy:api

# Deploy cleanup job
npm run deploy:cleanup
```

## Step 9: Update Zoom Webhook URL

Now that the functions are deployed, update the webhook URL in your Zoom app:
1. Go to your Zoom S2S app → Features → Event Subscriptions
2. Update the endpoint URL to the actual `zoom-webhook-handler` URL
3. Zoom will send a validation challenge - the handler responds automatically

## Step 10: Set Up Cleanup Scheduler

```bash
# Create Cloud Scheduler job (1st of month at 3am UTC)
gcloud scheduler jobs create http zoom-cleanup-monthly \
  --location=$REGION \
  --schedule="0 3 1 * *" \
  --uri="https://$REGION-$PROJECT.cloudfunctions.net/zoom-cleanup" \
  --oidc-service-account-email=$PROJECT@appspot.gserviceaccount.com
```

## Step 11: Run Historical Backfill

The webhook only captures meetings going forward. To import historical data:

```bash
# Go back to repo root
cd ..

# Create .env file with admin credentials
cat > .env << EOF
ZOOM_ADMIN_ACCOUNT_ID=your_account_id
ZOOM_ADMIN_CLIENT_ID=your_admin_client_id
ZOOM_ADMIN_CLIENT_SECRET=your_admin_client_secret
EOF

# Authenticate with GCP for Firestore access
gcloud auth application-default login
gcloud config set project $PROJECT

# Run backfill (max 6 months due to Zoom API limits)
npx tsx scripts/backfill.ts --from=2025-08-01 --to=2025-08-31
npx tsx scripts/backfill.ts --from=2025-09-01 --to=2025-09-30
# ... repeat for each month
```

**Note**: Zoom's Report API only returns data from the last 6 months. Meeting summaries are retained indefinitely.

## Step 12: Configure MCP Clients

Share the MCP configuration with users. The defaults use Sweatco's hosted OAuth service, so you only need to set `ZOOM_PROXY_URL`.

**If using Sweatco's hosted OAuth (Option A - recommended):**
```json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"],
      "env": {
        "ZOOM_PROXY_URL": "https://$REGION-$PROJECT.cloudfunctions.net/zoom-proxy-api"
      }
    }
  }
}
```

**If using your own OAuth function (Option B):**
```json
{
  "mcpServers": {
    "zoom": {
      "command": "npx",
      "args": ["-y", "@sweatco/zoom-mcp"],
      "env": {
        "ZOOM_CLIENT_ID": "your-user-oauth-client-id",
        "ZOOM_OAUTH_URL": "https://$REGION-$PROJECT.cloudfunctions.net/zoom-mcp-oauth",
        "ZOOM_PROXY_URL": "https://$REGION-$PROJECT.cloudfunctions.net/zoom-proxy-api"
      }
    }
  }
}
```

## Verification

Test the setup:

1. **Test webhook**: End a Zoom meeting and check Cloud Function logs
2. **Test proxy**: Use MCP to list meetings - should show meetings you attended
3. **Test admin**: As admin, query another user's meetings using `user_email` parameter

## Cost Estimate

For a typical organization (~100 users, ~800 meetings/month):

| Resource | Monthly Usage | Cost |
|----------|---------------|------|
| Firestore | ~3K writes, ~10K reads | Free tier |
| Cloud Functions | ~1K invocations | Free tier |
| Cloud Scheduler | 1 job | Free tier |
| **Total** | | **$0** |

Even at 10x growth, costs would be minimal (~$1-5/month).

## Troubleshooting

**Webhook not receiving events**
- Verify the webhook URL is correct in Zoom app settings
- Check Cloud Function logs for errors
- Ensure the function is deployed with `--allow-unauthenticated`

**"Admin access required" error**
- Only Zoom Owners (role_id=0) and Admins (role_id=1) can query other users
- Regular members can only see their own meetings

**Missing historical meetings**
- Run the backfill script for the desired date range
- Zoom Report API only returns last 6 months of data

**Token expired errors**
- User tokens refresh automatically
- If issues persist, have user run `npx @sweatco/zoom-mcp --logout` and re-authorize
