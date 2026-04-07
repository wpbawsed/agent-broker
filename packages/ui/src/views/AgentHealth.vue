<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Agent Health</h2>
      <button
        class="text-sm text-indigo-400 hover:text-indigo-300"
        @click="store.fetchAgents()"
      >
        Refresh
      </button>
    </div>

    <div v-if="agents.length === 0" class="text-gray-500 text-sm py-8 text-center">
      No agents registered yet.
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="agent in agents"
        :key="agent.agent_id"
        class="bg-gray-900 border border-gray-800 rounded-lg p-4"
      >
        <div class="flex items-center gap-2 mb-3">
          <span :class="statusDot(agent.status)" class="text-lg leading-none">●</span>
          <span class="font-medium">{{ agent.agent_id }}</span>
        </div>
        <div class="text-xs text-gray-400 space-y-1">
          <div>Queue: <span class="text-gray-300 font-mono text-xs break-all">{{ queueName(agent.queue_url) }}</span></div>
          <div>Processed: <span class="text-gray-300">{{ agent.processed_count ?? 0 }}</span></div>
          <div>Errors: <span :class="agent.error_count > 0 ? 'text-red-400' : 'text-gray-300'">{{ agent.error_count ?? 0 }}</span></div>
          <div>Uptime: <span class="text-gray-300">{{ formatUptime(agent.uptime_seconds) }}</span></div>
          <div>Last seen: <span class="text-gray-300">{{ relativeTime(agent.last_heartbeat_at) }}</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAgentStore } from '../stores/agents.js'

const store = useAgentStore()
const { agents } = storeToRefs(store)

const statusDot = (s) => ({
  'text-green-400': s === 'healthy',
  'text-yellow-400': s === 'degraded',
  'text-red-500': s === 'offline',
})

const queueName = (url) => url?.split('/').pop() ?? url ?? '-'

const formatUptime = (seconds) => {
  if (!seconds) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const relativeTime = (iso) => {
  if (!iso) return 'never'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

let interval
onMounted(() => {
  store.fetchAgents()
  interval = setInterval(store.fetchAgents, 30_000)
})
onUnmounted(() => clearInterval(interval))
</script>
