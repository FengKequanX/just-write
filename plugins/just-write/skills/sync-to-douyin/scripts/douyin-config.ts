import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DouyinConfig {
  enabled: boolean;
  default_account: string;
}

export interface LoadedDouyinConfig {
  config: DouyinConfig;
  source: string;
}

const DEFAULT_CONFIG: DouyinConfig = { enabled: false, default_account: '' };
const ALLOWED_KEYS = new Set<keyof DouyinConfig>(['enabled', 'default_account']);

function stripQuotes(value: string): string {
  return value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
}

export function parseDouyinConfig(content: string, source = 'EXTEND.md'): DouyinConfig {
  const values: Record<string, string> = {};
  for (const [index, line] of content.replace(/\r\n/g, '\n').split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1]!;
    if (!ALLOWED_KEYS.has(key as keyof DouyinConfig)) {
      throw new Error(`${source}:${index + 1}: unknown sync-to-douyin key "${key}"`);
    }
    values[key] = stripQuotes(match[2]!);
  }
  if (values.enabled && !/^(?:true|false)$/i.test(values.enabled)) {
    throw new Error(`${source}: enabled must be true or false`);
  }
  return {
    enabled: values.enabled ? values.enabled.toLowerCase() === 'true' : DEFAULT_CONFIG.enabled,
    default_account: values.default_account || '',
  };
}

export function loadDouyinConfig(cwd = process.cwd(), home = os.homedir()): LoadedDouyinConfig {
  const candidates = [path.join(cwd, '.baoyu-skills', 'sync-to-douyin', 'EXTEND.md')];
  if (process.env.XDG_CONFIG_HOME) {
    candidates.push(path.join(process.env.XDG_CONFIG_HOME, 'baoyu-skills', 'sync-to-douyin', 'EXTEND.md'));
  }
  candidates.push(path.join(home, '.baoyu-skills', 'sync-to-douyin', 'EXTEND.md'));
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) return { config: { ...DEFAULT_CONFIG }, source: 'defaults' };
  return { config: parseDouyinConfig(fs.readFileSync(source, 'utf8'), source), source };
}
