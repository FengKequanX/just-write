import { expect, test } from 'bun:test';
import { parseDouyinConfig } from './douyin-config';

test('parses canonical Douyin configuration', () => {
  expect(parseDouyinConfig('enabled: true\ndefault_account: creator')).toEqual({
    enabled: true,
    default_account: 'creator',
  });
});

test('rejects unknown Douyin configuration', () => {
  expect(() => parseDouyinConfig('publish_without_confirmation: true')).toThrow('unknown sync-to-douyin key');
});
