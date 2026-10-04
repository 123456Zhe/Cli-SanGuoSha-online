import { GameSnapshot } from "../engine/game.js";
import { resolveSkillDescriptor } from "../engine/skill-registry.js";
import { SkillName } from "../engine/types.js";

export const MAX_MATCH_GENERALS_CHARS = 4000;

const GENERALS_SECTION_MARK = "## 14.";
const AFTER_GENERALS_MARK = "## 15.";
const SHORT_GENERALS_MARK = "### 16.3";

const cutSection = (text: string, startMark: string, endMark: string | null): string => {
  const start = text.indexOf(startMark);
  if (start < 0) {
    return text;
  }
  if (endMark === null) {
    return text.slice(0, start).trimEnd();
  }
  const end = text.indexOf(endMark, start);
  if (end < 0) {
    return text.slice(0, start).trimEnd();
  }
  return `${text.slice(0, start).trimEnd()}\n\n${text.slice(end)}`;
};

export const stripGeneralsSections = (fullRules: string): string => {
  const withoutGenerals = cutSection(fullRules, GENERALS_SECTION_MARK, AFTER_GENERALS_MARK);
  return cutSection(withoutGenerals, SHORT_GENERALS_MARK, null);
};

export const buildMatchGeneralsText = (snapshot: GameSnapshot): string => {
  const seen = new Set<SkillName>();
  const lines: string[] = [];
  for (const player of snapshot.players) {
    for (const skill of player.skills) {
      if (seen.has(skill)) {
        continue;
      }
      seen.add(skill);
      const descriptor = resolveSkillDescriptor(skill);
      lines.push(`${player.general}（${player.name}）：${descriptor.displayName ?? skill}——${descriptor.description}`);
    }
  }
  if (lines.length === 0) {
    return "本局无武将技能。";
  }
  const full = lines.join("\n");
  if (full.length <= MAX_MATCH_GENERALS_CHARS) {
    return full;
  }
  return `${full.slice(0, MAX_MATCH_GENERALS_CHARS)}\n（技能说明过长，已截断。）`;
};
