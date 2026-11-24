import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `examples/generals/` 参考 gallery 与默认武将包目录 `generals/` 的单一数据源同步器。
 *
 * 背景：gallery 里的 7 个参考武将**同时**存在于两处——
 *   - `generals/<武将>/`：`npm run dev` 默认加载的武将包目录（真实对局用的那份）；
 *   - `examples/generals/<武将>/`：给武将包作者抄的 gallery（默认不加载）。
 * 两份曾经是手工复制的，于是漂移过（刘禅/享乐的注释与日志顺序、README 的触发点计数），
 * 因为没有任何机制提醒"你只改了一边"。
 *
 * 约定：**`generals/` 是唯一数据源**，`examples/generals/` 是它的镜像。
 * 本工具把 `GALLERY_PACKS` 里每个包的 `generals/<武将>/` **逐字节**镜像到
 * `examples/generals/<武将>/`（多出的文件删除），其余 gallery 内容（`README.md`）不动。
 *
 * 两份必须逐字节相同，所以包内文档（`general.md`）与注释不能写只在其中一边成立的路径
 * （例如"本文件位于 `examples/generals/刘禅/`"）——这类写法会让镜像变成假同步。
 *
 * 用法：
 *   npm run examples:sync     # 就地重写 examples/generals/<武将>/（默认写入）
 *   npm run examples:check    # 只校验是否已同步（CI / npm test 用），不同步则非零退出
 */

/** 仓库根的默认武将包目录（单一数据源）。 */
export const GENERALS_DIR = "generals";

/** 参考 gallery 目录（镜像目标）。 */
export const EXAMPLES_DIR = join("examples", "generals");

/**
 * 要镜像进 gallery 的参考武将包 = `generals/` 里存在的包名，见 `resolveGalleryPacks()`。
 * 这里只列"曾经进过 gallery"的武将，新增参考武将时把它加进来（否则它不会出现在 gallery）。
 */
export const GALLERY_PACKS = ["吕蒙", "神赵云", "张角", "凌统", "荀彧", "卧龙诸葛亮", "刘禅"] as const;

export type MirrorSyncOptions = {
  /** 仓库根，默认 `process.cwd()`。 */
  root?: string;
  /** 要同步的包名，默认 `GALLERY_PACKS`。 */
  packs?: readonly string[];
};

export type MirrorFile = {
  /** 相对包目录的路径（POSIX 分隔符，便于稳定排序与报错）。 */
  path: string;
  status: "same" | "changed" | "missing" | "extra";
};

export type MirrorPackReport = {
  pack: string;
  files: MirrorFile[];
  synced: boolean;
};

export type MirrorSyncReport = {
  /** 单一数据源目录（相对仓库根）。 */
  source: string;
  /** 镜像目录（相对仓库根）。 */
  target: string;
  packs: MirrorPackReport[];
  /** 有问题（missing/changed/extra）的包数。 */
  drifted: number;
  /** 有问题的文件总数。 */
  driftFiles: number;
};

/** 递归收集一个目录下的全部文件，返回相对 `base` 的 POSIX 路径（稳定排序）。 */
export const listFiles = (base: string, dir: string = base): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(base, full));
    } else if (entry.isFile()) {
      files.push(relative(base, full).split("\\").join("/"));
    }
  }
  return files;
};

/** 单个包的镜像差异（不写文件）。 */
const inspectPack = (sourceDir: string, targetDir: string): MirrorFile[] => {
  const sourceFiles = new Set(listFiles(sourceDir));
  const targetFiles = new Set(existsSync(targetDir) ? listFiles(targetDir) : []);
  const files: MirrorFile[] = [];
  for (const path of [...sourceFiles].sort()) {
    if (!targetFiles.has(path)) {
      files.push({ path, status: "missing" });
      continue;
    }
    const same = readFileSync(join(sourceDir, path)).equals(readFileSync(join(targetDir, path)));
    files.push({ path, status: same ? "same" : "changed" });
  }
  for (const path of [...targetFiles].sort()) {
    if (!sourceFiles.has(path)) {
      files.push({ path, status: "extra" });
    }
  }
  return files;
};

/** 删除目录下因此前删除多出文件而变空的子目录（自底向上，保留 `dir` 本身）。 */
const pruneEmptyDirs = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = join(dir, entry.name);
    pruneEmptyDirs(full);
    if (readdirSync(full).length === 0) {
      rmSync(full, { recursive: true });
    }
  }
};

/** 把单个包从 `sourceDir` 逐字节镜像到 `targetDir`（删除镜像里多出的文件与空目录）。 */
const mirrorPack = (sourceDir: string, targetDir: string): void => {
  const sourceFiles = new Set(listFiles(sourceDir));
  if (existsSync(targetDir)) {
    for (const path of listFiles(targetDir)) {
      if (!sourceFiles.has(path)) {
        rmSync(join(targetDir, path));
      }
    }
    pruneEmptyDirs(targetDir);
  }
  for (const path of sourceFiles) {
    const from = join(sourceDir, path);
    const to = join(targetDir, path);
    mkdirSync(dirname(to), { recursive: true });
    const current = existsSync(to) ? readFileSync(to) : null;
    const wanted = readFileSync(from);
    if (current === null || !current.equals(wanted)) {
      writeFileSync(to, wanted);
    }
  }
};

/**
 * 计算（`write=false`）或执行（`write=true`）gallery 镜像同步。
 * `write` 模式下返回的差异是**同步前**的状态，便于打印"改了哪些文件"。
 */
export const syncExamples = (options: MirrorSyncOptions & { write?: boolean } = {}): MirrorSyncReport => {
  const root = resolve(options.root ?? process.cwd());
  const packs = options.packs ?? GALLERY_PACKS;
  const sourceRoot = join(root, GENERALS_DIR);
  const targetRoot = join(root, EXAMPLES_DIR);
  const report: MirrorSyncReport = {
    source: GENERALS_DIR,
    target: EXAMPLES_DIR.split("\\").join("/"),
    packs: [],
    drifted: 0,
    driftFiles: 0,
  };

  for (const pack of packs) {
    const sourceDir = join(sourceRoot, pack);
    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
      throw new Error(
        `参考武将包 ${pack} 在 ${GENERALS_DIR}/ 下不存在；${GENERALS_DIR}/ 是单一数据源，gallery 只能由它镜像`,
      );
    }
    const targetDir = join(targetRoot, pack);
    const files = inspectPack(sourceDir, targetDir);
    const synced = files.every((file) => file.status === "same");
    if (options.write === true) {
      mirrorPack(sourceDir, targetDir);
    }
    if (!synced) {
      report.drifted += 1;
      report.driftFiles += files.filter((file) => file.status !== "same").length;
    }
    report.packs.push({ pack, files, synced });
  }

  return report;
};

/** 可读的渲染：只列有差异的文件。 */
export const renderMirrorReport = (report: MirrorSyncReport, write: boolean): string => {
  const lines: string[] = [];
  for (const pack of report.packs) {
    if (pack.synced) {
      continue;
    }
    lines.push(`✖ ${pack.pack}`);
    for (const file of pack.files) {
      if (file.status === "same") {
        continue;
      }
      const label = file.status === "missing" ? "只存在于 generals/" : file.status === "extra" ? "只存在于 gallery" : "内容不同";
      lines.push(`    ${file.path}（${label}）`);
    }
  }
  if (lines.length === 0) {
    return `[examples] ${report.packs.length} 个 gallery 包与 ${report.source}/ 逐字节一致`;
  }
  const action = write ? "已重新镜像" : "已漂移，请运行 npm run examples:sync";
  return [
    ...lines,
    `[examples] ${report.drifted} 个包 / ${report.driftFiles} 个文件${action}（单一数据源：${report.source}/ → 镜像：${report.target}/）`,
  ].join("\n");
};

const main = (): void => {
  const checkOnly = process.argv.includes("--check");
  const report = syncExamples({ write: !checkOnly });
  console.log(renderMirrorReport(report, !checkOnly));
  if (checkOnly && report.drifted > 0) {
    process.exitCode = 1;
  }
};

// 仅在被当作脚本执行时跑 main（被测试 import 时不产生副作用）；tsx 与编译后的 dist 都适用。
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main();
}
