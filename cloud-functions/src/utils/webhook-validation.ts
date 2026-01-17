/**
 * Zoom webhook signature validation
 *
 * Validates incoming webhook requests using HMAC-SHA256.
 * Also handles Zoom's endpoint validation challenge.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validate webhook signature from Zoom
 *
 * Zoom sends:
 * - x-zm-signature: v0:HMAC-SHA256 signature
 * - x-zm-request-timestamp: Unix timestamp
 *
 * The signature is computed as:
 * HMAC-SHA256("v0:{timestamp}:{raw_body}", secret)
 *
 * @param signature - x-zm-signature header value
 * @param timestamp - x-zm-request-timestamp header value
 * @param rawBody - Raw request body as string
 * @param secretToken - Webhook secret token from Zoom app
 * @returns true if signature is valid
 */
export function validateWebhookSignature(
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
  secretToken: string
): boolean {
  if (!signature || !timestamp) {
    console.error('Missing signature or timestamp header');
    return false;
  }

  // Check timestamp is recent (within 5 minutes) to prevent replay attacks
  // Zoom sends timestamp in SECONDS, not milliseconds
  const timestampSec = parseInt(timestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  const fiveMinutesSec = 5 * 60;

  if (Math.abs(nowSec - timestampSec) > fiveMinutesSec) {
    console.error('Timestamp is too old or in the future');
    return false;
  }

  // Compute expected signature
  const message = `v0:${timestamp}:${rawBody}`;
  const expectedSignature =
    'v0=' + createHmac('sha256', secretToken).update(message).digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Handle Zoom's endpoint URL validation challenge
 *
 * When setting up a webhook, Zoom sends a validation request with:
 * {
 *   "event": "endpoint.url_validation",
 *   "payload": {
 *     "plainToken": "..."
 *   }
 * }
 *
 * We must respond with:
 * {
 *   "plainToken": "...",
 *   "encryptedToken": "HMAC-SHA256(plainToken, secretToken)"
 * }
 *
 * @param plainToken - The plainToken from the validation request
 * @param secretToken - Webhook secret token from Zoom app
 * @returns Response object to send back to Zoom
 */
export function createValidationResponse(
  plainToken: string,
  secretToken: string
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = createHmac('sha256', secretToken)
    .update(plainToken)
    .digest('hex');

  return {
    plainToken,
    encryptedToken,
  };
}
