<script setup lang="ts">
import { onMounted } from "vue";
import { useGameConnection } from "./composables/useGameConnection.js";
import TopBar from "./components/TopBar.vue";
import JoinOverlay from "./components/JoinOverlay.vue";
import Lobby from "./components/Lobby.vue";
import Battlefield from "./components/Battlefield.vue";
import GameLog from "./components/GameLog.vue";
import ActionPanel from "./components/ActionPanel.vue";
import AdvisorPanel from "./components/AdvisorPanel.vue";
import InteractionPanel from "./components/InteractionPanel.vue";
import MyHand from "./components/MyHand.vue";
import GameOver from "./components/GameOver.vue";

const { inLobby, snapshot, connected, connect } = useGameConnection();

onMounted(() => {
  // 首次加载即自动连接：无历史座位 → 宿主模式自动以账号加入；有历史座位 → 自动重连。
  // （旧版仅靠「加入」按钮触发连接，若 localStorage 残留 sgsPlayerId，弹窗被跳过且永不发起 WS，页面卡在“未连接”。）
  if (!connected.value) {
    connect();
  }
});
</script>

<template>
  <TopBar />

  <main>
    <!-- 大厅 -->
    <Lobby v-if="inLobby" />

    <!-- 对局 -->
    <template v-if="!inLobby && snapshot">
      <Battlefield />
      <AdvisorPanel />
      <GameLog />
      <InteractionPanel />
      <ActionPanel />
      <MyHand />
    </template>
  </main>

  <!-- 弹窗 -->
  <JoinOverlay />
  <GameOver />
</template>
