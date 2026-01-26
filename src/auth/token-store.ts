import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { ZoomTokens } from '../types.js';
import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, CONFIG_DIR, TOKENS_FILE } from './constants.js';

// Try to import keytar, but don't fail if not available
let keytar: typeof import('keytar') | null = null;

// Track where tokens were loaded from (for debugging)
export type TokenSource = 'keychain' | 'file' | 'env_refresh_token' | 'oauth' | null;
let lastTokenSource: TokenSource = null;

export function getLastTokenSource(): TokenSource {
  return lastTokenSource;
}

export function setLastTokenSource(source: TokenSource): void {
  lastTokenSource = source;
}

async function loadKeytar(): Promise<typeof import('keytar') | null> {
  if (keytar !== null) return keytar;
  try {
    keytar = await import('keytar');
    return keytar;
  } catch {
    // keytar not available (e.g., missing native dependencies)
    return null;
  }
}

function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

function getTokensFilePath(): string {
  return join(getConfigDir(), TOKENS_FILE);
}

function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

// File-based fallback storage
function saveToFile(tokens: ZoomTokens): void {
  ensureConfigDir();
  const filePath = getTokensFilePath();
  writeFileSync(filePath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function loadFromFile(): ZoomTokens | null {
  const filePath = getTokensFilePath();
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ZoomTokens;
  } catch {
    return null;
  }
}

function deleteFromFile(): void {
  const filePath = getTokensFilePath();
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

// Main token storage functions
export async function saveTokens(tokens: ZoomTokens): Promise<void> {
  // Calculate expiry timestamp
  const tokensWithExpiry: ZoomTokens = {
    ...tokens,
    expires_at: Date.now() + tokens.expires_in * 1000,
  };

  const kt = await loadKeytar();
  if (kt) {
    try {
      await kt.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, JSON.stringify(tokensWithExpiry));
      return;
    } catch {
      // Fall through to file storage
    }
  }

  // Fallback to file storage
  saveToFile(tokensWithExpiry);
}

export async function loadTokens(): Promise<ZoomTokens | null> {
  // 1. Try keychain first
  const kt = await loadKeytar();
  if (kt) {
    try {
      const stored = await kt.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (stored) {
        lastTokenSource = 'keychain';
        return JSON.parse(stored) as ZoomTokens;
      }
    } catch {
      // Fall through to file storage
    }
  }

  // 2. Try file storage
  const fileTokens = loadFromFile();
  if (fileTokens) {
    lastTokenSource = 'file';
    return fileTokens;
  }

  // 3. Check for ZOOM_REFRESH_TOKEN env var (for headless bootstrap)
  const envRefreshToken = process.env.ZOOM_REFRESH_TOKEN;
  if (envRefreshToken) {
    // Return a partial token object - caller must refresh to get access_token
    lastTokenSource = 'env_refresh_token';
    return {
      access_token: '', // Empty - must be refreshed
      refresh_token: envRefreshToken,
      token_type: 'Bearer',
      expires_in: 0,
      scope: '',
      expires_at: 0, // Expired - forces refresh
    };
  }

  lastTokenSource = null;
  return null;
}

export async function deleteTokens(): Promise<void> {
  const kt = await loadKeytar();
  if (kt) {
    try {
      await kt.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch {
      // Ignore errors
    }
  }

  // Also delete file fallback
  deleteFromFile();
}

export function isTokenExpired(tokens: ZoomTokens): boolean {
  if (!tokens.expires_at) return true;
  // Consider expired if less than 5 minutes remaining
  return Date.now() > tokens.expires_at - 5 * 60 * 1000;
}
