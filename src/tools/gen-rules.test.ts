import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { getBuiltinGenerals } from "../engine/generals.js";
import { renderGeneralsDetail, renderGeneralsShort, renderRules } from "./gen-rules.js";

const rulesPath = resolve(process.cwd(), "rules.md");

void test("rules.md 的武将章节与武将库/注册表同步（npm run rules:check 的测试版）", () => {
  const original = readFileSync(rulesPath, "utf-8");
  const generated = renderRules(original);
  if (generated !== original) {
    const expected = generated.split("\n");
    const actual = original.split("\n");
    const index = expected.findIndex((line, i) => line !== actual[i]);
    assert.fail(
      `rules.md 已过期，请运行 npm run rules:gen（首个不同行：${index + 1}）\n  期望：${expected[index] ?? "<无>"}\n  实际：${actual[index] ?? "<无>"}`,
    );
  }
  assert.equal(generated, original);
});

void test("rules.md 持有全部 4 个生成标记（脚本只替换标记之间的内容）", () => {
  const text = readFileSync(rulesPath, "utf-8");
  for (const marker of ["GENERATED:generals-detail", "GENERATED:generals-short"]) {
    assert.equal(text.split(marker).length - 1, 2, `${marker} 应各出现一次开始与结束标记`);
  }
});

void test("§14 生成内容覆盖全部内置武将，且不出现「未知技能」", () => {
  const detail = renderGeneralsDetail();
  for (const general of getBuiltinGenerals()) {
    assert.ok(detail.includes(`${general.name}：`), `§14 应包含 ${general.name}`);
  }
  assert.equal(detail.includes("未知技能"), false);
  // 内置武将都有技能；没有任何武将被生成成"空技能行"。
  assert.equal(/：。/.test(detail), false, "不应出现没有技能的武将行");
});

void test("§16.3 生成内容覆盖全部内置武将", () => {
  const short = renderGeneralsShort();
  for (const general of getBuiltinGenerals()) {
    assert.ok(short.includes(general.name), `§16.3 应包含 ${general.name}`);
  }
  assert.ok(short.includes("技能详情"));
});

void test("生成器是幂等的（对已生成内容再生成一次结果不变）", () => {
  const original = readFileSync(rulesPath, "utf-8");
  const once = renderRules(original);
  assert.equal(renderRules(once), once, "二次生成必须与一次生成完全一致");
});

void test("生成标记缺失时抛错（宁可失败也不误删文档）", () => {
  assert.throws(() => renderRules("# 空文档\n"), /生成标记/);
});
