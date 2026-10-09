import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test, { type TestContext } from "node:test";

import { loadCredentials, resolveAccount } from "./wechat-extend-config.ts";

function useCwd(t: TestContext, cwd: string): void {
  const previous = process.cwd();
  process.chdir(cwd);
  t.after(() => {
    process.chdir(previous);
  });
}

function useHome(t: TestContext, home: string): void {
  const previous = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.HOME;
      return;
    }
    process.env.HOME = previous;
  });
}

function useWechatEnv(
  t: TestContext,
  values: Partial<Record<"WECHAT_APP_ID" | "WECHAT_APP_SECRET", string | undefined>>,
): void {
  const previous = {
    WECHAT_APP_ID: process.env.WECHAT_APP_ID,
    WECHAT_APP_SECRET: process.env.WECHAT_APP_SECRET,
  };

  if (values.WECHAT_APP_ID === undefined) {
    delete process.env.WECHAT_APP_ID;
  } else {
    process.env.WECHAT_APP_ID = values.WECHAT_APP_ID;
  }

  if (values.WECHAT_APP_SECRET === undefined) {
    delete process.env.WECHAT_APP_SECRET;
  } else {
    process.env.WECHAT_APP_SECRET = values.WECHAT_APP_SECRET;
  }

  t.after(() => {
    if (previous.WECHAT_APP_ID === undefined) {
      delete process.env.WECHAT_APP_ID;
    } else {
      process.env.WECHAT_APP_ID = previous.WECHAT_APP_ID;
    }

    if (previous.WECHAT_APP_SECRET === undefined) {
      delete process.env.WECHAT_APP_SECRET;
    } else {
      process.env.WECHAT_APP_SECRET = previous.WECHAT_APP_SECRET;
    }
  });
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeEnvFile(root: string, content: string): Promise<void> {
  const envPath = path.join(root, ".baoyu-skills", ".env");
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, content);
}

test("loadCredentials selects the first complete source without mixing values across sources", async (t) => {
  const cwdRoot = await makeTempDir("wechat-creds-cwd-");
  const homeRoot = await makeTempDir("wechat-creds-home-");

  useCwd(t, cwdRoot);
  useHome(t, homeRoot);
  useWechatEnv(t, {
    WECHAT_APP_ID: undefined,
    WECHAT_APP_SECRET: "stale-secret-from-process-env",
  });

  await writeEnvFile(cwdRoot, "WECHAT_APP_ID=cwd-app-id\nWECHAT_APP_SECRET=cwd-app-secret\n");
  await writeEnvFile(homeRoot, "WECHAT_APP_ID=home-app-id\nWECHAT_APP_SECRET=home-app-secret\n");

  const credentials = loadCredentials();

  assert.equal(credentials.appId, "cwd-app-id");
  assert.equal(credentials.appSecret, "cwd-app-secret");
  assert.equal(credentials.source, "<cwd>/.baoyu-skills/.env");
  assert.deepEqual(credentials.skippedSources, [
    "process.env missing WECHAT_APP_ID",
  ]);
});

test('账号选择拒绝未知、重复、多个默认和未明确目标', () => {
  assert.throws(() => resolveAccount({}, 'missing'), /未知微信账号/);
  assert.throws(() => resolveAccount({ accounts: [{ name: '甲', alias: 'a' }, { name: '乙', alias: 'a' }] }), /重复/);
  assert.throws(() => resolveAccount({ accounts: [{ name: '甲', alias: 'a', default: true }, { name: '乙', alias: 'b', default: true }] }), /多个默认/);
  const config = { default_theme: 'default', accounts: [{ name: '甲', alias: 'a', default_theme: 'grace' }, { name: '乙', alias: 'b' }] };
  assert.throws(() => resolveAccount(config), /明确选择/);
  assert.equal(resolveAccount(config, undefined, { offline: true }).source, 'offline_unselected');
  assert.equal(resolveAccount(config, 'a').default_theme, 'grace');
  assert.equal(resolveAccount({ ...config, chrome_profile_path: 'global-profile' }, 'a').chrome_profile_path, undefined);
  assert.equal(resolveAccount({}).source, 'legacy_single_account');
});

test('已选账号缺凭证时不会回退全局完整凭证', async (t) => {
  const cwdRoot = await makeTempDir('wechat-alias-cwd-');
  useCwd(t, cwdRoot);
  useWechatEnv(t, { WECHAT_APP_ID: 'global-id', WECHAT_APP_SECRET: 'global-secret' });
  assert.throws(() => loadCredentials(resolveAccount({ accounts: [{ name: '甲', alias: 'test_no_fallback' }] })), /Missing WECHAT_APP_ID/);
  const selected = resolveAccount({ accounts: [{ name: '甲', alias: 'test_no_fallback', app_id: 'selected-id', app_secret: 'selected-secret' }] });
  const credentials = loadCredentials(selected);
  assert.equal(credentials.appId, 'selected-id');
  assert.equal(credentials.appSecret, 'selected-secret');
});

test("loadCredentials prefers a complete process.env pair over lower-priority files", async (t) => {
  const cwdRoot = await makeTempDir("wechat-creds-cwd-");
  const homeRoot = await makeTempDir("wechat-creds-home-");

  useCwd(t, cwdRoot);
  useHome(t, homeRoot);
  useWechatEnv(t, {
    WECHAT_APP_ID: "env-app-id",
    WECHAT_APP_SECRET: "env-app-secret",
  });

  await writeEnvFile(cwdRoot, "WECHAT_APP_ID=cwd-app-id\nWECHAT_APP_SECRET=cwd-app-secret\n");
  await writeEnvFile(homeRoot, "WECHAT_APP_ID=home-app-id\nWECHAT_APP_SECRET=home-app-secret\n");

  const credentials = loadCredentials();

  assert.equal(credentials.appId, "env-app-id");
  assert.equal(credentials.appSecret, "env-app-secret");
  assert.equal(credentials.source, "process.env");
  assert.deepEqual(credentials.skippedSources, []);
});

test("loadCredentials reports skipped incomplete sources when no complete pair exists", async (t) => {
  const cwdRoot = await makeTempDir("wechat-creds-cwd-");
  const homeRoot = await makeTempDir("wechat-creds-home-");

  useCwd(t, cwdRoot);
  useHome(t, homeRoot);
  useWechatEnv(t, {
    WECHAT_APP_ID: "env-app-id",
    WECHAT_APP_SECRET: undefined,
  });

  await writeEnvFile(cwdRoot, "WECHAT_APP_SECRET=cwd-app-secret\n");

  assert.throws(
    () => loadCredentials(),
    /Incomplete credential sources skipped:\n- process\.env missing WECHAT_APP_SECRET\n- <cwd>\/\.baoyu-skills\/\.env missing WECHAT_APP_ID/,
  );
});
