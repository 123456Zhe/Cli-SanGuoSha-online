import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as zlib from "node:zlib";
import {
  BUILD_TARGETS,
  LAUNCHER_PATH,
  MIN_GO_VERSION,
  createZip,
  crc32,
  gzipArtifact,
  resolveTargets,
  toCrLf,
} from "./pack-light-client.js";

/** 极简 ZIP 读取器：只处理本工具产出的单卷、非 ZIP64 归档，用来断言结构可被标准工具解析。 */
function readZipEntries(archive: Buffer): { name: string; data: Buffer; mode: number }[] {
  const endOffset = archive.length - 22;
  assert.equal(archive.readUInt32LE(endOffset), 0x06054b50, "应存在中央目录结束记录");
  const count = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const entries: { name: string; data: Buffer; mode: number }[] = [];

  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50, "应存在中央目录条目");
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const mode = archive.readUInt32LE(cursor + 38) >>> 16;
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, "应存在本地文件头");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    assert.equal(method, 8, "应使用 deflate 压缩");
    entries.push({ name, data: zlib.inflateRawSync(raw), mode });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

void test("发布包目标与 README 中的文件名保持一致", () => {
  const archives = BUILD_TARGETS.map((target) => target.archive).sort();
  assert.deepEqual(archives, ["clisanguo-lite-linux-x64.gz", "clisanguo-lite-windows-x64.zip"]);
  for (const target of BUILD_TARGETS) {
    assert.match(target.binary, new RegExp(`^clisanguo-lite-${target.id.replace("-", "-")}`));
  }
  assert.equal(BUILD_TARGETS.find((target) => target.goos === "windows")?.binary.endsWith(".exe"), true);
});

void test("resolveTargets 支持 all、单个平台与逗号分隔列表，并拒绝未知目标", () => {
  assert.deepEqual(resolveTargets("all").map((target) => target.id), ["linux-x64", "windows-x64"]);
  assert.deepEqual(resolveTargets("").map((target) => target.id), ["linux-x64", "windows-x64"]);
  assert.deepEqual(resolveTargets("linux-x64").map((target) => target.id), ["linux-x64"]);
  assert.deepEqual(resolveTargets("windows-x64,linux-x64").map((target) => target.id), ["windows-x64", "linux-x64"]);
  assert.throws(() => resolveTargets("darwin-arm64"), /未知的打包目标/);
  assert.throws(() => resolveTargets(","), /--targets 为空/);
});

void test("crc32 与 node:zlib 的实现一致", () => {
  const samples = [Buffer.alloc(0), Buffer.from("hello"), Buffer.from("三国杀"), Buffer.from([0, 255, 128, 7])];
  for (const sample of samples) {
    assert.equal(crc32(sample), zlibCrc32(sample), `CRC32 不一致：${sample.toString("hex")}`);
  }
});

/** 直接从 zlib 取 CRC-32（Node 20.15+ / 22.2+ 自带 `zlib.crc32`）。 */
function zlibCrc32(data: Buffer): number {
  const fn = (zlib as { crc32?: (data: Buffer) => number }).crc32;
  assert.equal(typeof fn, "function", "当前 Node 版本应提供 zlib.crc32");
  return fn?.(data) ?? 0;
}

void test("createZip 产出的归档可被标准工具解析，且保留可执行位与 CRLF 启动脚本", () => {
  const zip = createZip([
    { name: "clisanguo-lite-windows-x64.exe", data: Buffer.from("MZ fake binary"), mode: 0o755 },
    { name: "start-client.bat", data: Buffer.from(toCrLf("@echo off\npause\n")), mode: 0o644 },
  ]);
  const entries = readZipEntries(zip);
  assert.deepEqual(entries.map((entry) => entry.name), ["clisanguo-lite-windows-x64.exe", "start-client.bat"]);
  const [exeEntry, launcherEntry] = entries;
  assert.ok(exeEntry !== undefined && launcherEntry !== undefined, "两个条目都应存在");
  assert.equal(exeEntry.data.toString("utf8"), "MZ fake binary");
  assert.equal(exeEntry.mode & 0o777, 0o755);
  assert.equal(launcherEntry.mode & 0o777, 0o644);
  assert.equal(launcherEntry.data.toString("utf8").includes("\r\n"), true);
});

void test("toCrLf 幂等：LF 与 CRLF 输入都得到 CRLF", () => {
  assert.equal(toCrLf("a\nb\n"), "a\r\nb\r\n");
  assert.equal(toCrLf("a\r\nb\r\n"), "a\r\nb\r\n");
  assert.equal(toCrLf("a\rb"), "a\r\nb");
});

void test("gzip 压缩固定 mtime，同一输入字节一致（可重复构建）", () => {
  const payload = Buffer.from("clisanguo-lite");
  const first = gzipArtifact(payload);
  const second = gzipArtifact(payload);
  assert.deepEqual(first, second);
  // gzip 头第 4-7 字节是 MTIME，固定为 0 才能重复构建。
  assert.equal(first.readUInt32LE(4), 0);
});

void test("Windows 启动脚本存在、调用真正的发布包二进制名", () => {
  const repoRoot = resolve(process.cwd());
  assert.equal(MIN_GO_VERSION, "1.21", "最小 Go 版本应与 tools/light-client/go.mod 一致");
  const launcher = readFileSync(resolve(repoRoot, LAUNCHER_PATH), "utf8");
  const windowsBinary = BUILD_TARGETS.find((target) => target.goos === "windows")?.binary;
  assert.ok(windowsBinary !== undefined);
  assert.ok(launcher.includes(windowsBinary), `${LAUNCHER_PATH} 应调用 ${windowsBinary}`);
  assert.ok(launcher.includes("-host=") && launcher.includes("-port=") && launcher.includes("-name="));
});

void test("README 的轻客户端章节指向本打包脚本与产出文件名", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
  assert.ok(readme.includes("npm run light-client:pack"), "README 应给出可复现的打包命令");
  for (const target of BUILD_TARGETS) {
    assert.ok(readme.includes(target.archive), `README 应提到产出文件名 ${target.archive}`);
  }
  assert.ok(readme.includes("start-client.bat"), "README 应提到 Windows 启动脚本 start-client.bat");
});
