<script setup lang="ts">
import { useGameConnection } from "../composables/useGameConnection.js";

const { lobbyPlayers, roomSize } = useGameConnection();
</script>

<template>
  <section class="lobby-panel">
    <h2>等待其他玩家加入…</h2>
    <ul>
      <li v-for="p in lobbyPlayers" :key="p.id">
        {{ p.name }}<span v-if="p.name.includes('[AI]')">（AI）</span>
      </li>
      <li class="muted">等待玩家（{{ lobbyPlayers.length }}/{{ roomSize }}）</li>
    </ul>
    <p class="hint">人齐后游戏自动开始。若你之前断线，刷新页面即可自动重连取回控制权。</p>
  </section>
</template>
