import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
test('固定16个案例及其保护项与输入存在', () => {
  const root = path.resolve(import.meta.dir, '../evals/skill-review'); const cases = JSON.parse(fs.readFileSync(path.join(root, 'cases.json'), 'utf8'));
  expect(cases.map((x: any) => x.id)).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(2, '0')));
  for (const item of cases) { expect(item.must.length).toBeGreaterThan(0); expect(item.mustNot.length).toBeGreaterThan(0); const inputs = item.fixturePaths.map((p: string) => fs.readFileSync(path.join(root, p), 'utf8')).join('\n'); for (const protectedText of item.protectedStrings) expect(inputs).toContain(protectedText); expect(['text', 'mock']).toContain(item.execution); }
});
