<script setup lang="ts">
import { computed } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";

const { statusText, statusClass, snapshot, inLobby } = useGameConnection();

const turnInfo = computed(() => {
  if (!snapshot.value || snapshot.value.gameOver || inLobby.value) return "";
  return `第 ${snapshot.value.turn} 回合 · ${snapshot.value.phase}`;
});

const deckInfo = computed(() => {
  if (!snapshot.value || snapshot.value.gameOver || inLobby.value) return "";
  return `牌堆 ${snapshot.value.deckCount} · 弃牌堆 ${snapshot.value.discardCount}`;
});
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="title">三国杀</span>
      <span class="muted">{{ turnInfo }}</span>
    </div>
    <div class="top-right">
      <span class="muted">{{ deckInfo }}</span>
      <span class="status" :class="statusClass">{{ statusText }}</span>
    </div>
  </header>
</template>
