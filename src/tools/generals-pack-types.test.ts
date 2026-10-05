import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import * as ts from "typescript";
import { CardType } from "../engine/cards.js";
import { SanGuoGame } from "../engine/game.js";
import { SKILL_KINDS, TARGET_IMMUNITY_CARDS } from "../engine/general-pack.js";
import { CONVERSION_RESPONSE_KINDS, SKILL_RULE_KEY_KINDS, SKILL_TARGET_INTENTS } from "../engine/skill-registry.js";
import { PlayerRole, SKILL_TRIGGERS, TurnPhase } from "../engine/types.js";

/**
 * `types/generals-pack.d.ts`（作者类型契约，计划 §17 的 ③）的防漂移测试。
 *
 * 这个文件是手写的、独立于 `src/` 的声明，所以最容易随引擎演进而失真（改个 ctx 方法名，
 * 作者照着文档写就编译不过 / 写出来的钩子根本没人调）。本测试：
 * 1. 用 TS 编译器独立编译它，断言 **零诊断**（自成体系、无未知类型/语法错）；
 * 2. 用 AST 逐项比对 **联合成员与字段名**（SkillTrigger / SkillRules / SkillModule /
 *    SkillModuleCtx / SkillEventPayload / Player / Card / GeneralDefinition / CardSource …）
 *    与引擎的单一真相（运行时常量 + `src/` 里的同名类型）。
 *
 * 只比名字与字面量，不比签名细节（签名由第 1 条的独立编译 + 人工 review 保证）。
 */

const dtsPath = resolve(process.cwd(), "types/generals-pack.d.ts");
const dts = ts.createSourceFile(dtsPath, readFileSync(dtsPath, "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const readSource = (rel: string): ts.SourceFile =>
  ts.createSourceFile(rel, readFileSync(resolve(process.cwd(), rel), "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const typeAliases = (file: ts.SourceFile): ts.TypeAliasDeclaration[] => {
  const found: ts.TypeAliasDeclaration[] = [];
  file.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node)) {
      found.push(node);
    }
  });
  return found;
};

const interfaces = (file: ts.SourceFile): ts.InterfaceDeclaration[] => {
  const found: ts.InterfaceDeclaration[] = [];
  file.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) {
      found.push(node);
    }
  });
  return found;
};

const findAlias = (file: ts.SourceFile, name: string): ts.TypeAliasDeclaration => {
  const found = typeAliases(file).find((node) => node.name.text === name);
  assert.ok(found !== undefined, `${file.fileName} 里找不到 type ${name}`);
  return found;
};

const exportedTypeNames = (file: ts.SourceFile): string[] => [
  ...typeAliases(file).map((node) => node.name.text),
  ...interfaces(file).map((node) => node.name.text),
];

/** 类型别名必须是字符串字面量联合（本仓库的"词表"都是这个形状）。 */
const literalUnion = (file: ts.SourceFile, name: string): string[] => {
  const alias = findAlias(file, name);
  const members: string[] = [];
  const collect = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(collect);
      return;
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      members.push(node.literal.text);
      return;
    }
    assert.fail(`${file.fileName} 的 ${name}：成员 ${node.getText().slice(0, 30)} 不是字符串字面量`);
  };
  collect(alias.type);
  return members;
};

/** 装备词表：源里写 `CardType.X`，作者 d.ts 里写字符串字面量，两边都归一成牌类文本。 */
const literalUnionOfCardType = (file: ts.SourceFile, name: string): string[] => {
  const alias = findAlias(file, name);
  const key = CardType as unknown as Record<string, CardType>;
  const members: string[] = [];
  const collect = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(collect);
      return;
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      members.push(node.literal.text);
      return;
    }
    if (ts.isTypeReferenceNode(node) && ts.isQualifiedName(node.typeName) && node.typeName.left.getText() === "CardType") {
      const value = key[node.typeName.right.text];
      assert.ok(value !== undefined, `${file.fileName} 的 ${name}: CardType.${node.typeName.right.text} 不是已知牌类`);
      members.push(value);
      return;
    }
    assert.fail(`${file.fileName} 的 ${name}：成员 ${node.getText().slice(0, 30)} 不是 CardType.X 或字符串字面量`);
  };
  collect(alias.type);
  return members;
};

/** 取类型字面量 / 接口 / 交叉类型的字段名（去重排序）。 */
const memberNames = (file: ts.SourceFile, name: string): string[] => {
  const names: string[] = [];
  const pushMembers = (members: ts.NodeArray<ts.TypeElement>): void => {
    for (const member of members) {
      if ((ts.isPropertySignature(member) || ts.isMethodSignature(member)) && member.name !== undefined) {
        names.push(member.name.getText().replace(/^["']|["']$/g, ""));
      } else {
        names.push(`<不支持:${member.getText().slice(0, 24)}>`);
      }
    }
  };
  const alias = typeAliases(file).find((node) => node.name.text === name);
  const iface = interfaces(file).find((node) => node.name.text === name);
  if (alias !== undefined) {
    const collect = (node: ts.TypeNode): void => {
      if (ts.isIntersectionTypeNode(node)) {
        node.types.forEach(collect);
        return;
      }
      if (ts.isTypeLiteralNode(node)) {
        pushMembers(node.members);
        return;
      }
      assert.fail(`${file.fileName} 的 ${name}：不支持的类型节点 ${node.getText().slice(0, 30)}`);
    };
    collect(alias.type);
  } else if (iface !== undefined) {
    assert.ok((iface.heritageClauses ?? []).length === 0, `${name} 用了 extends，本测试要求显式展开或交叉类型`);
    pushMembers(iface.members);
  } else {
    assert.fail(`${file.fileName} 里找不到 ${name}`);
  }
  return [...new Set(names)].sort();
};

const sorted = (values: readonly (string | number)[]): string[] => values.map(String).sort();

void test("作者 d.ts：可以独立编译，零诊断", () => {
  const program = ts.createProgram({
    rootNames: [dtsPath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")),
    [],
  );
});

void test("作者 d.ts：导出了全部作者会引用的名字", () => {
  const expected = [
    "CardColor", "CardSuit", "CardType", "Card", "PlayerRole", "TurnPhase", "SlashKind", "DamageKind",
    "ResponseKind", "CardOrigin", "SkillTrigger", "SkillKind", "SkillTargetIntent", "TargetImmunityCard",
    "WeaponType", "ArmorType", "DefenseHorseType", "AttackHorseType", "TreasureType", "DelayedTrickEntry",
    "Player", "GeneralDefinition", "SkillRules", "SkillConversion", "SkillEventPayload", "CardSource",
    "InteractionTrigger", "InteractionRequest", "InteractionDecision", "SkillModuleCtx", "PackSkillHook", "SkillModule",
  ];
  const exported = exportedTypeNames(dts);
  for (const name of expected) {
    assert.ok(exported.includes(name), `d.ts 缺少导出类型 ${name}`);
  }
});

void test("作者 d.ts 漂移：牌/技能词表与引擎一致", () => {
  const cards = readSource("src/engine/cards.ts");
  const interaction = readSource("src/engine/interaction.ts");
  assert.deepEqual(sorted(literalUnion(dts, "CardType")), sorted(Object.values(CardType)));
  assert.deepEqual(sorted(literalUnion(dts, "CardSuit")), sorted(literalUnion(cards, "CardSuit")));
  assert.deepEqual(sorted(literalUnion(dts, "CardColor")), sorted(literalUnion(cards, "CardColor")));
  assert.deepEqual(sorted(literalUnion(dts, "CardOrigin")), sorted(literalUnion(interaction, "CardOrigin")));
  assert.deepEqual(sorted(literalUnion(dts, "SkillTrigger")), sorted(SKILL_TRIGGERS));
  assert.deepEqual(sorted(literalUnion(dts, "SkillKind")), sorted(SKILL_KINDS));
  assert.deepEqual(sorted(literalUnion(dts, "SkillTargetIntent")), sorted(SKILL_TARGET_INTENTS));
  assert.deepEqual(sorted(literalUnion(dts, "ResponseKind")), sorted(CONVERSION_RESPONSE_KINDS));
  assert.deepEqual(sorted(literalUnion(dts, "TargetImmunityCard")), sorted(TARGET_IMMUNITY_CARDS));
  assert.deepEqual(sorted(literalUnion(dts, "PlayerRole")), sorted(Object.values(PlayerRole)));
  assert.deepEqual(sorted(literalUnion(dts, "TurnPhase")), sorted(Object.values(TurnPhase)));
  assert.deepEqual(sorted(literalUnion(dts, "SlashKind")), ["fire", "normal", "thunder"]);
  assert.deepEqual(sorted(literalUnion(dts, "DamageKind")), ["fire", "thunder"]);
});

void test("作者 d.ts 漂移：装备词表与真实 CardType 子集一致", () => {
  const types = readSource("src/engine/types.ts");
  for (const name of ["WeaponType", "ArmorType", "DefenseHorseType", "AttackHorseType", "TreasureType"]) {
    assert.deepEqual(
      sorted(literalUnionOfCardType(dts, name)),
      sorted(literalUnionOfCardType(types, name)),
      `${name} 与 src/engine/types.ts 不一致`,
    );
  }
});

void test("作者 d.ts 漂移：数据结构字段名与真实类型一致", () => {
  const cards = readSource("src/engine/cards.ts");
  const types = readSource("src/engine/types.ts");
  const interaction = readSource("src/engine/interaction.ts");
  const registry = readSource("src/engine/skill-registry.ts");
  const module = readSource("src/engine/skill-module.ts");
  assert.deepEqual(memberNames(dts, "Card"), memberNames(cards, "Card"));
  assert.deepEqual(memberNames(dts, "Player"), memberNames(types, "Player"));
  assert.deepEqual(memberNames(dts, "GeneralDefinition"), memberNames(types, "GeneralDefinition"));
  assert.deepEqual(memberNames(dts, "SkillEventPayload"), memberNames(types, "SkillEventPayload"));
  assert.deepEqual(memberNames(dts, "CardSource"), memberNames(interaction, "CardSource"));
  assert.deepEqual(memberNames(dts, "InteractionTrigger"), memberNames(interaction, "InteractionTrigger"));
  assert.deepEqual(memberNames(dts, "SkillConversion"), memberNames(registry, "SkillConversion"));
  assert.deepEqual(memberNames(dts, "SkillModule"), memberNames(module, "SkillModule"));
});

void test("作者 d.ts 漂移：SkillRules 键与词表单一真相一致", () => {
  assert.deepEqual(memberNames(dts, "SkillRules"), sorted(Object.keys(SKILL_RULE_KEY_KINDS)));
});

void test("作者 d.ts 漂移：SkillModuleCtx = 真实 SkillUseContext & SkillHooksContext 的全部能力", () => {
  const skills = readSource("src/engine/skills.ts");
  const hooks = readSource("src/engine/skill-hooks.ts");
  const expected = sorted([...new Set([...memberNames(skills, "SkillUseContext"), ...memberNames(hooks, "SkillHooksContext")])]);
  assert.deepEqual(memberNames(dts, "SkillModuleCtx"), expected);
});

void test("作者 d.ts：PackSkillHook 是函数类型（三个入参：ctx / payload / logs）", () => {
  const alias = findAlias(dts, "PackSkillHook");
  assert.ok(ts.isFunctionTypeNode(alias.type), "PackSkillHook 应该是函数类型");
  assert.equal(alias.type.parameters.length, 3, "PackSkillHook 应该有 ctx / payload / logs 三个入参");
});

/** 把 d.ts 的 `SkillModuleCtx` 拆成"方法"与"数据字段"两类名字。 */
const ctxMemberKinds = (): { methods: string[]; fields: string[] } => {
  const type = findAlias(dts, "SkillModuleCtx").type;
  assert.ok(ts.isTypeLiteralNode(type), "SkillModuleCtx 应该是类型字面量");
  const methods: string[] = [];
  const fields: string[] = [];
  for (const member of type.members) {
    if ((!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) || member.name === undefined) {
      continue;
    }
    const name = member.name.getText().replace(/^["']|["']$/g, "");
    (ts.isMethodSignature(member) ? methods : fields).push(name);
  }
  return { methods, fields };
};

void test("作者 d.ts 漂移：SkillModuleCtx 的每个成员在真实 SanGuoGame 实例上都存在", () => {
  // 这条抓的是"类型/文档里有、运行时没有"的漂移——AST 比对看不出来，但它会让作者的技能
  // 在真实对局里静默失效（包钩子的 try/catch 把 TypeError 吞成一条日志）。
  const game = new SanGuoGame(() => 0.5);
  const surface = game as unknown as Record<string, unknown>;
  const { methods, fields } = ctxMemberKinds();
  assert.ok(methods.length >= 20, "SkillModuleCtx 的方法数量看起来不对");
  const missing: string[] = [];
  for (const name of methods) {
    if (!(name in surface)) {
      missing.push(`${name}（方法）：实例上没有这个成员`);
      continue;
    }
    let kind = "unknown";
    try {
      kind = typeof surface[name];
    } catch (error) {
      kind = `getter 抛错：${error instanceof Error ? error.message : String(error)}`;
    }
    if (kind !== "function") {
      missing.push(`${name}（方法）：实例上是 ${kind}`);
    }
  }
  for (const name of fields) {
    if (!(name in surface)) {
      missing.push(`${name}（字段）：实例上没有这个成员`);
    }
  }
  assert.deepEqual(missing, []);

  // 具体回归：`hasRemovableCard` 曾经只存在于类型与文档、没挂到实例上，
  // 内置「反馈」在玩家确认发动后抛 `ctx.hasRemovableCard is not a function`。
  const removable = surface["hasRemovableCard"] as (player: unknown) => boolean;
  assert.equal(typeof removable, "function", "ctx.hasRemovableCard 必须是实例上的方法");
  assert.equal(
    removable({ hand: [], treasureCards: [], weapon: null, armor: null, defenseHorse: null, attackHorse: null, treasure: null }),
    false,
  );
  assert.equal(
    removable({ hand: [{}], treasureCards: [], weapon: null, armor: null, defenseHorse: null, attackHorse: null, treasure: null }),
    true,
  );
});
