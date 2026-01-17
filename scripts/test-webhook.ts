/**
 * Test script for webhook handler
 *
 * Simulates a Zoom meeting.ended webhook event locally.
 *
 * Usage:
 *   # Start the function locally first:
 *   cd cloud-functions && npx @google-cloud/functions-framework --target=webhookHandler --port=8080
 *
 *   # Then run this script:
 *   npx tsx scripts/test-webhook.ts
 *
 *   # Or test against a deployed function:
 *   WEBHOOK_URL=https://... npx tsx scripts/test-webhook.ts
 */

import 'dotenv/config';
import { createHmac } from 'crypto';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:8080';
const WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || 'test-secret-token';

// Sample meeting.ended payload
const samplePayload = {
  event: 'meeting.ended',
  event_ts: Date.now(),
  payload: {
    account_id: 'test-account-id',
    object: {
      id: '86239292937',
      uuid: 'test-uuid-' + Date.now(),
      topic: 'Test Meeting for Webhook',
      host_id: 'test-host-id',
      host_email: 'host@example.com',
      user_name: 'Test Host',
      start_time: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
      end_time: new Date().toISOString(),
      duration: 30,
      participant: [
        { user_name: 'Alice', email: 'alice@example.com' },
        { user_name: 'Bob', email: 'bob@example.com' },
        { user_name: 'Test Host', email: 'host@example.com' },
      ],
    },
  },
};

// Generate signature (same algorithm Zoom uses)
function generateSignature(payload: string, timestamp: string, secret: string): string {
  const message = `v0:${timestamp}:${payload}`;
  return 'v0=' + createHmac('sha256', secret).update(message).digest('hex');
}

async function testWebhook() {
  console.log('Testing webhook handler...');
  console.log(`URL: ${WEBHOOK_URL}`);
  console.log(`Payload: meeting.ended for "${samplePayload.payload.object.topic}"`);
  console.log('');

  const body = JSON.stringify(samplePayload);
  const timestamp = String(Date.now());
  const signature = generateSignature(body, timestamp, WEBHOOK_SECRET);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zm-signature': signature,
        'x-zm-request-timestamp': timestamp,
      },
      body,
    });

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = responseText;
    }

    console.log(`Status: ${response.status}`);
    console.log(`Response:`, responseJson);

    if (response.ok) {
      console.log('\n✅ Webhook handler responded successfully!');
    } else {
      console.log('\n❌ Webhook handler returned an error');
    }
  } catch (error) {
    console.error('Failed to send request:', error);
  }
}

// Also test URL validation challenge
async function testUrlValidation() {
  console.log('\n--- Testing URL Validation Challenge ---\n');

  const validationPayload = {
    event: 'endpoint.url_validation',
    payload: {
      plainToken: 'test-plain-token-12345',
    },
  };

  const body = JSON.stringify(validationPayload);
  const timestamp = String(Date.now());
  const signature = generateSignature(body, timestamp, WEBHOOK_SECRET);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zm-signature': signature,
        'x-zm-request-timestamp': timestamp,
      },
      body,
    });

    const responseJson = await response.json();

    console.log(`Status: ${response.status}`);
    console.log(`Response:`, responseJson);

    // Verify the response
    const expectedEncryptedToken = createHmac('sha256', WEBHOOK_SECRET)
      .update(validationPayload.payload.plainToken)
      .digest('hex');

    if (
      responseJson.plainToken === validationPayload.payload.plainToken &&
      responseJson.encryptedToken === expectedEncryptedToken
    ) {
      console.log('\n✅ URL validation response is correct!');
    } else {
      console.log('\n❌ URL validation response mismatch');
      console.log(`Expected encryptedToken: ${expectedEncryptedToken}`);
    }
  } catch (error) {
    console.error('Failed to send request:', error);
  }
}

// Run tests
async function main() {
  console.log('=== Webhook Handler Test ===\n');

  await testUrlValidation();
  console.log('\n--- Testing meeting.ended Event ---\n');
  await testWebhook();
}

main().catch(console.error);
