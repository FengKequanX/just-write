import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSauArgs,
  parseArgs,
  parseCaption,
  readImages,
  validateDouyinPayload,
} from './douyin-note';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-note-test-'));
  roots.push(root);
  return root;
}

describe('Douyin payload', () => {
  test('parses the independent caption and removes tags and advice from body', () => {
    const root = tempRoot();
    const caption = path.join(root, 'douyin-caption.md');
    fs.writeFileSync(caption, '独立标题\n\n正文第一行\n正文第二行\n\n#AI #OpenAI\n\n— 发布建议：确认音乐');
    expect(parseCaption(caption)).toEqual({
      title: '独立标题',
      note: '正文第一行\n正文第二行',
      tags: ['AI', 'OpenAI'],
    });
  });

  test('sorts only managed numbered PNG files', () => {
    const root = tempRoot();
    for (const name of ['10-ending.png', '02-content.png', '01-cover.png', 'preview.png']) {
      fs.writeFileSync(path.join(root, name), 'x');
    }
    expect(readImages(root).map((file) => path.basename(file))).toEqual([
      '01-cover.png', '02-content.png', '10-ending.png',
    ]);
  });

  test('validates platform limits and preserves argument boundaries', () => {
    expect(() => validateDouyinPayload({ title: 'x'.repeat(21), note: '', tags: [] })).toThrow('title exceeds');
    expect(() => validateDouyinPayload({ title: '标题', note: '', tags: ['two words'] })).toThrow('must not contain spaces');
    const options = parseArgs(['xhs', '--account', 'creator', '--dry-run']);
    const args = buildSauArgs(options, ['C:/含 空格/01.png'], {
      title: '标题 & 安全', note: '正文', tags: ['AI'],
    }, 'C:/temp/note.txt');
    expect(args).toContain('标题 & 安全');
    expect(args).toContain('C:/含 空格/01.png');
  });

  test('dry-run cleans its temporary note file', () => {
    const article = tempRoot();
    const xhs = path.join(article, 'xhs');
    const douyin = path.join(article, 'douyin');
    fs.mkdirSync(xhs);
    fs.mkdirSync(douyin);
    fs.writeFileSync(path.join(xhs, '01-cover.png'), 'png');
    fs.writeFileSync(path.join(douyin, 'douyin-caption.md'), '标题\n\n正文\n\n#AI');
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('douyin-note-')));
    const result = Bun.spawnSync({
      cmd: [process.execPath, path.join(import.meta.dir, 'douyin-note.ts'), xhs, '--account', 'creator', '--dry-run'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('douyin-note-') && !before.has(name));
    expect(after).toEqual([]);
  });
});
