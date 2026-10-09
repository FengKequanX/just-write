import fs from 'node:fs';

export interface BrowserCliArgs {
  title?: string; content?: string; htmlFile?: string; markdownFile?: string; imagesDir?: string;
  theme?: string; color?: string; author?: string; summary?: string; profileDir?: string; accountAlias?: string;
  cdpPort?: number; images: string[]; submit: boolean; citeStatus: boolean; json: boolean;
}
export function parseBrowserArgs(args: string[], kind: 'article' | 'image'): BrowserCliArgs {
  const options: BrowserCliArgs = { images: [], submit: false, citeStatus: true, json: false };
  const values: Record<string, keyof BrowserCliArgs> = {
    '--title': 'title', '--content': 'content', '--markdown': 'markdownFile', '--image': 'images',
    '--profile': 'profileDir', '--account': 'accountAlias',
    ...(kind === 'article' ? { '--html': 'htmlFile', '--theme': 'theme', '--color': 'color', '--author': 'author', '--summary': 'summary', '--cdp-port': 'cdpPort' } : { '--images': 'imagesDir' }),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--submit' || arg === '--save-draft') options.submit = true;
    else if (arg === '--json') options.json = true;
    else if (kind === 'article' && (arg === '--cite' || arg === '--no-cite')) options.citeStatus = arg === '--cite';
    else if (values[arg]) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`参数缺少值：${arg}`);
      const key = values[arg]!;
      if (key === 'images') options.images.push(value);
      else if (key === 'cdpPort') {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CDP 端口无效');
        options.cdpPort = port;
      } else (options as unknown as Record<string, string>)[key] = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

export function readWechatMetadata(file?: string): Record<string, string> {
  if (!file || !/\.md$/i.test(file) || !fs.existsSync(file)) return {};
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const metadata: Record<string, string> = {};
  for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
    const item = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (item) metadata[item[1]!] = item[2]!.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
  }
  const body = match ? source.slice(match[0].length) : source;
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) metadata.h1 = h1;
  return metadata;
}

export function ensureTitleAgreement(metadata: Record<string, string>, explicitTitle?: string): void {
  if (explicitTitle === undefined && metadata.title && metadata.h1 && metadata.title !== metadata.h1) throw new Error('frontmatter 与 H1 标题冲突，请明确平台标题');
}
