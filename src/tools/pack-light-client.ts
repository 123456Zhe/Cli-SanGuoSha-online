import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync, gzipSync, type ZlibOptions } from "node:zlib";

/**
 * Go 轻客户端（`tools/light-client/`）发布包打包器。
 *
 * 背景：README 过去直接给出 `clisanguo-lite-linux-x64.gz` / `start-client.bat` 这类发布包文件名，
 * 但仓库里既没有产出它们的脚本、也没有提交二进制（`.gitignore` 忽略），所以那些文件无法复现。
 * 这个脚本就是唯一的产出通道：用与客户端相同的 Go 工具链交叉编译，再打成 README 里写的两个包。
 *
 * - Linux：`clisanguo-lite-linux-x64.gz`（gzip 压缩的静态二进制，README 用 `gzip -d` 解开）
 * - Windows：`clisanguo-lite-windows-x64.zip`（`clisanguo-lite-windows-x64.exe` + `start-client.bat`）
 *
 * 只用 Node 内置模块打包（zlib + 手写 ZIP 容器），因此打包机除了 Go 1.21+ 不需要额外工具；
 * 归档时间戳固定为 1980-01-01、`-trimpath -buildvcs=false`，同一份源码重复打包字节一致。
 *
 * 用法：
 *   npm run light-client:pack                          # 两个包都产出到 dist/light-client/
 *   npm run light-client:pack -- --out=release         # 自定义输出目录
 *   npm run light-client:pack -- --targets=linux-x64   # 只打某一个平台
 *   npm run light-client:pack -- --go=/usr/local/go/bin/go
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 发布包目标：id 用于命令行，其余字段直通 `go build` 的交叉编译环境变量。 */
export interface BuildTarget {
  readonly id: string;
  readonly goos: string;
  readonly goarch: string;
  /** 包内二进制名（Windows 版必须带 `.exe`，`start-client.bat` 按这个名字调用）。 */
  readonly binary: string;
  /** 最终发布包文件名，与 README 中给出的名字一致。 */
  readonly archive: string;
}

export const BUILD_TARGETS: readonly BuildTarget[] = [
  {
    id: "linux-x64",
    goos: "linux",
    goarch: "amd64",
    binary: "clisanguo-lite-linux-x64",
    archive: "clisanguo-lite-linux-x64.gz",
  },
  {
    id: "windows-x64",
    goos: "windows",
    goarch: "amd64",
    binary: "clisanguo-lite-windows-x64.exe",
    archive: "clisanguo-lite-windows-x64.zip",
  },
];

/** 与 `tools/light-client/go.mod` 里的 `go 1.21` 保持一致。 */
export const MIN_GO_VERSION = "1.21";

/** Windows 启动脚本：随 Windows 包一起分发，名字与 README 一致。 */
export const LAUNCHER_PATH = "scripts/start-client.bat";

export interface PackOptions {
  readonly repoRoot: string;
  readonly outDir: string;
  readonly targetIds: readonly string[];
  /** Go 可执行文件，默认走 `PATH`。 */
  readonly goBin?: string;
  readonly log?: (line: string) => void;
}

export interface PackedArtifact {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** 解析 `--targets=`：`all`（默认）或逗号分隔的 id 列表。 */
export function resolveTargets(spec: string, targets: readonly BuildTarget[] = BUILD_TARGETS): BuildTarget[] {
  const trimmed = spec.trim();
  if (trimmed === "" || trimmed === "all") {
    return [...targets];
  }
  const requested = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  const known = targets.map((target) => target.id);
  if (requested.length === 0) {
    throw new Error(`--targets 为空；可用值：all、${known.join("、")}`);
  }
  return requested.map((id) => {
    const target = targets.find((candidate) => candidate.id === id);
    if (target === undefined) {
      throw new Error(`未知的打包目标「${id}」；可用值：all、${known.join("、")}`);
    }
    return target;
  });
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** 标准 IEEE 802.3 CRC-32（ZIP 需要的校验值）。 */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
  /** Unix 权限位，默认 0o644；可执行文件传 0o755。 */
  readonly mode?: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
/** UTF-8 文件名标记（通用位 11），避免解压工具按本地代码页误解包内文件名。 */
const FLAG_UTF8_NAME = 0x0800;
const METHOD_DEFLATE = 8;
/** 固定 1980-01-01 00:00 作为归档时间，保证重复打包字节一致。 */
const DOS_TIME_MIDNIGHT = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const VERSION_NEEDED = 20;
/** 高字节写 Unix，这样 `unzip` 在类 Unix 系统上能还原可执行位。 */
const VERSION_MADE_BY_UNIX_30 = 0x031e;

/**
 * 生成 ZIP（deflate 压缩、单卷、无注释）。
 *
 * 之所以手写而不是依赖 `zip`/`7z`：打包只需要 Node 与 Go 两个工具链，
 * 而且固定时间戳可以让发布包在重复构建时字节一致（便于校验）。
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (entry.name === "" || entry.name.includes("\\")) {
      throw new Error(`ZIP 条目名非法：${JSON.stringify(entry.name)}`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`ZIP 条目重复：${entry.name}`);
    }
    seen.add(entry.name);

    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const mode = entry.mode ?? 0o644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8_NAME, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME_MIDNIGHT, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(VERSION_MADE_BY_UNIX_30, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8_NAME, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME_MIDNIGHT, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((mode & 0xffff) << 16, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/**
 * gzip 压缩；固定 mtime=0，同一输入在任意机器上字节一致。
 *
 * `mtime` 是 Node 24 起 gzip 头可配置的字段，但当前 `@types/node` 的 `ZlibOptions`
 * 还没声明它（类型落后于运行时），因此这里显式收窄到一个本地接口再强转。
 */
export function gzipArtifact(data: Buffer): Buffer {
  const options = { level: 9, mtime: 0 } as ZlibOptions & { mtime: number };
  return gzipSync(data, options);
}

/** 批处理文件必须是 CRLF 行尾：从 Linux 检出也能打出 Windows 可用的包。 */
export function toCrLf(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function describeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "未知错误";
}

/** `go build` 失败时把 stderr 带进错误信息，避免只看到一句 "Command failed"。 */
function describeBuildError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (Buffer.isBuffer(stderr) && stderr.length > 0) {
      return stderr.toString("utf8").trim();
    }
    if (typeof stderr === "string" && stderr !== "") {
      return stderr.trim();
    }
  }
  return describeError(error);
}

/**
 * 交叉编译 `tools/light-client` 并产出发布包。返回产物清单（含 sha256）。
 * Go 工具链缺失或编译失败时抛出带修复建议的错误。
 */
export function packLightClient(options: PackOptions): PackedArtifact[] {
  const goBin = options.goBin ?? "go";
  const log = options.log ?? (() => {});
  const targets = options.targetIds.length === 0 ? [...BUILD_TARGETS] : resolveTargets(options.targetIds.join(","));

  try {
    execFileSync(goBin, ["version"], { stdio: "ignore" });
  } catch (error) {
    throw new Error(
      `未找到可用的 Go 工具链（${goBin}）：打包 Go 轻客户端需要 Go ${MIN_GO_VERSION}+，请先安装（https://go.dev/dl/）或用 --go=<路径> 指定。原始错误：${describeError(error)}`,
    );
  }

  const clientDir = join(options.repoRoot, "tools/light-client");
  if (!existsSync(join(clientDir, "go.mod"))) {
    throw new Error(`未找到 ${join(clientDir, "go.mod")}：打包必须在仓库内运行（可用 --repo=<路径> 指定仓库根目录）`);
  }
  mkdirSync(options.outDir, { recursive: true });

  const launcherPath = join(options.repoRoot, LAUNCHER_PATH);
  const buildDir = mkdtempSync(join(tmpdir(), "sgs-lite-build-"));
  const artifacts: PackedArtifact[] = [];

  try {
    for (const target of targets) {
      const binaryPath = join(buildDir, target.binary);
      log(`编译 ${target.id}（GOOS=${target.goos} GOARCH=${target.goarch}）...`);
      try {
        execFileSync(
          goBin,
          ["build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", binaryPath, "."],
          {
            cwd: clientDir,
            env: { ...process.env, CGO_ENABLED: "0", GOOS: target.goos, GOARCH: target.goarch },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (error) {
        throw new Error(`go build 失败（${target.id}）：${describeBuildError(error)}`);
      }
      const binary = readFileSync(binaryPath);

      let archive: Buffer;
      if (target.archive.endsWith(".zip")) {
        if (!existsSync(launcherPath)) {
          throw new Error(`缺少 Windows 启动脚本 ${LAUNCHER_PATH}（README 中的发布包需要它）`);
        }
        const launcher = Buffer.from(toCrLf(readFileSync(launcherPath, "utf8")), "utf8");
        archive = createZip([
          { name: target.binary, data: binary, mode: 0o755 },
          { name: basename(LAUNCHER_PATH), data: launcher, mode: 0o644 },
        ]);
      } else {
        archive = gzipArtifact(binary);
      }

      const archivePath = join(options.outDir, target.archive);
      writeFileSync(archivePath, archive);
      artifacts.push({ file: archivePath, bytes: archive.length, sha256: sha256(archive) });
      log(`  ${target.archive}（${formatBytes(archive.length)}）`);
    }
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }

  return artifacts;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

interface CliOptions {
  readonly repoRoot: string;
  readonly outDir: string;
  readonly targets: string;
  readonly goBin?: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let outDir = join(REPO_ROOT, "dist/light-client");
  let targets = "all";
  let repoRoot = REPO_ROOT;
  let goBin: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--out=")) {
      outDir = resolve(process.cwd(), arg.slice("--out=".length));
    } else if (arg.startsWith("--targets=")) {
      targets = arg.slice("--targets=".length);
    } else if (arg.startsWith("--repo=")) {
      repoRoot = resolve(process.cwd(), arg.slice("--repo=".length));
    } else if (arg.startsWith("--go=")) {
      goBin = arg.slice("--go=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法：npm run light-client:pack -- [--out=dist/light-client] [--targets=all|linux-x64,windows-x64] [--go=<go 可执行文件>]");
      process.exit(0);
    } else {
      throw new Error(`未知参数「${arg}」（用 --help 查看用法）`);
    }
  }

  return goBin === undefined ? { repoRoot, outDir, targets } : { repoRoot, outDir, targets, goBin };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const artifacts = packLightClient({
    repoRoot: options.repoRoot,
    outDir: options.outDir,
    targetIds: [options.targets],
    ...(options.goBin === undefined ? {} : { goBin: options.goBin }),
    log: (line) => console.log(line),
  });

  console.log("\n发布包：");
  for (const artifact of artifacts) {
    console.log(`  ${artifact.file}  ${formatBytes(artifact.bytes)}  sha256=${artifact.sha256}`);
  }
  console.log("\n发布包里不含源码，源码始终是本仓库的 tools/light-client/；这些产物被 .gitignore 忽略，不入库。");
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(`打包失败：${describeError(error)}`);
    process.exitCode = 1;
  }
}
