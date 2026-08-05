import fs from 'node:fs';
import path from 'node:path';

// Adapted from KKKKhazix/human-writing (MIT) for workflow timing contracts.

const root = path.resolve(import.meta.dir, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative: string) => JSON.parse(read(relative)) as Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const claude = json('plugins/just-write/.claude-plugin/plugin.json');
const codex = json('plugins/just-write/.codex-plugin/plugin.json');
const marketplace = json('.claude-plugin/marketplace.json') as { plugins?: Array<{ version?: string }> };
assert(claude.version === '1.4.0', 'Claude plugin version must be 1.4.0');
assert(codex.version === '1.4.0', 'Codex plugin version must be 1.4.0');
assert(marketplace.plugins?.[0]?.version === '1.4.0', 'Marketplace version must match plugin version');

const mainSkill = read('plugins/just-write/skills/just-write/SKILL.md');
const writingStyle = read('plugins/just-write/skills/writing-style/SKILL.md');
const humanizer = read('plugins/just-write/skills/humanizer-zh/SKILL.md');
const qualityCheck = read('plugins/just-write/skills/writing-style/references/quality-check.md');
for (const mode of ['full', 'polish', 'format', 'wechat_publish', 'xhs_materials', 'douyin_sync']) {
  assert(mainSkill.includes(`\`${mode}\``), `Main skill is missing mode ${mode}`);
}
for (const skill of ['brainstorming', 'humanizer-zh', 'writing-style', 'baoyu-format-markdown', 'baoyu-post-to-wechat', 'post-to-xhs', 'sync-to-douyin']) {
  assert(fs.existsSync(path.join(root, 'plugins', 'just-write', 'skills', skill, 'SKILL.md')), `Missing companion skill ${skill}`);
}
for (const reference of ['article-archetypes.md', 'chinese-prose.md', 'quality-check.md', 'style-profile-template.md']) {
  assert(fs.existsSync(path.join(root, 'plugins', 'just-write', 'skills', 'writing-style', 'references', reference)), `Missing writing-style reference ${reference}`);
}

const combinedDocs = [mainSkill, read('plugins/just-write/skills/post-to-xhs/SKILL.md'), read('plugins/just-write/skills/sync-to-douyin/SKILL.md'), read('README.md')].join('\n');
assert(combinedDocs.includes('douyin/douyin-caption.md'), 'Docs must use the independent Douyin caption');
assert(combinedDocs.includes('<article-dir>/xhs'), 'Docs must use the managed xhs directory');
assert(!read('README.md').includes('default_aspect_ratio:'), 'README contains removed XHS configuration');
assert(!read('README.md').includes('[文章标题]-xhs'), 'README contains the removed XHS output layout');
assert(!read('plugins/just-write/skills/post-to-xhs/scripts/md-to-xhs.ts').includes('关注炙青'), 'XHS ending contains a hard-coded author');
const xhsRenderer = read('plugins/just-write/skills/post-to-xhs/scripts/md-to-xhs.ts');
const wechatCover = read('plugins/just-write/skills/baoyu-post-to-wechat/scripts/wechat-cover.ts');
assert(xhsRenderer.includes("path.join('imgs', 'cover-xhs.png')"), 'XHS conventional cover must be imgs/cover-xhs.png');
assert(wechatCover.includes("path.join(articleDir, 'imgs', 'cover.png')"), 'WeChat conventional cover must be imgs/cover.png');
assert(!wechatCover.includes('cover-xhs.png'), 'WeChat cover resolver must not use the XHS cover');
assert(mainSkill.includes('follow `references/quality-check.md` in its seven-pass order'), 'Full workflow must use the seven-pass revision order');
assert(mainSkill.includes('load `humanizer-zh` in pass five'), 'Humanizer must load only after the first draft');
assert(writingStyle.includes('at least five concrete materials'), 'Long nonfiction must require five concrete materials');
assert(writingStyle.includes('do not output a long-form body or title'), 'The material gate must block an under-sourced long draft');
assert(writingStyle.includes('ask at most three questions'), 'The material gate must cap follow-up questions at three');
assert(writingStyle.includes('short piece of about 600 Chinese characters'), 'The material gate must provide the short-draft fallback');
assert(qualityCheck.includes('## Seven revision passes'), 'Quality checks must begin with the seven-pass revision');
assert(fs.existsSync(path.join(root, 'plugins/just-write/skills/humanizer-zh/scripts/check-prose.ts')), 'Missing deterministic prose checker');
assert(fs.existsSync(path.join(root, 'plugins/just-write/THIRD_PARTY_NOTICES.md')), 'Missing human-writing MIT notice');
assert(!humanizer.includes('凌晨三点'), 'Humanizer must not encourage fabricated atmosphere details');

console.log('Plugin contracts OK');
