<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <header class="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
      <h1 class="text-xl font-bold tracking-tight">Agent Broker</h1>
      <nav class="flex gap-4 text-sm">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'px-3 py-1 rounded transition-colors',
            activeTab === tab.id
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-white',
          ]"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <main class="p-6">
      <EventLog v-if="activeTab === 'events'" />
      <AgentHealth v-if="activeTab === 'agents'" />
      <QueueMonitor v-if="activeTab === 'queues'" />
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import EventLog from './views/EventLog.vue'
import AgentHealth from './views/AgentHealth.vue'
import QueueMonitor from './views/QueueMonitor.vue'

const tabs = [
  { id: 'events', label: 'Event Log' },
  { id: 'agents', label: 'Agent Health' },
  { id: 'queues', label: 'Queue Monitor' },
]
const activeTab = ref('events')
</script>
