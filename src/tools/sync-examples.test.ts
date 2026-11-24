import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { EXAMPLES_DIR, GALLERY_PACKS, GENERALS_DIR, listFiles, renderMirrorReport, syncExamples } from "./sync-examples.js";

const repoRoot = process.cwd();

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sgs-examples-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 在临时根下造一个 `generals/<包>/...` 与可选的 gallery 拷贝。 */
const writePack = (filesByPack: Record<string, Record<string, string>>, mirror = false): void => {
  for (const [pack, files] of Object.entries(filesByPack)) {
    for (const [path, content] of Object.entries(files)) {
      for (const base of mirror ? [GENERALS_DIR, EXAMPLES_DIR] : [GENERALS_DIR]) {
        const full = join(root, base, pack, path);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, content);
      }
    }
  }
};

const readExample = (pack: string, path: string): string => readFileSync(join(root, EXAMPLES_DIR, pack, path), "utf-8");

void test("gallery 与 generals/ 逐字节一致（改包只改 generals/，跑 npm run examples:sync 镜像）", () => {
  const report = syncExamples({ root: repoRoot });
  const drifted = report.packs.filter((pack) => !pack.synced);
  if (drifted.length > 0) {
    assert.fail(`examples/generals/ 已与 generals/ 漂移，请运行 npm run examples:sync\n${renderMirrorReport(report, false)}`);
  }
  assert.equal(report.drifted, 0);
});

void test("gallery 的包集合与 GALLERY_PACKS 完全一致（不多不少）", () => {
  const report = syncExamples({ root: repoRoot });
  assert.deepEqual(
    report.packs.map((pack) => pack.pack).sort(),
    [...GALLERY_PACKS].sort(),
    "GALLERY_PACKS 应列出全部参考武将；新增参考武将时同步它",
  );
  // 每个 gallery 包都必须在 generals/ 里真实存在（单一数据源不能缺包）。
  for (const pack of GALLERY_PACKS) {
    const files = listFiles(join(repoRoot, GENERALS_DIR, pack));
    assert.ok(files.includes("general.json"), `${GENERALS_DIR}/${pack} 应有 general.json`);
  }
});

void test("漂移检测：gallery 缺文件 / 内容不同 / 多文件 都会被报出来", () => {
  writePack({ 测试将: { "general.json": "{}", "技.skill.json": "{}" } }, true);
  const clean = syncExamples({ root, packs: ["测试将"] });
  assert.equal(clean.drifted, 0, "刚造好的镜像应是同步的");

  // 改内容 + 删一个 + 加一个。
  writeFileSync(join(root, EXAMPLES_DIR, "测试将", "技.skill.json"), "{\"drifted\":true}");
  rmSync(join(root, EXAMPLES_DIR, "测试将", "general.json"));
  writeFileSync(join(root, EXAMPLES_DIR, "测试将", "多余.md"), "只在 gallery 里");
  const drifted = syncExamples({ root, packs: ["测试将"] });
  assert.equal(drifted.drifted, 1);
  assert.equal(drifted.driftFiles, 3);
  const statuses = Object.fromEntries(drifted.packs[0]?.files.map((file) => [file.path, file.status]) ?? []);
  assert.equal(statuses["技.skill.json"], "changed");
  assert.equal(statuses["general.json"], "missing");
  assert.equal(statuses["多余.md"], "extra");
});

void test("写入模式把 generals/ 逐字节镜像到 gallery，并删掉 gallery 里多出的文件", () => {
  writePack({ 测试将: { "general.json": "{\"name\":\"测试将\"}", "技.skill.json": "{\"id\":\"技\"}" } }, true);
  writeFileSync(join(root, GENERALS_DIR, "测试将", "技.skill.json"), "{\"id\":\"技\",\"改过\":true}");
  writeFileSync(join(root, EXAMPLES_DIR, "测试将", "残留.md"), "旧文件");

  const report = syncExamples({ root, packs: ["测试将"], write: true });
  assert.equal(report.drifted, 1, "同步前应报告漂移");
  assert.equal(syncExamples({ root, packs: ["测试将"] }).drifted, 0, "同步后应完全一致");
  assert.equal(readExample("测试将", "技.skill.json"), "{\"id\":\"技\",\"改过\":true}");
  assert.deepEqual(listFiles(join(root, EXAMPLES_DIR, "测试将")).sort(), ["general.json", "技.skill.json"]);
});

void test("写入模式删掉 gallery 里多出的子目录（镜像不会留下空壳目录）", () => {
  writePack({ 测试将: { "general.json": "{}" } }, true);
  mkdirSync(join(root, EXAMPLES_DIR, "测试将", "旧子目录", "更深"), { recursive: true });
  writeFileSync(join(root, EXAMPLES_DIR, "测试将", "旧子目录", "更深", "x.md"), "旧");
  syncExamples({ root, packs: ["测试将"], write: true });
  assert.deepEqual(listFiles(join(root, EXAMPLES_DIR, "测试将")), ["general.json"]);
  assert.equal(existsSync(join(root, EXAMPLES_DIR, "测试将", "旧子目录")), false, "空壳目录应被清掉");
});

void test("单一数据源缺包时抛错（不允许 gallery 里凭空出现 generals/ 没有的包）", () => {
  writePack({ 测试将: { "general.json": "{}" } }, true);
  assert.throws(() => syncExamples({ root, packs: ["不存在的将"] }), /不存在/);
});

void test("文件列表是稳定排序的 POSIX 相对路径（跨平台报错可读）", () => {
  writePack({ 测试将: { "b.txt": "b", "a.txt": "a", "子目录/c.txt": "c", "子目录/d.txt": "d" } }, true);
  assert.deepEqual(listFiles(join(root, EXAMPLES_DIR, "测试将")), ["a.txt", "b.txt", "子目录/c.txt", "子目录/d.txt"]);
});

void test("渲染：同步时不打印文件明细，漂移时逐条列出", () => {
  assert.match(renderMirrorReport({ source: "generals", target: "examples/generals", packs: [{ pack: "测试将", files: [], synced: true }], drifted: 0, driftFiles: 0 }, false), /逐字节一致/);
  const text = renderMirrorReport(
    {
      source: "generals",
      target: "examples/generals",
      packs: [{ pack: "测试将", files: [{ path: "general.json", status: "changed" }], synced: false }],
      drifted: 1,
      driftFiles: 1,
    },
    false,
  );
  assert.match(text, /✖ 测试将/);
  assert.match(text, /general\.json（内容不同）/);
  assert.match(text, /npm run examples:sync/);
});
