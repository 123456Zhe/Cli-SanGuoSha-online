<script setup lang="ts">
import { computed } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";
import type { Card } from "../protocol.js";

const { snapshot, playerId } = useGameConnection();

const me = computed(() => {
  if (!snapshot.value || !playerId.value) return null;
  return snapshot.value.players.find((p) => p.id === playerId.value) ?? null;
});

const handCards = computed(() => me.value?.hand ?? []);
const treasureCards = computed(() => me.value?.treasureCards ?? []);

const SUIT_LABELS: Record<string, string> = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" };
const RANK_LABELS: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

/** 卡牌花色点数，如"黑桃7"；无有效花色点数时返回空字符串 */
const suitRank = (card: Card): string => {
  const suit = SUIT_LABELS[card.suit] ?? "";
  const rank = card.rank > 0 ? (RANK_LABELS[card.rank] ?? String(card.rank)) : "";
  return `${suit}${rank}`;
};
</script>

<template>
  <div class="myhand-panel">
    <div class="hand-title" v-if="me && me.alive">
      我的手牌（{{ handCards.length }}）
    </div>
    <div class="hand-row">
      <template v-if="handCards.length > 0">
        <span
          v-for="card in handCards"
          :key="card.id"
          class="card-chip"
          :class="card.color"
          :title="`${card.suit} ${card.rank}`"
        >
          {{ card.type }}<span v-if="suitRank(card)" class="card-suit-rank">[{{ suitRank(card) }}]</span>
        </span>
      </template>
      <template v-if="treasureCards.length > 0">
        <span class="hand-title-inline">木牛流马：</span>
        <span
          v-for="card in treasureCards"
          :key="card.id"
          class="card-chip treasure"
        >
          {{ card.type }}<span v-if="suitRank(card)" class="card-suit-rank">[{{ suitRank(card) }}]</span>
        </span>
      </template>
      <span v-if="handCards.length === 0 && treasureCards.length === 0" class="muted">空</span>
    </div>
  </div>
</template>
