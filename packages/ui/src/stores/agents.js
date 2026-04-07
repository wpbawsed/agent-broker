import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAgentStore = defineStore('agents', () => {
  const agents = ref([])

  const fetchAgents = async () => {
    const res = await fetch('/api/agents')
    agents.value = await res.json()
  }

  return { agents, fetchAgents }
})
