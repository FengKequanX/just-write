import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
export interface UpstreamSource { skill: string; repo: string; subtree: string; reviewedRevision: string | null; localNotes: string; license: string }
function run(command: string, args: string[], ok = [0]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || !ok.includes(result.status ?? -1)) throw new Error(result.error?.message || result.stderr || '命令失败：' + command);
  return result.stdout;
}
/** 只写差异报告；从不复制上游内容到技能目录。 */
export function checkUpstream(source: UpstreamSource, root: string, out: string, ref?: string): { skill: string; revision: string; changed: boolean } {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-upstream-'));
  try {
    const resolved = ref || run('git', ['ls-remote', source.repo, 'HEAD']).split(/\s+/)[0];
    if (!resolved || !/^[a-f\d]{40}$/i.test(resolved)) throw new Error('需要完整的上游 revision');
    run('git', ['-C', temp, 'init', '--quiet']); run('git', ['-C', temp, 'remote', 'add', 'origin', source.repo]); run('git', ['-C', temp, 'fetch', '--quiet', '--depth', '1', 'origin', resolved]);
    const revision = run('git', ['-C', temp, 'rev-parse', 'FETCH_HEAD']).trim(); if (revision !== resolved) throw new Error('上游 revision 不匹配');
    const archive = path.join(temp, 'snapshot.tar'); const incoming = path.join(temp, 'incoming'); fs.mkdirSync(incoming);
    run('git', ['-C', temp, 'archive', '--format=tar', '--output=' + archive, revision]); run('tar', ['-xf', archive, '-C', incoming]);
    const remotePath = path.join(incoming, source.subtree); if (!fs.existsSync(remotePath)) throw new Error('上游子目录不存在');
    const local = path.join(root, 'plugins/just-write/skills', source.skill);
    const reportRelative = path.relative(path.resolve(local), path.resolve(out));
    if (!reportRelative.startsWith('..') && !path.isAbsolute(reportRelative)) throw new Error('报告不能写入技能目录');
    const stagedLocal = path.join(temp, 'local');
    fs.cpSync(local, stagedLocal, { recursive: true, filter: p => !['node_modules', '.git', '.env', '.baoyu-skills'].includes(path.basename(p)) });
    const diff = run('git', ['diff', '--no-index', '--no-color', '--', stagedLocal, remotePath], [0, 1]);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, source.skill + '.patch'), diff);
    fs.writeFileSync(path.join(out, source.skill + '.json'), JSON.stringify({ ...source, revision, changed: Boolean(diff), historicalRevisionKnown: source.reviewedRevision !== null, mode: 'check_only' }, null, 2) + '\n');
    return { skill: source.skill, revision, changed: Boolean(diff) };
  } finally {
    // 只移除由 mkdtemp 创建的本次临时目录，不清理差异输出或技能目录。
    if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('jw-upstream-')) throw new Error('临时目录校验失败');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  try {
    const root = path.resolve(import.meta.dir, '..'); let skill: string | undefined; let ref: string | undefined; let out = path.join(root, '.tmp-xhs-preview/upstream');
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) { const arg = args[i]!; if (arg === '--check') continue; if (arg === '--help') { console.log('用法：bash update.sh [--check] [--skill 名称] [--ref 完整SHA] [--out 差异目录]'); process.exit(0); } const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('参数缺值：' + arg); if (arg === '--skill') skill = value; else if (arg === '--ref') ref = value; else if (arg === '--out') out = path.resolve(value); else throw new Error('未知参数：' + arg); }
    const all = JSON.parse(fs.readFileSync(path.join(root, 'upstream-sources.json'), 'utf8')) as UpstreamSource[]; const selected = skill ? all.filter(x => x.skill === skill) : all;
    if (!selected.length || ref && selected.length !== 1) throw new Error('--ref 必须配合唯一 --skill');
    for (const source of selected) console.log(JSON.stringify(checkUpstream(source, root, out, ref)));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
