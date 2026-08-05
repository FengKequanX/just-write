/** Adapted from KKKKhazix/human-writing (MIT), scripts/check_prose.py. */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkProse,
  CONTEXT_JARGON,
  HARD_JARGON,
  HARD_STOPS,
  maskNonProse,
  ROAD_SIGNS,
} from './check-prose';

describe('翻案句', () => {
  const samples = [
    '这不是速度问题，而是输入不完整。',
    '原因并非费用太高，而是审批太慢。',
    '重点不在于功能多少，而在于能否完成任务。',
    '与其说他拒绝合作，不如说双方没有谈拢。',
    '这不只是一次更新，也改变了收费方式。',
    '表面上流程缩短了，实际等待更久。',
    '看似选择更多，实则限制也更多。',
  ];

  for (const sample of samples) {
    test(`命中 ${sample.slice(0, 8)}`, () => {
      const result = checkProse(sample);
      expect(result.counts.pivots).toBe(1);
      expect(result.failures.some((item) => item.includes('禁用翻案句'))).toBe(true);
    });
  }
});

describe('硬禁词和行号', () => {
  test('命中商业黑话且不重复计算被包含的短词', () => {
    const result = checkProse('团队准备建立商业闭环。');
    expect(result.counts.jargon).toBe(1);
    expect(result.failures[0]).toContain('商业闭环');
  });

  test('报告原文中的正确行号', () => {
    const result = checkProse('第一行。\n第二行。\n赋能工作。');
    expect(result.failures).toContain('黑话，第 3 行，赋能');
  });

  test('脚本硬禁词全部写在文档中', () => {
    const skill = fs.readFileSync(path.resolve(import.meta.dir, '..', 'SKILL.md'), 'utf8');
    for (const term of [...HARD_STOPS, ...HARD_JARGON, ...ROAD_SIGNS, ...CONTEXT_JARGON]) {
      expect(skill).toContain(term);
    }

    const termsAfter = (label: string) => {
      const line = skill.split('\n').find((value) => value.startsWith(label));
      return [...(line ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    };
    expect(termsAfter('硬禁词：')).toEqual([...HARD_STOPS]);
    expect(termsAfter('硬禁词表：')).toEqual([...HARD_JARGON]);
    expect(termsAfter('硬禁把以下短语用来抬高段落：')).toEqual([...ROAD_SIGNS]);
    expect(termsAfter('`沉淀`')).toEqual([...CONTEXT_JARGON]);
  });
});

describe('非正文屏蔽', () => {
  test('屏蔽 frontmatter、代码、链接、URL 和 HTML 并保持位置', () => {
    const text = [
      '---',
      'title: 赋能',
      '---',
      '正文在这里。',
      '```ts',
      'const value: string = "赋能";',
      '```',
      '行内 `const value: string = "赋能"`。',
      '[链接](https://example.com/a:b)',
      '<span data-name="赋能">标签</span>',
    ].join('\n');

    const masked = maskNonProse(text);
    expect(masked.length).toBe(text.length);
    expect(masked.split('\n').length).toBe(text.split('\n').length);

    const result = checkProse(text);
    expect(result.counts.jargon).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings.some((item) => item.startsWith('冒号'))).toBe(false);
  });
});

describe('警告边界', () => {
  test('洞察路标达到阈值不警告，超过阈值才警告', () => {
    const atBoundary = checkProse('真正需要核对。本质上仍是记录。');
    const overBoundary = checkProse('真正需要核对。本质上仍是记录。换句话说，先看数据。');
    expect(atBoundary.warnings.some((item) => item.startsWith('洞察路标共'))).toBe(false);
    expect(overBoundary.warnings.some((item) => item.startsWith('洞察路标共'))).toBe(true);
  });

  test('标题、列表和对话引出的冒号默认豁免', () => {
    const result = checkProse('# 标题：测试\n\n- 项目：值\n\n张三说：“好。”\n\n正文到这里。');
    expect(result.warnings.some((item) => item.startsWith('冒号'))).toBe(false);
  });

  test('正文破折号默认失败，冒号默认警告、strict 升级为失败', () => {
    const text = '结果：任务完成——耗时两天。';
    const normal = checkProse(text);
    const strict = checkProse(text, { strict: true });
    expect(normal.failures.some((item) => item.startsWith('破折号'))).toBe(true);
    expect(normal.failures.some((item) => item.startsWith('冒号'))).toBe(false);
    expect(normal.warnings.some((item) => item.startsWith('冒号'))).toBe(true);
    expect(strict.failures.some((item) => item.startsWith('冒号'))).toBe(true);
    expect(strict.failures.some((item) => item.startsWith('破折号'))).toBe(true);
  });

  test('段首模型路标和长前置成分报告自身所在行号', () => {
    const roadSign = checkProse('上一段结束。\n\n值得注意的是，数据没有变化。');
    expect(roadSign.failures.some((item) => item.includes('第 3 行') && item.includes('值得注意的是'))).toBe(true);

    const leftBranch = checkProse([
      '上一段结束。',
      '',
      '在项目已经进入验收并且预算全部用完的情况下，团队才发现接口没有对上。',
      '在设备完成三轮巡检并且记录逐条归档的过程中，值班员又补了一次抽查。',
      '在方案经过两次评审并且风险列表确认关闭的背景下，上线时间才定下来。',
    ].join('\n'));
    const sample = leftBranch.warnings.find((item) => item.startsWith('长前置成分'));
    expect(sample).toBeDefined();
    expect(sample).toContain('第 3 行');
    expect(sample).not.toContain('第 1 行');
  });
});
