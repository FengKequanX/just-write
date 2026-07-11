import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface XhsConfig {
  enabled: boolean;
  default_author: string;
  default_theme: string;
  default_aspect: '3:4' | '9:16' | '1:1' | '4:3';
  default_topic_tags: string;
}

export interface LoadedXhsConfig {
  config: XhsConfig;
  source: string;
}

export const DEFAULT_XHS_CONFIG: XhsConfig = {
  enabled: false,
  default_author: '',
  default_theme: 'default',
  default_aspect: '3:4',
  default_topic_tags: '',
};

const ALLOWED_KEYS = new Set<keyof XhsConfig>([
  'enabled', 'default_author', 'default_theme', 'default_aspect', 'default_topic_tags',
]);
const REMOVED_KEYS = new Set(['default_aspect_ratio', 'dry_run']);
const ASPECTS = new Set<XhsConfig['default_aspect']>(['3:4', '9:16', '1:1', '4:3']);

function stripQuotes(value: string): string {
  return value.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
}

export function parseXhsConfig(content: string, source = 'EXTEND.md'): XhsConfig {
  const values: Record<string, string> = {};
  for (const [index, line] of content.replace(/\r\n/g, '\n').split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1]!;
    if (REMOVED_KEYS.has(key)) {
      throw new Error(`${source}:${index + 1}: removed key "${key}"; use "default_aspect" and remove dry-run configuration`);
    }
    if (!ALLOWED_KEYS.has(key as keyof XhsConfig)) {
      throw new Error(`${source}:${index + 1}: unknown post-to-xhs key "${key}"`);
    }
    values[key] = stripQuotes(match[2]!);
  }

  const enabledValue = values.enabled;
  if (enabledValue && !/^(?:true|false)$/i.test(enabledValue)) {
    throw new Error(`${source}: enabled must be true or false`);
  }
  const aspect = (values.default_aspect || DEFAULT_XHS_CONFIG.default_aspect) as XhsConfig['default_aspect'];
  if (!ASPECTS.has(aspect)) throw new Error(`${source}: invalid default_aspect "${aspect}"`);

  return {
    enabled: enabledValue ? enabledValue.toLowerCase() === 'true' : DEFAULT_XHS_CONFIG.enabled,
    default_author: values.default_author || '',
    default_theme: values.default_theme || DEFAULT_XHS_CONFIG.default_theme,
    default_aspect: aspect,
    default_topic_tags: values.default_topic_tags || '',
  };
}

export function xhsConfigCandidates(cwd = process.cwd(), home = os.homedir()): string[] {
  const candidates = [path.join(cwd, '.baoyu-skills', 'post-to-xhs', 'EXTEND.md')];
  if (process.env.XDG_CONFIG_HOME) {
    candidates.push(path.join(process.env.XDG_CONFIG_HOME, 'baoyu-skills', 'post-to-xhs', 'EXTEND.md'));
  }
  candidates.push(path.join(home, '.baoyu-skills', 'post-to-xhs', 'EXTEND.md'));
  return candidates;
}

export function loadXhsConfig(cwd = process.cwd(), home = os.homedir()): LoadedXhsConfig {
  const source = xhsConfigCandidates(cwd, home).find((candidate) => fs.existsSync(candidate));
  if (!source) return { config: { ...DEFAULT_XHS_CONFIG }, source: 'defaults' };
  return { config: parseXhsConfig(fs.readFileSync(source, 'utf8'), source), source };
}

export function validateXhsOptions(theme: string, aspect: string, themesDir: string): void {
  if (!ASPECTS.has(aspect as XhsConfig['default_aspect'])) {
    throw new Error(`Invalid aspect "${aspect}". Expected one of: ${[...ASPECTS].join(', ')}`);
  }
  if (!/^[a-z0-9-]+$/i.test(theme) || !fs.existsSync(path.join(themesDir, theme, 'style.css'))) {
    throw new Error(`Unknown XHS theme: ${theme}`);
  }
}
