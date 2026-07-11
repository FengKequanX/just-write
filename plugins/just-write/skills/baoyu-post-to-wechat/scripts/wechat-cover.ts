import fs from 'node:fs';
import path from 'node:path';

export function resolveWechatCoverPath(explicitCover: string | undefined, articleDir: string): string | undefined {
  if (explicitCover) return explicitCover;
  const conventionalCover = path.join(articleDir, 'imgs', 'cover.png');
  return fs.existsSync(conventionalCover) ? conventionalCover : undefined;
}
