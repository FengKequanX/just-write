#!/usr/bin/env bun
/**
 * 检查中文成稿的硬禁令与常见模型化形状。只报告，不自动改文。
 * Adapted from KKKKhazix/human-writing (MIT), scripts/check_prose.py.
 */

import fs from 'node:fs';
import process from 'node:process';

export const HARD_STOPS = [
  '说白了',
  '说穿了',
  '先说结论',
] as const;

export const HARD_JARGON = [
  '赋能',
  '抓手',
  '商业闭环',
  '价值闭环',
  '闭环',
  '能力沉淀',
  '打法',
  '拉通',
  '底层逻辑',
  '顶层设计',
  '认知跃迁',
  '价值释放',
  '能力建设',
  '降本增效',
  '内容矩阵',
  '全链路',
  '组合拳',
  '打开想象空间',
  '想象空间',
  '结构性机会',
  '关键命题',
  '深层逻辑',
  '技术底座',
  '公共底座',
  '技术主权',
  '单点风险',
  '认知增量',
  '迭代闭环',
] as const;

export const CONTEXT_JARGON = [
  '沉淀',
  '颗粒度',
  '对齐',
  '协同',
  '链路',
  '生态位',
  '心智',
  '范式',
  '方法论',
  '核心变量',
] as const;

export const ROAD_SIGNS = [
  '更微妙的是',
  '还有一层',
  '只说对了一半',
  '值得注意的是',
  '需要指出的是',
  '从某种意义上说',
] as const;

const PIVOT_PATTERNS = [
  /(?:并)?不是[^。！？!?\n]{0,90}而是/,
  /并非[^。！？!?\n]{0,90}而是/,
  /不在于[^。！？!?\n]{0,90}而在于/,
  /与其说[^。！？!?\n]{0,90}不如说/,
  /不只(?:是)?[^。！？!?\n]{0,90}(?:还|也)/,
  /表面(?:上)?[^。！？!?\n]{0,90}(?:其实|实际|实则)/,
  /看似[^。！？!?\n]{0,90}(?:其实|实际|实则)/,
] as const;

const ROAD_SIGN_PATTERNS = [
  new RegExp(`(?:^|[。！？!?]\\s*)${ROAD_SIGNS[0]}[^。！？!?\\n]{0,24}`, 'm'),
  new RegExp(`(?:^|[。！？!?]\\s*)${ROAD_SIGNS[1]}(?=(?:更|原因|问题|意思|考虑|变化|逻辑|价值|作用|风险|影响|值得|很少|不容易|常被|往往))[^。！？!?\\n]{0,24}`, 'm'),
  ...ROAD_SIGNS.slice(2).map((phrase) => new RegExp(`(?:^|[。！？!?]\\s*)${phrase}[^。！？!?\\n]{0,24}`, 'm')),
] as const;

const SOFT_MARKERS = [
  '真正',
  '本质上',
  '更深层次',
  '归根结底',
  '换句话说',
  '不可否认',
  '核心是',
  '关键在于',
  '这意味着',
] as const;

const REPEATED_OPENERS = [
  '其实',
  '不过',
  '当然',
  '所以',
  '但是',
  '后来',
  '当时',
  '很多人',
  '问题是',
  '更重要的是',
  '说到这里',
] as const;

const LEFT_BRANCH_PATTERNS = [
  /(?:^|[。！？]\s*)在[^，。！？\n]{12,70}(?:以后|之后|之前|以前|过程中|情况下|背景下)，/,
  /(?:^|[。！？]\s*)那些[^，。！？\n]{10,60}的[^，。！？\n]{2,30}[，。]/,
  /(?:^|[。！？]\s*)(?:真正|最终|最后)让[^，。！？\n]{8,70}的，是/,
] as const;

const METAPHOR_FIELDS = {
  温度: ['降温', '升温', '冷却', '余温', '温度最高'],
  生死战争: ['杀死', '死因', '枪响', '开火', '战场', '引爆', '弹药'],
  建筑灾害: ['坍塌', '崩塌', '地基', '砖头', '支柱', '废墟'],
  仓储租赁: ['仓库', '库房', '租金', '取货', '入库', '库存'],
  道路竞赛: ['赛道', '跑道', '岔路', '十字路口', '终点线', '门票'],
  机器器官: ['齿轮', '引擎', '发动机', '血管', '骨架', '肌肉'],
  海洋航行: ['蓝海', '浪潮', '潮水', '航船', '灯塔', '彼岸'],
} as const;

interface Match {
  index: number;
  text: string;
}

interface Paragraph {
  position: number;
  text: string;
  han: number;
  sentences: number;
}

export interface CheckCounts {
  pivots: number;
  jargon: number;
  hardStops: number;
  roadSigns: number;
  contextJargon: number;
  softMarkers: number;
  leftBranches: number;
  denseDe: number;
}

export interface CheckResult {
  totalHan: number;
  counts: CheckCounts;
  failures: string[];
  warnings: string[];
}

function hanCount(text: string): number {
  return text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
}

function lineNumber(text: string, position: number): number {
  return text.slice(0, position).split('\n').length;
}

function excerpt(value: string, width = 72): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= width ? compact : `${compact.slice(0, width - 1)}…`;
}

function maskedValue(value: string): string {
  return [...value].map((character) => character === '\n' ? '\n' : character === '\r' ? '\r' : ' ').join('');
}

export function maskNonProse(text: string): string {
  const patterns = [
    /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/,
    /```[\s\S]*?```/g,
    /`[^`\n]*`/g,
    /\]\([^\n)]*\)/g,
    /https?:\/\/[^\s)>]+/g,
    /<[^>\n]+>/g,
  ];

  let masked = text;
  for (const pattern of patterns) {
    masked = masked.replace(pattern, (value) => maskedValue(value));
  }
  return masked;
}

function maskDefaultColonExemptions(text: string): string {
  const lines = text.split(/(?<=\n)/);
  return lines.map((line) => {
    if (/^\s*(?:#{1,6}\s|[-+*]\s|\d+[.、]\s)/.test(line)) {
      return line.replace(/[:：]/g, ' ');
    }

    const attribution = line.match(/^\s*(?:>\s*)?(?:(?:[\u4e00-\u9fffA-Za-z0-9_·]{1,12}(?:说|问|答|喊|写道|回复))|(?:[\u4e00-\u9fffA-Za-z0-9_·]{2,4}(?=\s*[:：]\s*[“「])))(?:\s*)([:：])/);
    if (!attribution || attribution.index === undefined) return line;
    const colon = attribution.index + attribution[0].lastIndexOf(attribution[1]!);
    return `${line.slice(0, colon)} ${line.slice(colon + 1)}`;
  }).join('');
}

function nonOverlappingTerms(text: string, terms: readonly string[]): Match[] {
  const matches: Match[] = [];
  const occupied: Array<[number, number]> = [];
  for (const term of [...terms].sort((left, right) => right.length - left.length)) {
    let cursor = 0;
    while (cursor < text.length) {
      const index = text.indexOf(term, cursor);
      if (index < 0) break;
      const end = index + term.length;
      if (!occupied.some(([oldStart, oldEnd]) => index < oldEnd && end > oldStart)) {
        matches.push({ index, text: term });
        occupied.push([index, end]);
      }
      cursor = index + Math.max(term.length, 1);
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

function allMatches(text: string, patterns: readonly RegExp[]): Match[] {
  const matches: Match[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      matches.push({ index: match.index, text: match[0] });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

function symbolMatches(text: string, pattern: RegExp): Match[] {
  return [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[0] }));
}

function heavyDeSentences(text: string): Match[] {
  return allMatches(text, [/[^。！？!?\n]+(?:[。！？!?]|$)/])
    .filter((match) => hanCount(match.text) >= 38 && (match.text.match(/的/g)?.length ?? 0) >= 4);
}

function proseParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const blockPattern = /[^\r\n](?:[\s\S]*?[^\r\n])?(?=\r?\n\s*\r?\n|$)/g;
  for (const match of text.matchAll(blockPattern)) {
    const clean = match[0].replace(/[>*_`]/g, '').trim();
    if (!clean || clean.startsWith('#') || clean.startsWith('http') || clean.startsWith('![') || clean.startsWith('```')) continue;
    if (/^(?:[-+*]|\d+[.、])\s/.test(clean)) continue;
    const han = hanCount(clean);
    if (han < 4) continue;
    const sentences = Math.max(1, clean.match(/[。！？!?]/g)?.length ?? 0);
    paragraphs.push({ position: match.index, text: clean, han, sentences });
  }
  return paragraphs;
}

function metaphorCluster(text: string, distance = 800): { fields: string[]; words: string[] } | undefined {
  const hits: Array<{ index: number; field: string; word: string }> = [];
  for (const [field, words] of Object.entries(METAPHOR_FIELDS)) {
    for (const word of words) {
      let cursor = 0;
      while (cursor < text.length) {
        const index = text.indexOf(word, cursor);
        if (index < 0) break;
        hits.push({ index, field, word });
        cursor = index + word.length;
      }
    }
  }
  hits.sort((left, right) => left.index - right.index);
  for (let index = 0; index < hits.length; index += 1) {
    const window = hits.slice(index).filter((hit) => hit.index - hits[index]!.index <= distance);
    const fields = [...new Set(window.map((hit) => hit.field))];
    if (fields.length >= 3) return { fields, words: [...new Set(window.map((hit) => hit.word))] };
  }
  return undefined;
}

function shortStreak(paragraphs: Paragraph[], limit = 4): Paragraph[] | undefined {
  let streak: Paragraph[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.han <= 24 && paragraph.sentences <= 1) {
      streak.push(paragraph);
      if (streak.length >= limit) return streak;
    } else {
      streak = [];
    }
  }
  return undefined;
}

function openerCounts(paragraphs: Paragraph[]): { counts: Map<string, number>; examples: Map<string, number> } {
  const counts = new Map<string, number>();
  const examples = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const value = paragraph.text.replace(/^[“‘"（(]+/, '');
    for (const opener of REPEATED_OPENERS) {
      if (!value.startsWith(opener)) continue;
      counts.set(opener, (counts.get(opener) ?? 0) + 1);
      if (!examples.has(opener)) examples.set(opener, paragraph.position);
      break;
    }
  }
  return { counts, examples };
}

function punctuationMessage(label: string, matches: Match[], original: string): string {
  const lines = [...new Set(matches.slice(0, 8).map((match) => lineNumber(original, match.index)))].join('、');
  return `${label}共 ${matches.length} 处，出现在第 ${lines} 行。`;
}

export function checkProse(text: string, options: { strict?: boolean } = {}): CheckResult {
  const prose = maskNonProse(text);
  const totalHan = hanCount(prose);
  const failures: string[] = [];
  const warnings: string[] = [];

  const punctuationText = options.strict ? prose : maskDefaultColonExemptions(prose);
  const punctuation = [
    { label: '冒号', matches: symbolMatches(punctuationText, /[:：]/g) },
    { label: '破折号', matches: symbolMatches(prose, /——|—|–/g) },
  ];
  for (const item of punctuation) {
    if (!item.matches.length) continue;
    const message = punctuationMessage(item.label, item.matches, text);
    (options.strict ? failures : warnings).push(message);
  }

  const stopMatches = nonOverlappingTerms(prose, HARD_STOPS);
  for (const match of stopMatches) {
    failures.push(`硬停词，第 ${lineNumber(text, match.index)} 行，${match.text}`);
  }

  const jargonMatches = nonOverlappingTerms(prose, HARD_JARGON);
  for (const match of jargonMatches) {
    failures.push(`黑话，第 ${lineNumber(text, match.index)} 行，${match.text}`);
  }

  const hardSpans = jargonMatches.map((match) => [match.index, match.index + match.text.length] as const);
  const contextMatches = nonOverlappingTerms(prose, CONTEXT_JARGON).filter((match) =>
    !hardSpans.some(([start, end]) => match.index < end && match.index + match.text.length > start));
  if (contextMatches.length) {
    const samples = [...new Set(contextMatches.map((match) => match.text))].join('、');
    const lines = [...new Set(contextMatches.slice(0, 8).map((match) => lineNumber(text, match.index)))].join('、');
    warnings.push(`有 ${contextMatches.length} 处词语需要结合语境判断。第 ${lines} 行出现 ${samples}。本义准确时保留，用来抬价时改写。`);
  }

  const roadSigns = allMatches(prose, ROAD_SIGN_PATTERNS);
  for (const match of roadSigns) {
    failures.push(`模型路标，第 ${lineNumber(text, match.index)} 行，“${excerpt(match.text.replace(/^[。！？!?\s]+/, ''))}”`);
  }

  const pivots = allMatches(prose, PIVOT_PATTERNS);
  for (const match of pivots) {
    failures.push(`禁用翻案句，第 ${lineNumber(text, match.index)} 行，“${excerpt(match.text)}”`);
  }

  const markerMatches = nonOverlappingTerms(prose, SOFT_MARKERS);
  const markerLimit = Math.max(2, Math.floor(totalHan / 900));
  if (markerMatches.length > markerLimit) {
    const samples = [...new Set(markerMatches.map((match) => match.text))].join('、');
    warnings.push(`洞察路标共 ${markerMatches.length} 处，当前提醒线为 ${markerLimit} 处。重点检查 ${samples}。`);
  }

  const leftBranches = allMatches(prose, LEFT_BRANCH_PATTERNS);
  const leftLimit = Math.max(2, Math.floor(totalHan / 1200));
  if (leftBranches.length > leftLimit) {
    const samples = leftBranches.slice(0, 4).map((match) => `第 ${lineNumber(text, match.index)} 行“${excerpt(match.text, 44)}”`).join('；');
    warnings.push(`长前置成分共 ${leftBranches.length} 处，可能让主干来得太晚。${samples}`);
  }

  const denseDe = heavyDeSentences(prose);
  const denseDeLimit = Math.max(1, Math.floor(totalHan / 1500));
  if (denseDe.length > denseDeLimit) {
    const samples = denseDe.slice(0, 4).map((match) => `第 ${lineNumber(text, match.index)} 行“${excerpt(match.text, 44)}”`).join('；');
    warnings.push(`有 ${denseDe.length} 个长句包含四个以上的“的”，可能要先交代人和动作。${samples}`);
  }

  const paragraphs = proseParagraphs(prose);
  if (paragraphs.length >= 10) {
    const oneSentence = paragraphs.filter((paragraph) => paragraph.sentences <= 1).length;
    const ratio = oneSentence / paragraphs.length;
    if (ratio >= 0.75) warnings.push(`可识别段落中有 ${Math.round(ratio * 100)}% 只有一句话，可能形成统一的短段鼓点。`);
  }

  const streak = shortStreak(paragraphs);
  if (streak) {
    warnings.push(`从第 ${lineNumber(text, streak[0]!.position)} 行起连续出现 ${streak.length} 个短促单句段，检查是否在排队喊结论。`);
  }

  const { counts: openerMap, examples } = openerCounts(paragraphs);
  const repeatedOpeners = [...openerMap].filter(([, count]) => count >= 4);
  if (repeatedOpeners.length) {
    const details = repeatedOpeners.map(([opener, count]) => `${opener} ${count} 次`).join('、');
    const first = Math.min(...repeatedOpeners.map(([opener]) => examples.get(opener)!));
    warnings.push(`段落开场重复，从第 ${lineNumber(text, first)} 行附近开始。${details}。`);
  }

  const metaphors = metaphorCluster(prose);
  if (metaphors) {
    warnings.push(`八百字内出现 ${metaphors.fields.length} 套借喻。${metaphors.fields.sort().join('、')}。例词有 ${metaphors.words.join('、')}。`);
  }

  return {
    totalHan,
    counts: {
      pivots: pivots.length,
      jargon: jargonMatches.length,
      hardStops: stopMatches.length,
      roadSigns: roadSigns.length,
      contextJargon: contextMatches.length,
      softMarkers: markerMatches.length,
      leftBranches: leftBranches.length,
      denseDe: denseDe.length,
    },
    failures,
    warnings,
  };
}

export function formatCheckResult(result: CheckResult): string {
  const lines = [
    `汉字数 ${result.totalHan}`,
    `翻案句 ${result.counts.pivots}，黑话 ${result.counts.jargon}，硬停词 ${result.counts.hardStops}，模型路标 ${result.counts.roadSigns}，需辨语境词 ${result.counts.contextJargon}，洞察路标 ${result.counts.softMarkers}，长前置成分 ${result.counts.leftBranches}，重定语句 ${result.counts.denseDe}`,
  ];

  if (result.failures.length) lines.push('', '需要修改', ...result.failures.map((item) => `- ${item}`));
  if (result.warnings.length) lines.push('', '需要人工判断', ...result.warnings.map((item) => `- ${item}`));
  if (!result.failures.length && !result.warnings.length) lines.push('', '未发现这份检查器覆盖的问题。');
  return lines.join('\n');
}

function readText(filePath: string): string {
  return filePath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(filePath, 'utf8');
}

export function runCli(args = process.argv.slice(2)): number {
  const strict = args.includes('--strict');
  const filePath = args.find((argument) => !argument.startsWith('--'));
  if (!filePath) {
    console.error('用法: bun check-prose.ts [--strict] <稿件.md|->');
    return 2;
  }

  try {
    const result = checkProse(readText(filePath), { strict });
    if (result.totalHan === 0) {
      console.error('没有检测到汉字。');
      return 2;
    }
    console.log(formatCheckResult(result));
    return result.failures.length ? 1 : 0;
  } catch (error) {
    console.error(`无法读取稿件。${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = runCli();
