import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const json = (relative: string) => JSON.parse(read(relative)) as Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const claude = json('plugins/just-write/.claude-plugin/plugin.json');
const codex = json('plugins/just-write/.codex-plugin/plugin.json');
const marketplace = json('.claude-plugin/marketplace.json') as { plugins?: Array<{ version?: string }> };
assert(claude.version === '1.3.0', 'Claude plugin version must be 1.3.0');
assert(codex.version === '1.3.0', 'Codex plugin version must be 1.3.0');
assert(marketplace.plugins?.[0]?.version === '1.3.0', 'Marketplace version must match plugin version');

const mainSkill = read('plugins/just-write/skills/just-write/SKILL.md');
for (const mode of ['full', 'polish', 'format', 'wechat_publish', 'xhs_materials', 'douyin_sync']) {
  assert(mainSkill.includes(`\`${mode}\``), `Main skill is missing mode ${mode}`);
}
for (const skill of ['brainstorming', 'humanizer-zh', 'baoyu-format-markdown', 'baoyu-post-to-wechat', 'post-to-xhs', 'sync-to-douyin']) {
  assert(fs.existsSync(path.join(root, 'plugins', 'just-write', 'skills', skill, 'SKILL.md')), `Missing companion skill ${skill}`);
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

console.log('Plugin contracts OK');
