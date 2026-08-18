<script setup lang="ts">
import { computed } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";

const { snapshot, playerId } = useGameConnection();

const me = computed(() => {
  if (!snapshot.value || !playerId.value) return null;
  return snapshot.value.players.find((p) => p.id === playerId.value) ?? null;
});

const handCards = computed(() => me.value?.hand ?? []);
const treasureCards = computed(() => me.value?.treasureCards ?? []);
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
          {{ card.type }}
        </span>
      </template>
      <template v-if="treasureCards.length > 0">
        <span class="hand-title-inline">木牛流马：</span>
        <span
          v-for="card in treasureCards"
          :key="card.id"
          class="card-chip treasure"
        >
          {{ card.type }}
        </span>
      </template>
      <span v-if="handCards.length === 0 && treasureCards.length === 0" class="muted">空</span>
    </div>
  </div>
</template>
