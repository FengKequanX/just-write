import { operationResult, type PlatformOperationResult } from '../../../lib/platform-result';

export interface BrowserSaveDependencies {
  evaluate: (expression: string) => Promise<unknown>;
  wait?: (milliseconds: number) => Promise<void>;
}
const TOASTS = `JSON.stringify(Array.from(document.querySelectorAll('.weui-desktop-toast, [class*=toast]')).map(el => el.textContent?.trim()).filter(Boolean))`;
const CLICK = `(() => { const button = Array.from(document.querySelectorAll('button')).find(el => ['保存为草稿', '保存草稿'].includes(el.textContent?.trim())) || document.querySelector('#js_submit button') || document.querySelector('#js_submit'); if (!button) return 'not_found'; button.click(); return 'clicked'; })()`;
function messages(value: unknown): string[] {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []; }
  catch { return []; }
}

/** 默认只交接；新出现的明确保存提示证明保存，不证明读回内容一致。 */
export async function finishBrowserDraft(
  save: boolean, dependencies: BrowserSaveDependencies,
  details: { account?: string; inputSummary?: Record<string, string | number | boolean | string[]> } = {},
): Promise<PlatformOperationResult> {
  if (!save) return operationResult('wechat', 'prefill', 'manual_handoff', details);
  const unknown = () => operationResult('wechat', 'save_draft', 'outcome_unknown', {
    ...details, verification: 'unverified', message: '未取得明确保存结果，请先核对草稿箱，勿重复保存',
  });
  try {
    const previous = messages(await dependencies.evaluate(TOASTS));
    if (await dependencies.evaluate(CLICK) !== 'clicked') return unknown();
    await (dependencies.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(3000);
    const current = messages(await dependencies.evaluate(TOASTS)).filter(message => !previous.includes(message));
    const rejected = current.find(message => /失败|错误|无法保存|不能保存/.test(message));
    if (rejected) return operationResult('wechat', 'save_draft', 'failed', { ...details, message: rejected });
    const saved = current.find(message => /保存(?:为草稿)?成功|草稿已保存|已保存(?:到草稿箱)?/.test(message));
    if (saved) return operationResult('wechat', 'save_draft', 'draft_saved', {
      ...details, receipt: { kind: 'ui', message: saved }, verification: 'unverified', message: '界面确认草稿保存，尚未读回核对内容',
    });
    return unknown();
  } catch { return unknown(); }
}
