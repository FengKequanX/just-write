import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { render, commitGeneratedOutput, CarouselLimitError } from '../plugins/just-write/skills/post-to-xhs/scripts/md-to-xhs';
import { createWechatPreview } from '../plugins/just-write/skills/baoyu-post-to-wechat/scripts/wechat-preview';
const root = path.resolve(import.meta.dir, '..');
const fixtures = path.join(root, 'tests/fixtures/reading-review');
const out = path.resolve(root, '.tmp-xhs-preview/skill-review/v160/visual');
const hash = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.mkdirSync(out, { recursive: true });
const summary: unknown[] = [];
for (const name of ['short-title', 'mixed-structure', 'long-images', 'boundary-18', 'boundary-over-18']) {
  const source = path.join(fixtures, name + '.md'); const before = hash(source); const target = path.join(out, name); const staging = target + '.staging';
  fs.mkdirSync(target, { recursive: true });
  const oldPage = path.join(target, '01-cover.png');
  if (name === 'boundary-over-18') fs.writeFileSync(oldPage, '应保留的旧产物');
  try {
    const result = await render(source, staging, 'default', '3:4', '测试作者', '');
    if (name === 'boundary-over-18') throw new Error('超限场景应拒绝输出');
    const report = JSON.parse(fs.readFileSync(result.reportPath!, 'utf8'));
    if (!report.textPreserved || !report.imageOrderPreserved || report.pages.some((p: any) => !p.layoutChecked) || result.totalPages > 18) throw new Error('视觉样稿完整性或几何检查失败：' + name);
    if (name === 'boundary-18' && result.totalPages !== 18) throw new Error('边界样稿必须恰好18张，实际：' + result.totalPages);
    const committed = commitGeneratedOutput(result, staging, target);
    if (!name.startsWith('boundary')) await createWechatPreview(source, path.join(target, 'wechat-preview.html'));
    summary.push({ name, pages: result.totalPages, preview: committed.previewPath, geometry: 'pass', visual: 'pending' });
  } catch (error) {
    if (name !== 'boundary-over-18' || !(error instanceof CarouselLimitError)) throw error;
    if (fs.readFileSync(oldPage, 'utf8') !== '应保留的旧产物') throw new Error('超限覆盖了旧产物');
    summary.push({ name, rejected: true, neededImages: error.neededImages, previousOutputPreserved: true });
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
  if (hash(source) !== before) throw new Error('原稿被修改：' + name);
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
