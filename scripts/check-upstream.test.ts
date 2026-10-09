import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkUpstream } from './check-upstream';
test('固定revision生成差异而不覆盖本地或复制依赖', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-update-test-'));
  const git = (args: string[]) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  try {
    const repo = path.join(dir, 'upstream'); fs.mkdirSync(repo); git(['-C', repo, 'init', '--quiet']);
    fs.mkdirSync(path.join(repo, 'skills/sample/references'), { recursive: true }); fs.writeFileSync(path.join(repo, 'skills/sample/SKILL.md'), '上游版本'); fs.writeFileSync(path.join(repo, 'skills/sample/references/setup.md'), '上游参考');
    git(['-C', repo, 'add', '.']); git(['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']); const ref = git(['-C', repo, 'rev-parse', 'HEAD']);
    const local = path.join(dir, 'plugins/just-write/skills/sample'); fs.mkdirSync(path.join(local, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(local, 'SKILL.md'), '保留本地修改'); fs.writeFileSync(path.join(local, 'node_modules/private.txt'), '不进入报告');
    const out = path.join(dir, 'report'); const result = checkUpstream({ skill: 'sample', repo, subtree: 'skills/sample', reviewedRevision: null, localNotes: '保留本地', license: '测试许可' }, dir, out, ref);
    expect(result.revision).toBe(ref); expect(result.changed).toBe(true); expect(fs.readFileSync(path.join(local, 'SKILL.md'), 'utf8')).toBe('保留本地修改');
    expect(fs.existsSync(path.join(local, 'references'))).toBe(false); expect(fs.readFileSync(path.join(out, 'sample.patch'), 'utf8')).not.toContain('private.txt');
    expect(JSON.parse(fs.readFileSync(path.join(out, 'sample.json'), 'utf8')).historicalRevisionKnown).toBe(false);
    fs.writeFileSync(path.join(repo, 'skills/sample/SKILL.md'), '新上游版本');
    git(['-C', repo, 'add', '.']); git(['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'next']);
    const nextRef = git(['-C', repo, 'rev-parse', 'HEAD']);
    const latest = checkUpstream({ skill: 'sample', repo, subtree: 'skills/sample', reviewedRevision: ref, localNotes: '保留本地', license: '测试许可' }, dir, out);
    expect(latest.revision).toBe(nextRef);
    expect(fs.readFileSync(path.join(out, 'sample.patch'), 'utf8')).toContain('新上游版本');
    expect(fs.readFileSync(path.join(local, 'SKILL.md'), 'utf8')).toBe('保留本地修改');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
