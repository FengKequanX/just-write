import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSauArgs,
  parseArgs,
  parseCaption,
  readImages,
  validateDouyinPayload,
  executeDouyin,
} from './douyin-note';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-note-test-'));
  roots.push(root);
  return root;
}

describe('Douyin payload', () => {
  test('parses the independent caption and removes tags and advice from body', () => {
    const root = tempRoot();
    const caption = path.join(root, 'douyin-caption.md');
    fs.writeFileSync(caption, '独立标题\n\n正文第一行\n正文第二行\n\n#AI #OpenAI\n\n— 发布建议：确认音乐');
    expect(parseCaption(caption)).toEqual({
      title: '独立标题',
      note: '正文第一行\n正文第二行',
      tags: ['AI', 'OpenAI'],
      publishingAdvice: '确认音乐',
      warnings: ['旧发布建议末行已分离；请迁移至 frontmatter.publishingAdvice'],
    });
  });

  test('只分离明确建议和纯话题行，保留普通破折号正文', () => {
    const root = tempRoot();
    const file = path.join(root, 'caption.md');
    fs.writeFileSync(file, '---\npublishingAdvice: "确认 #音乐"\n---\n标题\n\n正文中的 #标记 保留。\n#主题\n\n— 这句是正文。');
    expect(parseCaption(file)).toEqual({ title: '标题', note: '正文中的 #标记 保留。\n\n— 这句是正文。', tags: ['主题'], publishingAdvice: '确认 #音乐' });
  });

  test('默认校验零调用；显式交接与上传分别报告结果并清理临时文件', async () => {
    const article = tempRoot();
    const xhs = path.join(article, 'xhs');
    fs.mkdirSync(xhs); fs.mkdirSync(path.join(article, 'douyin'));
    fs.writeFileSync(path.join(xhs, '01-cover.png'), 'png');
    fs.writeFileSync(path.join(article, 'douyin', 'douyin-caption.md'), '---\npublishingAdvice: 建议不能上传\n---\n标题\n\n正文\n\n#AI');
    const calls: string[][] = [];
    const noteFiles: string[] = [];
    const deps = {
      loadConfig: () => ({ config: { enabled: false, default_account: '' }, source: 'test' }),
      run: async (_command: string, args: string[]) => {
        calls.push(args); const note = args[args.indexOf('--notef') + 1]!; noteFiles.push(note);
        expect(fs.readFileSync(note, 'utf8')).toBe('正文');
        return { code: 0 };
      },
    };
    expect((await executeDouyin(parseArgs([xhs]), deps)).status).toBe('dry_run');
    expect(calls).toHaveLength(0);
    expect((await executeDouyin(parseArgs([xhs, '--draft', '--account', 'a']), deps)).status).toBe('manual_handoff');
    expect(calls[0]).toContain('--headed');
    expect((await executeDouyin(parseArgs([xhs, '--publish', '--account', 'a']), deps)).status).toBe('outcome_unknown');
    expect(calls).toHaveLength(2);
    for (const file of noteFiles) expect(fs.existsSync(file)).toBe(false);
    const failed = await executeDouyin(parseArgs([xhs, '--publish', '--account', 'a']), { ...deps, run: async () => ({ code: 1 }) });
    expect(failed.status).toBe('outcome_unknown');
    let interruptedNote = '';
    const interrupted = await executeDouyin(parseArgs([xhs, '--publish', '--account', 'a']), { ...deps, run: async (_command, args) => {
      interruptedNote = args[args.indexOf('--notef') + 1]!;
      throw new Error('模拟连接中断');
    } });
    expect(interrupted.status).toBe('outcome_unknown'); expect(fs.existsSync(interruptedNote)).toBe(false);
    await expect(executeDouyin(parseArgs([xhs, '--publish', '--account', 'a']), { ...deps, run: async () => { throw Object.assign(new Error('上传器未安装'), { code: 'ENOENT' }); } })).rejects.toThrow('未安装');
  });

  test('参数互斥、未知参数与缺值拒绝执行', () => {
    expect(parseArgs(['xhs']).dryRun).toBe(true);
    expect(() => parseArgs(['xhs', '--draft', '--publish'])).toThrow('互斥');
    expect(() => parseArgs(['xhs', '--dry-run', '--publish'])).toThrow('互斥');
    expect(() => parseArgs(['xhs', '--account', '--publish'])).toThrow('缺少值');
    expect(() => parseArgs(['xhs', '--ignored', 'x'])).toThrow('未知参数');
  });

  test('sorts only managed numbered PNG files', () => {
    const root = tempRoot();
    for (const name of ['10-ending.png', '02-content.png', '01-cover.png', 'preview.png']) {
      fs.writeFileSync(path.join(root, name), 'x');
    }
    expect(readImages(root).map((file) => path.basename(file))).toEqual([
      '01-cover.png', '02-content.png', '10-ending.png',
    ]);
  });

  test('validates platform limits and preserves argument boundaries', () => {
    expect(() => validateDouyinPayload({ title: 'x'.repeat(21), note: '', tags: [] })).toThrow('标题超出');
    expect(() => validateDouyinPayload({ title: '标题', note: '', tags: ['two words'] })).toThrow('不能包含空格');
    const options = parseArgs(['xhs', '--account', 'creator', '--dry-run']);
    const args = buildSauArgs(options, ['C:/含 空格/01.png'], {
      title: '标题 & 安全', note: '正文', tags: ['AI'],
    }, 'C:/temp/note.txt');
    expect(args).toContain('标题 & 安全');
    expect(args).toContain('C:/含 空格/01.png');
  });

  test('dry-run cleans its temporary note file', () => {
    const article = tempRoot();
    const xhs = path.join(article, 'xhs');
    const douyin = path.join(article, 'douyin');
    fs.mkdirSync(xhs);
    fs.mkdirSync(douyin);
    fs.writeFileSync(path.join(xhs, '01-cover.png'), 'png');
    fs.writeFileSync(path.join(douyin, 'douyin-caption.md'), '标题\n\n正文\n\n#AI');
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('douyin-note-')));
    const result = Bun.spawnSync({
      cmd: [process.execPath, path.join(import.meta.dir, 'douyin-note.ts'), xhs, '--account', 'creator', '--dry-run'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('douyin-note-') && !before.has(name));
    expect(after).toEqual([]);
  });
});
