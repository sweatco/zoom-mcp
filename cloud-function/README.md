# Zoom MCP OAuth Proxy

Cloud Function that securely handles OAuth token exchange for zoom-mcp.

## Setup

### 1. Create the secret in GCP Secret Manager

```bash
echo -n "your-zoom-client-secret" | gcloud secrets create zoom-mcp-client-secret --data-file=-
```

### 2. Deploy the function

```bash
gcloud functions deploy zoom-mcp-oauth \
  --gen2 \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --region=us-central1 \
  --set-secrets=ZOOM_CLIENT_SECRET=zoom-mcp-client-secret:latest \
  --set-env-vars=ZOOM_CLIENT_ID=your-zoom-client-id
```

### 3. Get the function URL

After deployment, you'll get a URL like:
```
https://us-central1-your-project.cloudfunctions.net/zoom-mcp-oauth
```

Update this URL in the MCP's `src/auth/constants.ts`.

## API

### Exchange auth code for tokens

```bash
curl -X POST https://YOUR_FUNCTION_URL \
  -H "Content-Type: application/json" \
  -d '{
    "action": "token",
    "code": "auth-code-from-zoom",
    "redirect_uri": "http://localhost:8888/callback"
  }'
```

### Refresh tokens

```bash
curl -X POST https://YOUR_FUNCTION_URL \
  -H "Content-Type: application/json" \
  -d '{
    "action": "refresh",
    "refresh_token": "your-refresh-token"
  }'
```

## Security

- Client secret is stored in GCP Secret Manager
- Function is stateless - doesn't store any user tokens
- CORS enabled for browser requests
