/**
 * User token validation utility
 *
 * Validates a user's OAuth access token by calling Zoom's /users/me endpoint.
 * Returns the user's email, role_id, and computed admin status.
 */

import type { UserInfo, ZoomUserMeResponse } from '../types.js';

/**
 * Validate a user's OAuth access token and extract user info
 *
 * @param token - User's OAuth access token
 * @returns User info including email, role_id, and isAdmin flag
 * @throws Error if token is invalid or API call fails
 */
export async function validateUserToken(token: string): Promise<UserInfo> {
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

  // role_id comes as a string from the API
  const roleId = parseInt(user.role_id, 10);

  return {
    email: user.email,
    role_id: roleId,
    // Owners (0) and Admins (1) have admin privileges
    isAdmin: roleId <= 1,
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
