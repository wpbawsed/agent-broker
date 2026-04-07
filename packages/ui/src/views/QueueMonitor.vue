<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Queue Monitor</h2>
      <button class="text-sm text-indigo-400 hover:text-indigo-300" @click="fetch()">
        Refresh
      </button>
    </div>

    <div v-if="!queues.length" class="text-gray-500 text-sm py-8 text-center">
      No queues configured. Set <code class="text-gray-300">QUEUE_URLS</code> in the API server.
    </div>

    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-gray-500 border-b border-gray-800">
          <th class="pb-2 font-normal">Queue</th>
          <th class="pb-2 font-normal text-right">Depth</th>
          <th class="pb-2 font-normal text-right">In-flight</th>
          <th class="pb-2 font-normal text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="q in queues"
          :key="q.url"
          class="border-b border-gray-900 hover:bg-gray-900 transition-colors"
        >
          <td class="py-3 font-mono text-xs text-gray-300">{{ q.name }}</td>
          <td class="py-3 text-right" :class="q.depth > 50 ? 'text-yellow-400 font-semibold' : ''">
            {{ q.depth }}
          </td>
          <td class="py-3 text-right text-gray-400">{{ q.in_flight }}</td>
          <td class="py-3 text-right">
            <span v-if="q.depth > 50" class="text-yellow-400 text-xs">⚠ Backlog</span>
            <span v-else class="text-green-400 text-xs">OK</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const queues = ref([])

const fetch = async () => {
  const res = await window.fetch('/api/queues')
  queues.value = await res.json()
}

let interval
onMounted(() => {
  fetch()
  interval = setInterval(fetch, 30_000)
})
onUnmounted(() => clearInterval(interval))
</script>
