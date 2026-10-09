export type PlatformName = 'wechat' | 'xhs' | 'douyin';
export type PlatformVerification = 'not_required' | 'verified' | 'unverified' | 'mismatch';
export interface PlatformOperationResult {
  platform: PlatformName;
  action: 'validate' | 'prefill' | 'save_draft' | 'publish' | 'generate';
  status: 'dry_run' | 'manual_handoff' | 'draft_saved' | 'published' | 'generated' | 'outcome_unknown' | 'failed';
  account?: string;
  timestamp: string;
  inputDigest?: string;
  inputSummary?: Record<string, string | number | boolean | string[]>;
  receipt?: { kind: 'api' | 'ui' | 'uploader'; id?: string; url?: string; message?: string };
  verification: PlatformVerification;
  message?: string;
}

export function validatePlatformResult(value: unknown): asserts value is PlatformOperationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('平台结果必须是对象');
  const allowedFields = ['platform', 'action', 'status', 'account', 'timestamp', 'inputDigest', 'inputSummary', 'receipt', 'verification', 'message'];
  for (const key of Object.keys(value)) if (!allowedFields.includes(key)) throw new Error('未知平台结果字段：' + key);
  const result = value as PlatformOperationResult;
  const statuses: Record<PlatformName, string[]> = {
    wechat: ['dry_run', 'manual_handoff', 'draft_saved', 'outcome_unknown', 'failed'],
    xhs: ['generated', 'failed'],
    douyin: ['dry_run', 'manual_handoff', 'published', 'outcome_unknown', 'failed'],
  };
  if (!Object.hasOwn(statuses, result.platform) || !statuses[result.platform].includes(result.status)) throw new Error('平台与结果状态不匹配');
  if (!['validate', 'prefill', 'save_draft', 'publish', 'generate'].includes(result.action)) throw new Error('平台动作无效');
  const platformActions: Record<PlatformName, string[]> = {
    wechat: ['validate', 'prefill', 'save_draft'], xhs: ['generate'], douyin: ['validate', 'prefill', 'publish'],
  };
  if (!platformActions[result.platform].includes(result.action)) throw new Error('平台与动作不匹配');
  const actions: Partial<Record<PlatformOperationResult['status'], PlatformOperationResult['action']>> = {
    dry_run: 'validate', manual_handoff: 'prefill', draft_saved: 'save_draft', published: 'publish', generated: 'generate',
  };
  if (actions[result.status] && actions[result.status] !== result.action) throw new Error('平台动作与结果状态不匹配');
  if (typeof result.timestamp !== 'string' || !Number.isFinite(Date.parse(result.timestamp))) throw new Error('平台结果时间无效');
  if (!['not_required', 'verified', 'unverified', 'mismatch'].includes(result.verification)) throw new Error('平台验证状态无效');
  const nonemptyString = (x: unknown) => typeof x === 'string' && Boolean(x.trim());
  if (result.account !== undefined && !nonemptyString(result.account)) throw new Error('账号必须是非空字符串');
  if (result.message !== undefined && typeof result.message !== 'string') throw new Error('结果说明必须是字符串');
  if (result.inputDigest !== undefined && (typeof result.inputDigest !== 'string' || !/^[a-f\d]{64}$/i.test(result.inputDigest))) throw new Error('输入摘要必须是 SHA-256');
  if (result.inputSummary !== undefined) {
    if (!result.inputSummary || typeof result.inputSummary !== 'object' || Array.isArray(result.inputSummary)) throw new Error('输入摘要字段必须是对象');
    for (const key of Object.keys(result.inputSummary)) if (['access_token', 'token', 'app_secret', 'credentials', 'password', 'chat_history', 'messages'].includes(key.toLowerCase())) throw new Error('输入摘要不能保存凭证或聊天记录');
    for (const item of Object.values(result.inputSummary)) {
      if (!(typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || Array.isArray(item) && item.every(x => typeof x === 'string'))) throw new Error('输入摘要字段类型无效');
    }
  }
  if (result.receipt !== undefined) {
    const receipt = result.receipt;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !['api', 'ui', 'uploader'].includes(receipt.kind)) throw new Error('平台回执类型无效');
    for (const key of Object.keys(receipt)) if (!['kind', 'id', 'url', 'message'].includes(key)) throw new Error('未知平台回执字段：' + key);
    for (const key of ['id', 'url', 'message'] as const) if (receipt[key] !== undefined && !nonemptyString(receipt[key])) throw new Error('回执字段必须是非空字符串');
  }
  if (result.status === 'draft_saved' && !(result.receipt?.kind === 'api' && result.receipt.id || result.receipt?.kind === 'ui' && result.receipt.message)) throw new Error('草稿保存缺少明确回执');
  if (result.status === 'published' && !(result.receipt?.id || result.receipt?.url)) throw new Error('公开发布缺少 ID 或 URL 回执');
}

/** 保存事实与读回验证分开；未知结果不能用重试提交来核验。 */
export function platformExitCode(result: PlatformOperationResult): 0 | 1 | 3 {
  if (result.status === 'failed') return 1;
  if (result.status === 'outcome_unknown' || result.verification === 'unverified' || result.verification === 'mismatch') return 3;
  return 0;
}

export function operationResult(
  platform: PlatformName,
  action: PlatformOperationResult['action'],
  status: PlatformOperationResult['status'],
  details: Partial<Omit<PlatformOperationResult, 'platform' | 'action' | 'status'>> = {},
): PlatformOperationResult {
  return { platform, action, status, timestamp: new Date().toISOString(), verification: 'not_required', ...details };
}

/** 配置或执行边界异常使用 2；明确平台拒绝可以使用 1。 */
export class PlatformCliError extends Error {
  constructor(message: string, public readonly exitCode: 1 | 2 = 2) { super(message); }
}
