import path from 'node:path';

function resolveFromEnv(key: 'RX_APP_ROOT' | 'RX_APP_DATA_ROOT'): string | null {
  const raw = process.env[key];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function getAppRootDir() {
  return resolveFromEnv('RX_APP_ROOT') || process.cwd();
}

export function getAppDataDir() {
  return resolveFromEnv('RX_APP_DATA_ROOT') || process.cwd();
}
