import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dir, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '');
const json = (p: string) => JSON.parse(read(p));
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function files(dir: string): string[] { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(x => x.name === 'node_modules' ? [] : x.isDirectory() ? files(path.join(dir, x.name)) : [path.join(dir, x.name)]); }
const claude = json('plugins/just-write/.claude-plugin/plugin.json'); const codex = json('plugins/just-write/.codex-plugin/plugin.json'); const market = json('.claude-plugin/marketplace.json');
assert(/^\d+\.\d+\.\d+$/.test(claude.version), '插件版本格式无效'); assert(codex.version === claude.version && market.plugins[0].version === claude.version, '插件版本不一致');
const names = ['just-write', 'brainstorming', 'writing-style', 'humanizer-zh', 'baoyu-format-markdown', 'baoyu-post-to-wechat', 'post-to-xhs', 'sync-to-douyin'];
const skillsRoot = path.join(root, 'plugins/just-write/skills');
for (const name of names) { const entry = path.join(skillsRoot, name, 'SKILL.md'); assert(fs.existsSync(entry), '缺少技能：' + name); const text = fs.readFileSync(entry, 'utf8'); assert(new RegExp('^name: ' + name + '$', 'm').test(text) && /^description: .+/m.test(text), '技能标识或说明缺失：' + name); }
let links = 0;
for (const file of [...files(skillsRoot).filter(x => x.endsWith('.md')), path.join(root, 'README.md')]) {
  const content = fs.readFileSync(file, 'utf8');
  for (const m of content.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)) {
    const href = m[1] || m[2]!; if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href) || /[{}<>]/.test(href)) continue;
    const target = path.resolve(path.dirname(file), decodeURIComponent(href.split('#')[0]!));
    assert(fs.existsSync(target), '本地引用不存在：' + path.relative(root, file) + ' → ' + href); links++;
  }
}
for (const p of ['lib/platform-result.ts', 'lib/reading-format.ts', 'THIRD_PARTY_NOTICES.md']) assert(fs.existsSync(path.join(root, 'plugins/just-write', p)), '缺少共用资源：' + p);
for (const item of json('upstream-sources.json')) assert(typeof item.skill === 'string' && typeof item.repo === 'string' && (item.reviewedRevision === null || /^[a-f\d]{40}$/i.test(item.reviewedRevision)), '上游来源清单无效');
// 帮助入口可离线调用；这里只验证公开参数，默认动作由行为测试验收。
const cliContracts: Array<[string, string[]]> = [
  ['humanizer-zh/scripts/check-prose.ts', ['--rules', '--exemptions', '--json']],
  ['just-write/scripts/workflow-state.ts', ['--mode', '--draft', '--formatted', '--for', '--origin', '--input', '--replace-locked', '--lock', '--result-file']],
  ['baoyu-format-markdown/scripts/main.ts', ['--no-quotes', '--no-spacing']],
  ['baoyu-post-to-wechat/scripts/wechat-api.ts', ['--save-draft', '--dry-run', '--account', '--json']],
  ['baoyu-post-to-wechat/scripts/wechat-article.ts', ['--save-draft', '--submit', '--account', '--json']],
  ['post-to-xhs/scripts/md-to-xhs.ts', ['--caption-body-file', '--json', '--theme', '--aspect']],
  ['sync-to-douyin/scripts/douyin-note.ts', ['--draft', '--publish', '--dry-run', '--account', '--json']],
];
for (const [file, flags] of cliContracts) {
  const result = spawnSync(process.execPath, [path.join(skillsRoot, file), '--help'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert(result.status === 0, 'CLI 帮助不可用：' + file + '：' + (result.error?.message || result.stderr));
  for (const flag of flags) assert(result.stdout.includes(flag), 'CLI 参数契约缺失：' + file + ' → ' + flag);
}
console.log('结构契约通过：' + names.length + ' 个技能、' + links + ' 个本地引用、' + cliContracts.length + ' 个 CLI 参数契约。行为由测试验收。');
