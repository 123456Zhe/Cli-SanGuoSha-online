<script setup lang="ts">
import { computed } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";
import type { PublicPlayer } from "../protocol.js";

const { snapshot, playerId } = useGameConnection();

const players = computed<PublicPlayer[]>(() => snapshot.value?.players ?? []);

const hpPercent = (p: PublicPlayer) =>
  p.maxHp > 0 ? Math.round((Math.max(0, p.hp) / p.maxHp) * 100) : 0;

const equipmentOf = (p: PublicPlayer) => [
  ["武", p.weapon],
  ["防", p.armor],
  ["攻马", p.attackHorse],
  ["防马", p.defenseHorse],
  ["宝", p.treasure],
].filter(([, name]) => name) as Array<[string, string]>;

const extraInfo = (p: PublicPlayer) => {
  const parts: string[] = [];
  if (p.faceDown) parts.push("翻面");
  if (p.id !== playerId.value) parts.push(`手牌 ${p.handCount} 张`);
  if (p.treasureCardCount > 0) parts.push(`宝物区 ${p.treasureCardCount} 张`);
  return parts;
};
</script>

<template>
  <div class="battlefield">
    <div
      v-for="p in players"
      :key="p.id"
      class="player-card"
      :class="{
        current: p.id === snapshot?.currentPlayerId,
        me: p.id === playerId,
        dead: !p.alive,
        ai: p.isAI,
      }"
    >
      <!-- 头部 -->
      <div class="pc-head">
        <span class="pc-name">{{ p.name }}</span>
        <span v-if="!p.alive" class="tag dead-tag">阵亡</span>
        <span v-if="p.isAI" class="tag">AI</span>
        <span v-if="p.id === playerId" class="tag me-tag">我</span>
      </div>

      <!-- 武将信息 -->
      <div class="pc-info">
        <span>{{ p.general }} · {{ p.kingdom }}{{ p.gender }}</span>
        <span class="muted">身份:{{ p.role }}</span>
      </div>

      <!-- 血条 -->
      <div class="hp-bar">
        <div class="hp-fill" :style="{ width: hpPercent(p) + '%' }">
          {{ Math.max(0, p.hp) }}/{{ p.maxHp }}
        </div>
      </div>

      <!-- 装备 -->
      <div class="pc-equip">
        <template v-if="equipmentOf(p).length > 0">
          <span v-for="([label, name], i) in equipmentOf(p)" :key="i" class="equip-item">
            {{ label }}:{{ name }}
          </span>
        </template>
        <span v-else class="muted">无装备</span>
      </div>

      <!-- 额外信息 -->
      <div v-if="extraInfo(p).length > 0" class="pc-extra">
        {{ extraInfo(p).join(" · ") }}
      </div>
    </div>
  </div>
</template>
