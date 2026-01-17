import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { ZoomTokens } from '../types.js';
import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, CONFIG_DIR, TOKENS_FILE } from './constants.js';

// Try to import keytar, but don't fail if not available
let keytar: typeof import('keytar') | null = null;

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
  const kt = await loadKeytar();
  if (kt) {
    try {
      const stored = await kt.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (stored) {
        return JSON.parse(stored) as ZoomTokens;
      }
    } catch {
      // Fall through to file storage
    }
  }

  // Fallback to file storage
  return loadFromFile();
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
