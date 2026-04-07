<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Event Log</h2>
      <div class="flex items-center gap-3 text-sm">
        <span :class="wsConnected ? 'text-green-400' : 'text-red-400'">
          {{ wsConnected ? '● Live' : '○ Reconnecting…' }}
        </span>
        <select v-model="filterSource" class="bg-gray-800 rounded px-2 py-1 text-sm">
          <option value="">All sources</option>
          <option value="slack">Slack</option>
          <option value="jira">Jira</option>
          <option value="webhook">Webhook</option>
          <option value="agent">Agent</option>
        </select>
        <input
          v-model="search"
          placeholder="Search text…"
          class="bg-gray-800 rounded px-2 py-1 text-sm w-48"
        />
      </div>
    </div>

    <div v-if="filtered.length === 0" class="text-gray-500 text-sm py-8 text-center">
      No events yet.
    </div>

    <div class="space-y-2">
      <div
        v-for="event in filtered"
        :key="event.event_id"
        class="bg-gray-900 border border-gray-800 rounded-lg p-4 cursor-pointer hover:border-gray-600 transition-colors"
        @click="toggle(event.event_id)"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <span class="text-xs font-mono bg-gray-800 px-2 py-0.5 rounded uppercase tracking-wide">
              {{ event.source }}
            </span>
            <span class="text-sm text-gray-200 line-clamp-1">
              {{ event.text?.slice(0, 80) }}{{ event.text?.length > 80 ? '…' : '' }}
            </span>
          </div>
          <div class="flex items-center gap-3 shrink-0 text-xs text-gray-500">
            <span>{{ event.requested_by }}</span>
            <span>{{ relativeTime(event) }}</span>
            <span
              :class="{
                'text-yellow-400': event._status === 'pending',
                'text-blue-400': event._status === 'processing',
                'text-green-400': event._status === 'done',
                'text-red-400': event._status === 'failed',
              }"
            >{{ event._status || 'pending' }}</span>
          </div>
        </div>

        <!-- Expanded JSON detail -->
        <pre
          v-if="expanded.has(event.event_id)"
          class="mt-3 text-xs text-gray-400 overflow-x-auto bg-gray-950 p-3 rounded"
        >{{ JSON.stringify(event, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useEventStore } from '../stores/events.js'
import { storeToRefs } from 'pinia'

const store = useEventStore()
const { events, wsConnected } = storeToRefs(store)

const filterSource = ref('')
const search = ref('')
const expanded = ref(new Set())

const toggle = (id) => {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}

const filtered = computed(() => {
  return events.value.filter((e) => {
    if (filterSource.value && e.source !== filterSource.value) return false
    if (search.value && !e.text?.toLowerCase().includes(search.value.toLowerCase())) return false
    return true
  })
})

const relativeTime = (event) => {
  const iso = event._received_at || event.created_at || event.timestamp
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

onMounted(() => {
  store.fetchEvents()
  store.connectWS()
})
</script>
