<script setup lang="ts">
import { useGameConnection } from "../composables/useGameConnection.js";

const { advisorReport, advisorPending, requestAdvisor, clearAdvisor } = useGameConnection();
</script>

<template>
  <section class="advisor">
    <div class="advisor-bar">
      <span class="advisor-title">参谋</span>
      <button class="act-btn" :disabled="advisorPending" @click="requestAdvisor('rule')">局势分析</button>
      <button
        class="act-btn"
        :disabled="advisorPending"
        @click="requestAdvisor('llm')"
        title="调用服务端配置的模型，有60秒冷却"
      >
        AI 复盘
      </button>
      <button v-if="advisorReport" class="act-btn" @click="clearAdvisor()">收起</button>
      <span v-if="advisorPending" class="muted">生成中…</span>
    </div>

    <div v-if="advisorReport" class="advisor-report">
      <div class="advisor-kind">
        {{ advisorReport.kind === "rule" ? "局势分析（规则）" : "AI 复盘（LLM）" }}
      </div>
      <div v-if="advisorReport.notice" class="advisor-notice">{{ advisorReport.notice }}</div>
      <div v-for="(line, i) in advisorReport.lines" :key="i" class="advisor-line">{{ line }}</div>
    </div>
  </section>
</template>
