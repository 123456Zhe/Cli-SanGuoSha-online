<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useGameConnection } from "../composables/useGameConnection.js";

const { logs } = useGameConnection();
const logEl = ref<HTMLElement | null>(null);

watch(
  logs,
  async () => {
    await nextTick();
    if (logEl.value) {
      logEl.value.scrollTop = logEl.value.scrollHeight;
    }
  },
  { deep: true },
);
</script>

<template>
  <div ref="logEl" class="game-log">
    <div v-for="(line, i) in logs" :key="i" class="log-line">- {{ line }}</div>
  </div>
</template>
