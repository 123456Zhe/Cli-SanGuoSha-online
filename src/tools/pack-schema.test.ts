import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { CardType } from "../engine/cards.js";
import { CONVERSION_SUITS, SKILL_KINDS, TARGET_IMMUNITY_CARDS } from "../engine/general-pack.js";
import {
  CONVERTIBLE_CARD_TYPES,
  CONVERSION_RESPONSE_KINDS,
  SKILL_RULE_KEY_KINDS,
  SKILL_TARGET_INTENTS,
} from "../engine/skill-registry.js";
import { SKILL_TRIGGERS } from "../engine/types.js";
import { CODE_ONLY_SKILL_KEYS, KNOWN_GENERAL_KEYS, KNOWN_SKILL_KEYS } from "./generals-check.js";

/**
 * `schema/general.schema.json` / `schema/skill.schema.json` 的防漂移测试（计划 §17 的 ②）。
 *
 * 两个方向都卡住：
 * 1. **schema ↔ 代码**：schema 里的 enum/字段名必须与引擎的单一真相常量一致
 *    （`SKILL_TRIGGERS` / `SKILL_RULE_KEY_KINDS` / `CONVERTIBLE_CARD_TYPES` / `CardType` …），
 *    否则"照 schema 写却被 loader 拒"或反之；
 * 2. **schema ↔ 示例包**：`examples/generals/` 下每个 `general.json` 与 `.skill.json` 都必须通过 schema，
 *    并用反向用例证明 schema 不是空壳（未知字段/坏枚举/缺必填必须报错）。
 *
 * 这里的校验器只实现本仓库 schema 用到的 draft-07 子集（type/enum/const/required/properties/
 * additionalProperties/items/minItems/minLength/minimum/minProperties/anyOf），
 * 目的是自检示例包，不打算当通用 JSON Schema 实现用。
 */

type SchemaNode = {
  $schema?: string;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean;
  items?: SchemaNode;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  minProperties?: number;
  anyOf?: SchemaNode[];
};

const describeType = (value: unknown): string => {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
};

/** 只覆盖本仓库 schema 用到的子集；返回人类可读的错误路径列表（空 = 通过）。 */
const validateSchema = (node: SchemaNode, value: unknown, path: string, errors: string[]): void => {
  if (node.const !== undefined && value !== node.const) {
    errors.push(`${path}: 期望常量 ${JSON.stringify(node.const)}，实际 ${JSON.stringify(value)}`);
  }
  if (node.enum !== undefined && !node.enum.some((item) => item === value)) {
    errors.push(`${path}: 不在允许值 [${node.enum.map((item) => JSON.stringify(item)).join(", ")}] 内（实际 ${JSON.stringify(value)}）`);
  }
  if (node.type !== undefined) {
    const actual = describeType(value);
    const ok = node.type === "integer"
      ? typeof value === "number" && Number.isInteger(value)
      : node.type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : actual === node.type;
    if (!ok) {
      errors.push(`${path}: 期望类型 ${node.type}，实际 ${actual}`);
      return;
    }
  }
  if (typeof value === "string" && node.minLength !== undefined && value.length < node.minLength) {
    errors.push(`${path}: 长度不能小于 ${node.minLength}`);
  }
  if (typeof value === "number" && node.minimum !== undefined && value < node.minimum) {
    errors.push(`${path}: 不能小于 ${node.minimum}`);
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push(`${path}: 至少需要 ${node.minItems} 项`);
    }
    const items = node.items;
    if (items !== undefined) {
      value.forEach((item, index) => validateSchema(items, item, `${path}[${index}]`, errors));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of node.required ?? []) {
      if (!(key in obj)) {
        errors.push(`${path}: 缺少必填字段 ${key}`);
      }
    }
    if (node.minProperties !== undefined && Object.keys(obj).length < node.minProperties) {
      errors.push(`${path}: 至少需要 ${node.minProperties} 个字段`);
    }
    const properties = node.properties ?? {};
    for (const [key, child] of Object.entries(obj)) {
      const sub = properties[key];
      if (sub === undefined) {
        if (node.additionalProperties === false) {
          errors.push(`${path}.${key}: 不是已知字段`);
        }
        continue;
      }
      validateSchema(sub, child, `${path}.${key}`, errors);
    }
  }
  if (node.anyOf !== undefined) {
    const satisfied = node.anyOf.some((sub) => {
      const subErrors: string[] = [];
      validateSchema(sub, value, path, subErrors);
      return subErrors.length === 0;
    });
    if (!satisfied) {
      errors.push(`${path}: 不满足 anyOf 约束`);
    }
  }
};

const errorsFor = (schema: SchemaNode, value: unknown): string[] => {
  const errors: string[] = [];
  validateSchema(schema, value, "$", errors);
  return errors;
};

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8")) as unknown;

const propsOf = (node: SchemaNode | undefined, label: string): Record<string, SchemaNode> => {
  const properties = node?.properties;
  assert.ok(properties !== undefined, `schema 缺少 ${label}.properties`);
  return properties;
};

const propOf = (node: SchemaNode | undefined, key: string, label: string): SchemaNode => {
  const found = node?.properties?.[key];
  assert.ok(found !== undefined, `schema 缺少 ${label}`);
  return found;
};

const itemsOf = (node: SchemaNode | undefined, label: string): SchemaNode => {
  const items = node?.items;
  assert.ok(items !== undefined, `schema 缺少 ${label}.items`);
  return items;
};

const enumOf = (node: SchemaNode | undefined, label: string): unknown[] => {
  const values = node?.enum;
  assert.ok(values !== undefined, `schema 缺少 ${label} 的 enum`);
  return values;
};

const generalSchema = readJson(resolve(process.cwd(), "schema/general.schema.json")) as SchemaNode;
const skillSchema = readJson(resolve(process.cwd(), "schema/skill.schema.json")) as SchemaNode;

const skillProp = (key: string): SchemaNode => propOf(skillSchema, key, `skill.properties.${key}`);

void test("schema：两份 schema 都是 draft-07 且可解析", () => {
  assert.equal(generalSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(skillSchema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(generalSchema.type, "object");
  assert.equal(skillSchema.type, "object");
});

void test("schema 漂移：general.json 的字段与必填项和校验器/loader 一致", () => {
  const properties = propsOf(generalSchema, "general");
  assert.deepEqual(Object.keys(properties).sort(), [...KNOWN_GENERAL_KEYS].sort());
  assert.deepEqual([...(generalSchema.required ?? [])].sort(), ["apiVersion", "gender", "kingdom", "maxHp", "name", "skills"]);
  assert.equal(propOf(generalSchema, "apiVersion", "general.properties.apiVersion").const, 1);
  assert.deepEqual(enumOf(propOf(generalSchema, "gender", "general.properties.gender"), "general.gender"), ["男", "女"]);
  assert.equal(propOf(generalSchema, "maxHp", "general.properties.maxHp").type, "integer");
});

void test("schema 漂移：skill.json 的枚举与代码单一真相一致", () => {
  assert.deepEqual(enumOf(skillProp("kind"), "skill.kind"), [...SKILL_KINDS]);
  assert.deepEqual(enumOf(skillProp("targetIntent"), "skill.targetIntent"), [...SKILL_TARGET_INTENTS]);
  assert.deepEqual(enumOf(itemsOf(skillProp("triggers"), "skill.triggers"), "skill.triggers.items"), [...SKILL_TRIGGERS]);
  const rulesNode = skillProp("rules");
  const rulesProps = propsOf(rulesNode, "skill.rules");
  assert.deepEqual(Object.keys(rulesProps).sort(), Object.keys(SKILL_RULE_KEY_KINDS).sort());
  for (const [key, kind] of Object.entries(SKILL_RULE_KEY_KINDS)) {
    const node = propOf(rulesNode, key, `skill.rules.${key}`);
    if (kind === "targetImmunity") {
      assert.equal(node.type, "object", `rules.${key} 应该是对象`);
      const cards = propOf(node, "cards", `rules.${key}.cards`);
      assert.deepEqual(enumOf(itemsOf(cards, `rules.${key}.cards`), `rules.${key}.cards.items`), [...TARGET_IMMUNITY_CARDS]);
    } else {
      assert.equal(node.type, kind, `rules.${key} 的 schema 类型应为 ${kind}`);
    }
  }
});

void test("schema 漂移：conversions 的 to/from/asResponse 与引擎白名单一致", () => {
  const conversion = itemsOf(skillProp("conversions"), "skill.conversions");
  assert.deepEqual(enumOf(propOf(conversion, "to", "conversions.to"), "conversions.to"), [...CONVERTIBLE_CARD_TYPES]);
  const asResponse = propOf(conversion, "asResponse", "conversions.asResponse");
  assert.deepEqual(enumOf(itemsOf(asResponse, "conversions.asResponse"), "conversions.asResponse.items"), [...CONVERSION_RESPONSE_KINDS]);
  const from = propOf(conversion, "from", "conversions.from");
  assert.deepEqual(
    enumOf(itemsOf(propOf(from, "suit", "conversions.from.suit"), "conversions.from.suit"), "conversions.from.suit.items"),
    [...CONVERSION_SUITS],
  );
  assert.deepEqual(
    enumOf(itemsOf(propOf(from, "color", "conversions.from.color"), "conversions.from.color"), "conversions.from.color.items"),
    ["red", "black"],
  );
  assert.deepEqual(
    enumOf(itemsOf(propOf(from, "type", "conversions.from.type"), "conversions.from.type"), "conversions.from.type.items"),
    Object.values(CardType),
  );
  assert.deepEqual([...(conversion.required ?? [])].sort(), ["from", "to"]);
});

void test("schema 漂移：skill.json 的声明式字段 = 校验器已知字段 - 代码技能专有字段", () => {
  const declarative = Object.keys(propsOf(skillSchema, "skill"));
  assert.deepEqual(
    [...KNOWN_SKILL_KEYS].filter((key) => !CODE_ONLY_SKILL_KEYS.includes(key)).sort(),
    [...declarative].sort(),
  );
  for (const key of CODE_ONLY_SKILL_KEYS) {
    assert.ok(!declarative.includes(key), `${key} 是代码技能专有字段，不该出现在声明式 schema 里`);
  }
  assert.deepEqual([...(skillSchema.required ?? [])].sort(), ["description", "kind"]);
});

void test("schema 验收：examples/generals 下所有 general.json 与 .skill.json 都通过 schema", () => {
  const dir = resolve(process.cwd(), "examples/generals");
  const packs = readdirSync(dir).filter((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() && existsSync(join(full, "general.json"));
  });
  assert.ok(packs.length >= 2, "examples/generals 至少要有 2 个示例包（否则这个验收是空转）");
  for (const pack of packs) {
    const general = readJson(join(dir, pack, "general.json"));
    assert.deepEqual(errorsFor(generalSchema, general), [], `${pack}/general.json 不符合 schema`);
    for (const file of readdirSync(join(dir, pack)).filter((name) => name.endsWith(".skill.json"))) {
      const skill = readJson(join(dir, pack, file));
      assert.deepEqual(errorsFor(skillSchema, skill), [], `${pack}/${file} 不符合 schema`);
    }
  }
});

void test("schema 反向用例：未知字段 / 坏枚举 / 缺必填 都会被报出来", () => {
  const validGeneral = {
    apiVersion: 1,
    name: "测试",
    kingdom: "蜀",
    gender: "男",
    maxHp: 4,
    skills: ["测试技"],
  };
  assert.deepEqual(errorsFor(generalSchema, validGeneral), []);

  const unknownField = { ...validGeneral, rule: {} };
  assert.ok(errorsFor(generalSchema, unknownField).some((line) => line.includes("rule")), "未知字段应被 additionalProperties:false 抓出");

  const badGender = { ...validGeneral, gender: "男男" };
  assert.ok(errorsFor(generalSchema, badGender).some((line) => line.includes("gender")), "坏枚举应被 enum 抓出");

  const missingSkill = { kind: "triggered" };
  const missingErrors = errorsFor(skillSchema, missingSkill);
  assert.ok(missingErrors.some((line) => line.includes("description")), "缺 description 应被抓出");

  const emptyFrom = { kind: "conversion", description: "x", conversions: [{ from: {}, to: "闪", asResponse: ["dodge"] }] };
  assert.ok(
    errorsFor(skillSchema, emptyFrom).some((line) => line.includes("anyOf")),
    "from 什么都没给应被 anyOf 抓出（loader 也会拒绝）",
  );

  const badTo = { kind: "conversion", description: "x", conversions: [{ from: { suit: ["heart"] }, to: "乐不思蜀" }] };
  assert.ok(errorsFor(skillSchema, badTo).some((line) => line.includes("conversions")), "非白名单 to 应被 enum 抓出");

  const codeFieldInJson = { kind: "active", description: "x", play: "not-a-function" };
  assert.ok(errorsFor(skillSchema, codeFieldInJson).some((line) => line.includes("play")), ".skill.json 里出现代码专有字段应被报出");
});
