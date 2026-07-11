import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadXhsConfig, parseXhsConfig, validateXhsOptions } from './xhs-config';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-config-'));
  roots.push(root);
  return root;
}

describe('XHS configuration', () => {
  test('parses canonical keys', () => {
    expect(parseXhsConfig(`enabled: true\ndefault_author: 测试\ndefault_theme: default\ndefault_aspect: "9:16"\ndefault_topic_tags: AI,科技`)).toEqual({
      enabled: true,
      default_author: '测试',
      default_theme: 'default',
      default_aspect: '9:16',
      default_topic_tags: 'AI,科技',
    });
  });

  test('rejects removed and unknown keys', () => {
    expect(() => parseXhsConfig('default_aspect_ratio: 3:4')).toThrow('removed key');
    expect(() => parseXhsConfig('dry_run: true')).toThrow('removed key');
    expect(() => parseXhsConfig('mystery: true')).toThrow('unknown post-to-xhs key');
  });

  test('prefers project configuration over user configuration', () => {
    const cwd = tempRoot();
    const home = tempRoot();
    const project = path.join(cwd, '.baoyu-skills', 'post-to-xhs');
    const user = path.join(home, '.baoyu-skills', 'post-to-xhs');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(user, { recursive: true });
    fs.writeFileSync(path.join(project, 'EXTEND.md'), 'default_author: project');
    fs.writeFileSync(path.join(user, 'EXTEND.md'), 'default_author: user');
    expect(loadXhsConfig(cwd, home).config.default_author).toBe('project');
  });

  test('validates theme and aspect', () => {
    const themes = tempRoot();
    fs.mkdirSync(path.join(themes, 'default'));
    fs.writeFileSync(path.join(themes, 'default', 'style.css'), 'body{}');
    expect(() => validateXhsOptions('default', '3:4', themes)).not.toThrow();
    expect(() => validateXhsOptions('missing', '3:4', themes)).toThrow('Unknown XHS theme');
    expect(() => validateXhsOptions('default', '2:3', themes)).toThrow('Invalid aspect');
  });
});
