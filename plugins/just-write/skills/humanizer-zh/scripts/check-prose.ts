#!/usr/bin/env bun
/**
 * 检查明确作者规则与常见表达形状。通用扫描只提醒，不自动改文或验证事实。
 * Adapted from KKKKhazix/human-writing (MIT), scripts/check_prose.py.
 */

import fs from 'node:fs';
import process from 'node:process';
import { createHash } from 'node:crypto';

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

export const AUTHOR_PATTERN_IDS = [
  'pivot.not_but', 'pivot.not_rather', 'pivot.not_in_but_in',
  'pivot.rather_than', 'pivot.not_only', 'pivot.surface_actual',
  'pivot.seems_actual', 'phrase.road_sign',
] as const;
export type AuthorPatternId = typeof AUTHOR_PATTERN_IDS[number];

export const SIGNAL_IDS = [
  ...AUTHOR_PATTERN_IDS,
  'term.jargon', 'term.hard_stop', 'term.context_jargon',
  'punctuation.colon', 'punctuation.dash',
  'signal.soft_markers', 'signal.left_branch', 'signal.dense_de',
  'signal.short_paragraph_ratio', 'signal.short_streak',
  'signal.repeated_opener', 'signal.metaphor_cluster',
] as const;

export interface AuthorRules {
  schemaVersion: 1;
  forbiddenTerms?: string[];
  forbiddenPatterns?: AuthorPatternId[];
  forbiddenPunctuation?: string[];
  allowedTerms?: string[];
  disabledSignals?: Array<typeof SIGNAL_IDS[number]>;
}

export interface ExemptionSpan {
  start: number;
  end: number;
  kind: 'quote' | 'term' | 'preserved';
  reason: string;
}

export interface ProseExemptions {
  schemaVersion: 1;
  documentSha256: string;
  spans: ExemptionSpan[];
}

export interface ProseFinding {
  ruleId: string;
  category: 'term' | 'pattern' | 'punctuation' | 'structure';
  severity: 'warning' | 'error';
  start: number;
  end: number;
  line: number;
  column: number;
  text: string;
  message: string;
  exemption?: ExemptionSpan;
}

export interface CheckOptions {
  /** 保留旧参数；不再升级通用扫描等级。 */
  strict?: boolean;
  rules?: AuthorRules;
  exemptions?: ProseExemptions;
}

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
  sourceText: string;
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
  scanned: boolean;
  totalHan: number;
  counts: CheckCounts;
  findings: ProseFinding[];
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
  // 非 u 的正则逐 UTF-16 code unit 替换，不能用 [...value] 压缩代理对。
  return value.replace(/[^\r\n]/g, ' ');
}

export function maskNonProse(text: string): string {
  const patterns = [
    /^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/,
    /(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\1[^\r\n]*(?:\r?\n|$)/gm,
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
    paragraphs.push({ position: match.index, text: clean, sourceText: match[0], han, sentences });
  }
  return paragraphs;
}

function metaphorCluster(text: string, distance = 800): { fields: string[]; words: string[]; start: number; end: number } | undefined {
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
    if (fields.length >= 3) return {
      fields, words: [...new Set(window.map((hit) => hit.word))],
      start: window[0]!.index,
      end: window.at(-1)!.index + window.at(-1)!.word.length,
    };
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
      if (!examples.has(opener)) examples.set(opener, paragraph.position + paragraph.sourceText.indexOf(opener));
      break;
    }
  }
  return { counts, examples };
}

// 段首命中时，模式里的 (?:^|[。！？!?]\s*) 会把上一段末尾的标点吞进匹配，
// 行号要从剥掉前导标点后的位置算起。
function stripLeadingPunctuation(match: Match): Match {
  const text = match.text.replace(/^[。！？!?\s]+/, '');
  return { index: match.index + (match.text.length - text.length), text };
}


export function documentSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function requireObject(value: unknown, label: string, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) throw new Error(`${label}包含未知字段：${key}。`);
  }
  return object;
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label}必须是非空字符串数组。`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label}有重复项。`);
  return value as string[];
}

export function validateAuthorRules(value: unknown): AuthorRules {
  const object = requireObject(value, '作者规则', [
    'schemaVersion', 'forbiddenTerms', 'forbiddenPatterns', 'forbiddenPunctuation', 'allowedTerms', 'disabledSignals',
  ]);
  if (object.schemaVersion !== 1) throw new Error('作者规则 schemaVersion 必须为 1。');
  const forbiddenTerms = stringArray(object.forbiddenTerms, 'forbiddenTerms');
  const forbiddenPatterns = stringArray(object.forbiddenPatterns, 'forbiddenPatterns');
  const forbiddenPunctuation = stringArray(object.forbiddenPunctuation, 'forbiddenPunctuation');
  const allowedTerms = stringArray(object.allowedTerms, 'allowedTerms');
  const disabledSignals = stringArray(object.disabledSignals, 'disabledSignals');
  for (const id of forbiddenPatterns) {
    if (!(AUTHOR_PATTERN_IDS as readonly string[]).includes(id)) throw new Error(`未知句式规则：${id}。`);
  }
  for (const id of disabledSignals) {
    if (!(SIGNAL_IDS as readonly string[]).includes(id)) throw new Error(`未知通用提示：${id}。`);
  }
  if (forbiddenPunctuation.some((item) => !/^\p{P}+$/u.test(item))) throw new Error('forbiddenPunctuation 只能包含标点。');
  for (const term of allowedTerms) {
    if (forbiddenTerms.includes(term)) throw new Error(`允许项与禁止项冲突：${term}。`);
  }
  return {
    schemaVersion: 1, forbiddenTerms,
    forbiddenPatterns: forbiddenPatterns as AuthorPatternId[],
    forbiddenPunctuation, allowedTerms,
    disabledSignals: disabledSignals as Array<typeof SIGNAL_IDS[number]>,
  };
}

export function validateExemptions(value: unknown, text: string): ProseExemptions {
  const object = requireObject(value, '单次例外', ['schemaVersion', 'documentSha256', 'spans']);
  if (object.schemaVersion !== 1) throw new Error('单次例外 schemaVersion 必须为 1。');
  if (typeof object.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(object.documentSha256)) {
    throw new Error('documentSha256 必须是 SHA-256 十六进制摘要。');
  }
  if (object.documentSha256.toLowerCase() !== documentSha256(text)) throw new Error('单次例外已过期：稿件摘要不符。');
  if (!Array.isArray(object.spans)) throw new Error('spans 必须是数组。');
  const spans = object.spans.map((value, index) => {
    const span = requireObject(value, `spans[${index}]`, ['start', 'end', 'kind', 'reason']);
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
      || (span.start as number) < 0 || (span.end as number) <= (span.start as number)
      || (span.end as number) > text.length) throw new Error(`spans[${index}] 范围非法。`);
    if (!['quote', 'term', 'preserved'].includes(span.kind as string)) throw new Error(`spans[${index}] kind 非法。`);
    if (typeof span.reason !== 'string' || !span.reason.trim()) throw new Error(`spans[${index}] 缺少例外理由。`);
    return span as unknown as ExemptionSpan;
  });
  return { schemaVersion: 1, documentSha256: object.documentSha256, spans };
}

function termSpans(text: string, terms: string[]): ExemptionSpan[] {
  return nonOverlappingTerms(text, terms).map((match) => ({
    start: match.index, end: match.index + match.text.length, kind: 'term', reason: '作者规则中明确允许的完整术语',
  }));
}

function patternMatches(text: string, id: AuthorPatternId): Match[] {
  if (id === 'phrase.road_sign') return allMatches(text, ROAD_SIGN_PATTERNS).map(stripLeadingPunctuation);
  return allMatches(text, [PIVOT_PATTERNS[AUTHOR_PATTERN_IDS.indexOf(id)]!]);
}

export function checkProse(text: string, options: CheckOptions = {}): CheckResult {
  const rules = validateAuthorRules(options.rules ?? { schemaVersion: 1 });
  const exemptions = options.exemptions ? validateExemptions(options.exemptions, text).spans : [];
  const prose = maskNonProse(text);
  const totalHan = hanCount(prose);
  const findings: ProseFinding[] = [];
  const disabledSignals = new Set(rules.disabledSignals);
  const allowedSpans = termSpans(prose, rules.allowedTerms ?? []);
  const counts: CheckCounts = {
    pivots: 0, jargon: 0, hardStops: 0, roadSigns: 0,
    contextJargon: 0, softMarkers: 0, leftBranches: 0, denseDe: 0,
  };

  const add = (
    ruleId: string, category: ProseFinding['category'], match: Match,
    message: string, severity: ProseFinding['severity'] = 'warning',
  ) => {
    if (severity === 'warning' && disabledSignals.has(ruleId as typeof SIGNAL_IDS[number])) return;
    const start = match.index;
    const end = start + match.text.length;
    const prefix = text.slice(0, start);
    const exemption = [...exemptions, ...allowedSpans].find((span) => start >= span.start && end <= span.end);
    const finding: ProseFinding = {
      ruleId, category, severity, start, end,
      line: lineNumber(text, start), column: start - prefix.lastIndexOf('\n'),
      text: text.slice(start, end), message,
      ...(exemption ? { exemption } : {}),
    };
    // 同一明确句式不再重复给出通用提醒；禁词和通用语境提示仍各保留自己的规则 ID。
    if (severity === 'error') {
      const oldIndex = findings.findIndex((old) => old.ruleId === ruleId && old.start === start && old.end === end);
      if (oldIndex >= 0) findings.splice(oldIndex, 1);
    }
    findings.push(finding);
  };

  if (totalHan > 0) {
    for (const match of symbolMatches(maskDefaultColonExemptions(prose), /[:：]/g)) {
      add('punctuation.colon', 'punctuation', match, '检查冒号是否确实引出解释、列举或对话。');
    }
    for (const match of symbolMatches(prose, /——|—|–/g)) {
      add('punctuation.dash', 'punctuation', match, '检查破折号的停顿或补充作用；必要时保留。');
    }
    const stops = nonOverlappingTerms(prose, HARD_STOPS);
    const jargon = nonOverlappingTerms(prose, HARD_JARGON);
    const hardSpans = jargon.map((match) => [match.index, match.index + match.text.length] as const);
    const context = nonOverlappingTerms(prose, CONTEXT_JARGON).filter((match) =>
      !hardSpans.some(([start, end]) => match.index < end && match.index + match.text.length > start));
    counts.hardStops = stops.length;
    counts.jargon = jargon.length;
    counts.contextJargon = context.length;
    for (const match of stops) add('term.hard_stop', 'term', match, '检查是否只是重复宣布接下来要说的内容；有实际作用时保留。');
    for (const match of jargon) add('term.jargon', 'term', match, '检查本义和语境；必要术语可保留，空泛表达应具体化。');
    for (const match of context) add('term.context_jargon', 'term', match, '结合语境判断，本义准确时保留。');
    for (const id of AUTHOR_PATTERN_IDS) {
      const matches = patternMatches(prose, id);
      if (id === 'phrase.road_sign') counts.roadSigns = matches.length;
      else counts.pivots += matches.length;
      for (const match of matches) add(id, 'pattern', match, '检查句式是否表达真实关系，避免只靠转折或路标制造强调。');
    }

    const markers = nonOverlappingTerms(prose, SOFT_MARKERS);
    counts.softMarkers = markers.length;
    if (markers.length > Math.max(2, Math.floor(totalHan / 900))) {
      for (const match of markers) add('signal.soft_markers', 'structure', match, '洞察路标较密集，检查这些提醒是否重复或夸大。');
    }
    const branches = allMatches(prose, LEFT_BRANCH_PATTERNS).map(stripLeadingPunctuation);
    counts.leftBranches = branches.length;
    if (branches.length > Math.max(2, Math.floor(totalHan / 1200))) {
      for (const match of branches) add('signal.left_branch', 'structure', match, '长前置成分较多，检查主语和动作是否出现太晚。');
    }
    const denseDe = heavyDeSentences(prose);
    counts.denseDe = denseDe.length;
    if (denseDe.length > Math.max(1, Math.floor(totalHan / 1500))) {
      for (const match of denseDe) add('signal.dense_de', 'structure', match, '长句中定语较密集，检查能否更早交代人和动作。');
    }
    const paragraphs = proseParagraphs(prose);
    const paragraphMatch = (paragraph: Paragraph): Match => ({ index: paragraph.position, text: paragraph.sourceText });
    if (paragraphs.length >= 10 && paragraphs.filter((paragraph) => paragraph.sentences <= 1).length / paragraphs.length >= 0.75) {
      add('signal.short_paragraph_ratio', 'structure', paragraphMatch(paragraphs[0]!), '单句段比例较高；检查节奏是否机械，不按比例强制合并。');
    }
    const streak = shortStreak(paragraphs);
    if (streak) add('signal.short_streak', 'structure', paragraphMatch(streak[0]!), '连续短促单句段，检查是否重复喊结论；必要步骤可保留。');
    const { counts: openers, examples } = openerCounts(paragraphs);
    for (const [opener, count] of openers) {
      if (count >= 4) add('signal.repeated_opener', 'structure', { index: examples.get(opener)!, text: opener }, `段落开场“${opener}”重复 ${count} 次，检查是否需要变化。`);
    }
    const metaphors = metaphorCluster(prose);
    if (metaphors) add('signal.metaphor_cluster', 'structure', {
      index: metaphors.start, text: prose.slice(metaphors.start, metaphors.end),
    }, `邻近文本出现 ${metaphors.fields.length} 套借喻，检查是否妨碍理解。`);

    for (const match of nonOverlappingTerms(prose, rules.forbiddenTerms ?? [])) {
      add('author.term', 'term', match, '违反作者明确禁词；有保留理由时使用完整术语或单次例外。', 'error');
    }
    for (const id of rules.forbiddenPatterns ?? []) {
      for (const match of patternMatches(prose, id)) add(id, 'pattern', match, '违反作者明确句式禁令。', 'error');
    }
    for (const match of nonOverlappingTerms(prose, rules.forbiddenPunctuation ?? [])) {
      add('author.punctuation', 'punctuation', match, '违反作者明确标点禁令。', 'error');
    }
  }

  findings.sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId));
  const diagnostic = (finding: ProseFinding) => `${finding.ruleId}，第 ${finding.line} 行第 ${finding.column} 列，“${excerpt(finding.text)}”：${finding.message}`;
  const active = findings.filter((finding) => !finding.exemption);
  return {
    scanned: totalHan > 0, totalHan, counts, findings,
    failures: active.filter((finding) => finding.severity === 'error').map(diagnostic),
    warnings: [
      ...(options.strict ? ['--strict 已弃用，通用提示不会升级为错误；请传入明确作者规则。'] : []),
      ...active.filter((finding) => finding.severity === 'warning').map(diagnostic),
    ],
  };
}

export function formatCheckResult(result: CheckResult): string {
  if (!result.scanned) return '没有可检查的中文正文，scanned: false。';
  const lines = [
    `汉字数 ${result.totalHan}`,
    `转折句式 ${result.counts.pivots}，语境词 ${result.counts.jargon}，开场提示 ${result.counts.hardStops}，段落路标 ${result.counts.roadSigns}，需辨语境词 ${result.counts.contextJargon}，洞察路标 ${result.counts.softMarkers}，长前置成分 ${result.counts.leftBranches}，重定语句 ${result.counts.denseDe}`,
  ];
  if (result.failures.length) lines.push('', '作者明确规则未通过', ...result.failures.map((item) => `- ${item}`));
  if (result.warnings.length) lines.push('', '需要人工判断', ...result.warnings.map((item) => `- ${item}`));
  const exempted = result.findings.filter((finding) => finding.exemption).length;
  if (exempted) lines.push('', `已记录 ${exempted} 条明确例外，未计入失败和提示。`);
  if (!result.failures.length && !result.warnings.length) lines.push('', '未发现这份检查器覆盖的问题；此结果不证明事实真实性。');
  return lines.join('\n');
}

function readText(filePath: string): string {
  return filePath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(filePath, 'utf8');
}

export interface ProseCliOptions {
  filePath: string;
  rulesPath?: string;
  exemptionsPath?: string;
  json: boolean;
  strict: boolean;
}

export function parseCliArgs(args: string[]): ProseCliOptions {
  const result: ProseCliOptions = { filePath: '', json: false, strict: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--json' || argument === '--strict') {
      const key = argument === '--json' ? 'json' : 'strict';
      if (result[key]) throw new Error(`重复参数：${argument}。`);
      result[key] = true;
    } else if (argument === '--rules' || argument === '--exemptions') {
      const next = args[++index];
      if (!next || next.startsWith('--') || next === '-') throw new Error(`${argument} 缺少 JSON 文件路径。`);
      const key = argument === '--rules' ? 'rulesPath' : 'exemptionsPath';
      if (result[key]) throw new Error(`重复参数：${argument}。`);
      result[key] = next;
    } else if (argument.startsWith('-') && argument !== '-') {
      throw new Error(`未知参数：${argument}。`);
    } else {
      if (result.filePath) throw new Error('只能提供一个稿件路径。');
      result.filePath = argument;
    }
  }
  if (!result.filePath) throw new Error('缺少稿件路径。');
  return result;
}

const HELP = '用法: bun check-prose.ts <稿件.md|-> [--rules <json文件>] [--exemptions <json文件>] [--json]\n通用扫描只提示；退出码 0 无作者规则错误，1 作者规则错误，2 参数或读写错误。';

export function runCli(args = process.argv.slice(2)): number {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(HELP);
    return 0;
  }
  try {
    const options = parseCliArgs(args);
    const text = readText(options.filePath);
    const readJson = (filePath: string): unknown => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    const result = checkProse(text, {
      strict: options.strict,
      ...(options.rulesPath ? { rules: validateAuthorRules(readJson(options.rulesPath)) } : {}),
      ...(options.exemptionsPath ? { exemptions: validateExemptions(readJson(options.exemptionsPath), text) } : {}),
    });
    if (options.strict) console.error('--strict 已弃用，不再升级通用提示。');
    console.log(options.json ? JSON.stringify(result, null, 2) : formatCheckResult(result));
    return result.failures.length ? 1 : 0;
  } catch (error) {
    console.error(`检查失败：${error instanceof Error ? error.message : String(error)}\n${HELP}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = runCli();
