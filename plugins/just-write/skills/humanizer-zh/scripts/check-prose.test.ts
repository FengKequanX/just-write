/** Adapted from KKKKhazix/human-writing (MIT), scripts/check_prose.py. */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AUTHOR_PATTERN_IDS, checkProse, documentSha256, maskNonProse, parseCliArgs,
  validateAuthorRules, type AuthorRules, type ProseExemptions,
} from './check-prose';

const rules = (values: Partial<AuthorRules>): AuthorRules => ({ schemaVersion: 1, ...values });
const active = (result: ReturnType<typeof checkProse>) => result.findings.filter((finding) => !finding.exemption);

function exemption(text: string, start: number, end: number): ProseExemptions {
  return {
    schemaVersion: 1, documentSha256: documentSha256(text),
    spans: [{ start, end, kind: 'quote', reason: '用户要求保留的真实引语' }],
  };
}

describe('通用句式只提供提示', () => {
  const samples = [
    '这不是速度问题，而是输入不完整。',
    '原因并非费用太高，而是审批太慢。',
    '重点不在于功能多少，而在于能否完成任务。',
    '与其说他拒绝合作，不如说双方没有谈拢。',
    '这不只是一次更新，也改变了收费方式。',
    '表面上流程缩短了，实际等待更久。',
    '看似选择更多，实则限制也更多。',
  ];
  samples.forEach((sample, index) => {
    test(`识别 ${AUTHOR_PATTERN_IDS[index]}`, () => {
      const generic = checkProse(sample);
      expect(generic.counts.pivots).toBe(1);
      expect(generic.failures).toHaveLength(0);
      expect(active(generic).find((finding) => finding.ruleId === AUTHOR_PATTERN_IDS[index])?.severity).toBe('warning');
      const authored = checkProse(sample, { rules: rules({ forbiddenPatterns: [AUTHOR_PATTERN_IDS[index]!] }) });
      expect(authored.failures).toHaveLength(1);
      expect(active(authored).find((finding) => finding.ruleId === AUTHOR_PATTERN_IDS[index])?.severity).toBe('error');
    });
  });
});

describe('作者禁令与明确例外', () => {
  test('通用词形不阻断，作者明确禁词才阻断', () => {
    const normal = checkProse('团队准备建立商业闭环，赋能工作。');
    expect(normal.counts.jargon).toBe(2);
    expect(normal.failures).toHaveLength(0);
    const authored = checkProse('团队准备建立商业闭环，赋能工作。', { rules: rules({ forbiddenTerms: ['赋能'] }) });
    expect(authored.failures).toHaveLength(1);
    expect(authored.failures[0]).toContain('赋能');
  });

  test('完整允许术语保护内部词，独立使用仍受禁令约束', () => {
    const result = checkProse('闭环控制是术语；闭环在这里没有解释。', {
      rules: rules({ forbiddenTerms: ['闭环'], allowedTerms: ['闭环控制'] }),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.findings.find((finding) => finding.ruleId === 'author.term' && finding.start === 0)?.exemption?.kind).toBe('term');
  });

  test('disabledSignals 只关闭通用提示，不关闭作者禁令', () => {
    const result = checkProse('这不是费用问题，而是信息不足。', {
      rules: rules({ disabledSignals: ['pivot.not_but'], forbiddenPatterns: ['pivot.not_but'] }),
    });
    expect(result.warnings).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
  });

  test('真实引语以绑定原稿的显式范围豁免，其他命中仍报告', () => {
    const text = '老师说：“这里不是速度问题，而是输入不足。”\n这不是规模问题，而是人数不足。';
    const start = text.indexOf('这里');
    const end = text.indexOf('。”') + 1;
    const result = checkProse(text, {
      rules: rules({ forbiddenPatterns: ['pivot.not_but'] }), exemptions: exemption(text, start, end),
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('第 2 行');
    expect(result.findings.filter((finding) => finding.exemption)).toHaveLength(1);
  });

  test('emoji 和 CRLF 之前后均使用原文 UTF-16 例外范围', () => {
    const text = '---\r\ntitle: 😀\r\n---\r\n😀老师说：“赋能团队。”\r\n赋能工作。';
    const start = text.indexOf('赋能');
    const result = checkProse(text, {
      rules: rules({ forbiddenTerms: ['赋能'] }), exemptions: exemption(text, start, start + 2),
    });
    const quoted = result.findings.find((item) => item.ruleId === 'author.term' && item.start === start)!;
    expect(quoted.exemption).toBeDefined();
    expect(quoted.line).toBe(4);
    expect(quoted.column).toBe(8);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('第 5 行');
  });

  test('引号与 Markdown 引用块不会自动豁免', () => {
    for (const text of ['老师说：“赋能团队。”', '> 赋能团队。']) {
      const result = checkProse(text, { rules: rules({ forbiddenTerms: ['赋能'] }) });
      expect(result.failures).toHaveLength(1);
    }
  });

  test('部分覆盖不豁免整个禁用句式', () => {
    const text = '这不是费用问题，而是信息不足。';
    const result = checkProse(text, {
      rules: rules({ forbiddenPatterns: ['pivot.not_but'] }), exemptions: exemption(text, 0, 4),
    });
    expect(result.failures).toHaveLength(1);
  });

  test('原稿变化后例外失效，包括换行变化', () => {
    const text = '第一行。\r\n赋能工作。';
    const saved = exemption(text, text.indexOf('赋能'), text.length);
    expect(() => checkProse(text.replace('\r\n', '\n'), { exemptions: saved })).toThrow('摘要不符');
  });

  test('非法范围与空理由拒绝，不能吞掉配置错误', () => {
    const text = '赋能工作。';
    for (const [start, end] of [[-1, 2], [0, 0], [0, 999], [0.5, 2]]) {
      expect(() => checkProse(text, { exemptions: exemption(text, start!, end!) })).toThrow('范围非法');
    }
    const saved = exemption(text, 0, 2);
    saved.spans[0]!.reason = '';
    expect(() => checkProse(text, { exemptions: saved })).toThrow('例外理由');
  });

  test('配置拒绝冲突、未知规则、自定义正则与非标点', () => {
    expect(() => validateAuthorRules(rules({ forbiddenTerms: ['闭环'], allowedTerms: ['闭环'] }))).toThrow('冲突');
    expect(() => validateAuthorRules({ schemaVersion: 1, forbiddenPatterns: ['custom'] })).toThrow('未知句式');
    expect(() => validateAuthorRules({ schemaVersion: 1, regex: '.*' })).toThrow('未知字段');
    expect(() => validateAuthorRules(rules({ forbiddenPunctuation: ['禁止'] }))).toThrow('只能包含标点');
    expect(() => validateAuthorRules({ schemaVersion: 1, disabledSignals: ['author.term'] })).toThrow('未知通用提示');
  });
});

describe('非正文与 UTF-16 位置', () => {
  test('屏蔽 frontmatter、代码、链接、URL 和 HTML，并保持代理对与原始换行', () => {
    const text = [
      '---', 'title: 赋能😀', '---', '正文在这里。',
      '```ts', 'const value: string = "赋能😀";', '```',
      '行内 `const value: string = "赋能😀"`。',
      '[链接](https://example.com/赋能😀:a)', '<span data-name="赋能😀">标签</span>',
    ].join('\r\n');
    const masked = maskNonProse(text);
    expect(masked.length).toBe(text.length);
    expect([...masked.matchAll(/\r\n/g)].map((match) => match.index)).toEqual([...text.matchAll(/\r\n/g)].map((match) => match.index));
    const result = checkProse(text, { rules: rules({ forbiddenTerms: ['赋能'], forbiddenPunctuation: [':'] }) });
    expect(result.counts.jargon).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  test('emoji 与多行代码之后的诊断仍落在原始 UTF-16 范围', () => {
    const text = '```ts\r\n"😀赋能";\r\n```\r\n😀赋能工作。';
    const result = checkProse(text, { rules: rules({ forbiddenTerms: ['赋能'] }) });
    const finding = result.findings.find((item) => item.ruleId === 'author.term')!;
    expect(finding.start).toBe(text.lastIndexOf('赋能'));
    expect(finding.end).toBe(finding.start + 2);
    expect(finding.line).toBe(4);
    expect(finding.column).toBe(3);
    expect(text.slice(finding.start, finding.end)).toBe(finding.text);
  });

  test('波浪线代码围栏也屏蔽', () => {
    expect(checkProse('~~~text\n赋能工作。\n~~~\n正文。').counts.jargon).toBe(0);
  });

  test('HTML 内容可检查，标签属性不可检查', () => {
    expect(checkProse('<p data-value="赋能">赋能工作。</p>').counts.jargon).toBe(1);
  });
});

describe('提示边界与严格参数兼容', () => {
  test('洞察路标达到阈值不提醒，超过才提醒', () => {
    const boundary = checkProse('真正需要核对。本质上仍是记录。');
    const over = checkProse('真正需要核对。本质上仍是记录。换句话说，先看数据。');
    expect(boundary.findings.some((item) => item.ruleId === 'signal.soft_markers')).toBe(false);
    expect(over.findings.some((item) => item.ruleId === 'signal.soft_markers')).toBe(true);
  });

  test('冒号与破折号默认提示，strict 不升级', () => {
    const normal = checkProse('结果：任务完成——耗时两天。');
    const strict = checkProse('结果：任务完成——耗时两天。', { strict: true });
    expect(normal.failures).toHaveLength(0);
    expect(strict.failures).toHaveLength(0);
    expect(normal.findings.filter((item) => item.category === 'punctuation')).toHaveLength(2);
    expect(strict.warnings.some((item) => item.includes('已弃用'))).toBe(true);
  });

  test('通用冒号忽略标题、列表和引语引出，但作者冒号禁令仍检查', () => {
    const text = '# 标题：测试\n\n- 项目：值\n\n张三说：“好。”';
    expect(checkProse(text).findings.filter((item) => item.ruleId === 'punctuation.colon')).toHaveLength(0);
    expect(checkProse(text, { rules: rules({ forbiddenPunctuation: ['：'] }) }).failures).toHaveLength(3);
  });

  test('明确路标和标点禁令具有独立结构诊断', () => {
    const result = checkProse('值得注意的是，结果——只有两项。', {
      rules: rules({ forbiddenPatterns: ['phrase.road_sign'], forbiddenPunctuation: ['——'] }),
    });
    expect(result.failures).toHaveLength(2);
    expect(result.findings.some((item) => item.ruleId === 'phrase.road_sign' && item.severity === 'error')).toBe(true);
    expect(result.findings.some((item) => item.ruleId === 'author.punctuation' && item.text === '——')).toBe(true);
  });

  test('段首路标与长前置成分报告自身所在原始行', () => {
    const road = checkProse('上一段结束。\n\n值得注意的是，数据没有变化。');
    expect(road.findings.find((item) => item.ruleId === 'phrase.road_sign')?.line).toBe(3);
    const branches = checkProse([
      '上一段结束。', '',
      '在项目已经进入验收并且预算全部用完的情况下，团队才发现接口没有对上。',
      '在设备完成三轮巡检并且记录逐条归档的过程中，值班员又补了一次抽查。',
      '在方案经过两次评审并且风险列表确认关闭的背景下，上线时间才定下来。',
    ].join('\n'));
    expect(branches.findings.find((item) => item.ruleId === 'signal.left_branch')?.line).toBe(3);
  });

  test('没有中文正文时正常完成，不能凭此证明事实正确', () => {
    const result = checkProse('---\ntitle: 赋能\n---\n```text\n赋能\n```\nOnly English.');
    expect(result.scanned).toBe(false);
    expect(result.totalHan).toBe(0);
    expect(result.failures).toHaveLength(0);
  });
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-prose-test-'));
afterAll(() => {
  if (path.dirname(path.resolve(tempRoot)) !== path.resolve(os.tmpdir())) throw new Error('测试清理路径越界。');
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function cli(text: string, extra: string[] = []) {
  const file = path.join(tempRoot, 'article.md');
  fs.writeFileSync(file, text, 'utf8');
  const processResult = Bun.spawnSync([process.execPath, path.join(import.meta.dir, 'check-prose.ts'), file, ...extra]);
  return { code: processResult.exitCode, out: new TextDecoder().decode(processResult.stdout), err: new TextDecoder().decode(processResult.stderr) };
}

describe('CLI 参数与退出码', () => {
  test('未知参数、缺值、多个正文路径和重复参数报错', () => {
    for (const args of [['--wat'], ['a.md', '--rules'], ['a.md', '--rules', '--json'], ['a.md', 'b.md'], ['a.md', '--json', '--json']]) {
      expect(() => parseCliArgs(args)).toThrow();
    }
    expect(parseCliArgs(['--rules', 'rules.json', '-', '--json']).filePath).toBe('-');
    expect(cli('正文。', ['--wat']).code).toBe(2);
  });

  test('通用提示返回 0，作者错误返回 1，配置错误返回 2', () => {
    const file = path.join(tempRoot, 'rules.json');
    expect(cli('赋能工作。', ['--json']).code).toBe(0);
    fs.writeFileSync(file, JSON.stringify(rules({ forbiddenTerms: ['赋能'] })));
    const authored = cli('赋能工作。', ['--rules', file, '--json']);
    expect(authored.code).toBe(1);
    expect(JSON.parse(authored.out).findings.some((finding: { severity: string }) => finding.severity === 'error')).toBe(true);
    fs.writeFileSync(file, '{ bad json');
    expect(cli('正文。', ['--rules', file]).code).toBe(2);
  });

  test('有效例外返回 0，过期例外返回 2', () => {
    const file = path.join(tempRoot, 'exemptions.json');
    const ruleFile = path.join(tempRoot, 'rules.json');
    const text = '赋能工作。';
    fs.writeFileSync(ruleFile, JSON.stringify(rules({ forbiddenTerms: ['赋能'] })));
    fs.writeFileSync(file, JSON.stringify(exemption(text, 0, 2)));
    expect(cli(text, ['--rules', ruleFile, '--exemptions', file]).code).toBe(0);
    expect(cli(`${text}新增内容。`, ['--exemptions', file]).code).toBe(2);
  });

  test('strict 弃用提示走 stderr，JSON stdout 可独立解析', () => {
    const result = cli('结果：完成——两天。', ['--strict', '--json']);
    expect(result.code).toBe(0);
    expect(result.err).toContain('已弃用');
    expect(JSON.parse(result.out).failures).toHaveLength(0);
  });

  test('无中文正文返回 0 和 scanned false', () => {
    const result = cli('Only English.', ['--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).scanned).toBe(false);
  });
});
