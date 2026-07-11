import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWechatCoverPath } from './wechat-cover';

let root = '';
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});

test('uses imgs/cover.png as the WeChat cover convention', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-cover-'));
  fs.mkdirSync(path.join(root, 'imgs'));
  fs.writeFileSync(path.join(root, 'imgs', 'cover.png'), 'wechat');
  fs.writeFileSync(path.join(root, 'imgs', 'cover-xhs.png'), 'xhs');
  expect(resolveWechatCoverPath(undefined, root)).toBe(path.join(root, 'imgs', 'cover.png'));
});

test('never falls back to imgs/cover-xhs.png', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-cover-'));
  fs.mkdirSync(path.join(root, 'imgs'));
  fs.writeFileSync(path.join(root, 'imgs', 'cover-xhs.png'), 'xhs');
  expect(resolveWechatCoverPath(undefined, root)).toBeUndefined();
});

test('explicit WeChat cover remains highest priority', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-cover-'));
  expect(resolveWechatCoverPath('custom.png', root)).toBe('custom.png');
});
