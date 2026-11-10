/**
 * User token validation utility
 *
 * Validates a user's OAuth access token by calling Zoom's /users/me endpoint.
 * Returns the user's email, role_id, and computed admin status.
 *
 * Only users of the Zoom account the proxy's S2S app belongs to
 * (ZOOM_ADMIN_ACCOUNT_ID) are accepted. Role IDs are the same in every Zoom
 * account, so without this check the owner of any other account (e.g. a free
 * personal one) would be treated as an admin of ours.
 */

import type { UserInfo, ZoomUserMeResponse } from '../types.js';

/** Zoom's built-in Owner and Admin role IDs */
const ADMIN_ROLE_IDS = new Set(['0', '1']);

/**
 * Thrown when the token is valid but belongs to a user of another Zoom account
 */
export class ForeignAccountError extends Error {
  constructor() {
    super('Access denied. This Zoom account is not allowed to use this service.');
    this.name = 'ForeignAccountError';
  }
}

/**
 * Validate a user's OAuth access token and extract user info
 *
 * @param token - User's OAuth access token
 * @returns User info including email, role_id, and isAdmin flag
 * @throws ForeignAccountError if the user belongs to another Zoom account
 * @throws Error if token is invalid or API call fails
 */
export async function validateUserToken(token: string): Promise<UserInfo> {
  // Read at call time and fail closed: without the expected account we can't
  // tell our users from anyone else's.
  const expectedAccountId = process.env.ZOOM_ADMIN_ACCOUNT_ID;
  if (!expectedAccountId) {
    throw new Error('ZOOM_ADMIN_ACCOUNT_ID is not configured');
  }

  const response = await fetch('https://api.zoom.us/v2/users/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid or expired token');
    }
    const errorText = await response.text();
    throw new Error(`Failed to validate token: ${response.status} - ${errorText}`);
  }

  const user = (await response.json()) as ZoomUserMeResponse;

  if (!user.account_id || user.account_id !== expectedAccountId) {
    console.warn(
      `Rejected token from foreign Zoom account ${user.account_id ?? '(none)'} (user ${user.email})`
    );
    throw new ForeignAccountError();
  }

  // role_id comes as a string from the API. Compare exactly: custom roles have
  // their own IDs, and parseInt would turn e.g. "1abc" or "-2" into an admin.
  const roleId = String(user.role_id);

  return {
    email: user.email,
    role_id: roleId,
    // Owners ("0") and Admins ("1") have admin privileges
    isAdmin: ADMIN_ROLE_IDS.has(roleId),
  };
}

/**
 * Extract bearer token from Authorization header
 *
 * @param authHeader - Authorization header value
 * @returns Token string or null if not found
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}
