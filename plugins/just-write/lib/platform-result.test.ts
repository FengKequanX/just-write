import { expect, test } from 'bun:test';
import { operationResult, platformExitCode, validatePlatformResult } from './platform-result';

test('平台结果区分保存事实、验证和未知提交', () => {
  expect(platformExitCode(operationResult('wechat', 'save_draft', 'draft_saved', { verification: 'verified' }))).toBe(0);
  expect(platformExitCode(operationResult('wechat', 'save_draft', 'draft_saved', { verification: 'unverified' }))).toBe(3);
  expect(platformExitCode(operationResult('wechat', 'save_draft', 'draft_saved', { verification: 'mismatch' }))).toBe(3);
  expect(platformExitCode(operationResult('douyin', 'publish', 'outcome_unknown'))).toBe(3);
  expect(platformExitCode(operationResult('douyin', 'publish', 'failed'))).toBe(1);
  expect(platformExitCode(operationResult('wechat', 'prefill', 'manual_handoff'))).toBe(0);
});

test('拒绝不能支持成功结论的回执和不合法字段', () => {
  const saved = operationResult('wechat', 'save_draft', 'draft_saved', { receipt: { kind: 'api', id: 'fixture-id' }, verification: 'unverified' });
  expect(() => validatePlatformResult(saved)).not.toThrow();
  for (const receipt of [{ kind: 'api', id: {} }, { kind: 'api', id: '  ' }, { kind: 'other', id: 'id' }, []]) {
    expect(() => validatePlatformResult({ ...saved, receipt })).toThrow();
  }
  for (const change of [{ account: {} }, { inputDigest: Array(64).fill('a') }, { inputSummary: { secret: {} } }, { inputSummary: { size: Infinity } }, { message: [] }]) {
    expect(() => validatePlatformResult({ ...saved, ...change })).toThrow();
  }
  expect(() => validatePlatformResult(operationResult('wechat', 'publish', 'outcome_unknown'))).toThrow('动作');
  expect(() => validatePlatformResult(operationResult('douyin', 'prefill', 'published', { receipt: { kind: 'uploader', id: 'id' } }))).toThrow('状态');
  expect(() => validatePlatformResult({ ...saved, access_token: '不可保存' })).toThrow('字段');
  expect(() => validatePlatformResult({ ...saved, receipt: { ...saved.receipt, token: '不可保存' } })).toThrow('字段');
  expect(() => validatePlatformResult({ ...saved, inputSummary: { chat_history: '不可保存' } })).toThrow('聊天');
});
