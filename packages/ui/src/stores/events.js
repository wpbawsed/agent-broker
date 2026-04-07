import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useEventStore = defineStore('events', () => {
  const events = ref([])
  const wsConnected = ref(false)

  const fetchEvents = async () => {
    const res = await fetch('/api/events')
    events.value = await res.json()
  }

  const connectWS = () => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws/events`)

    ws.onopen = () => {
      wsConnected.value = true
    }
    ws.onclose = () => {
      wsConnected.value = false
      setTimeout(connectWS, 3000) // reconnect
    }
    ws.onmessage = (msg) => {
      const payload = JSON.parse(msg.data)
      if (payload.type === 'event') {
        events.value.unshift(payload.data)
        if (events.value.length > 200) events.value.pop()
      } else if (payload.type === 'event_update') {
        const target = events.value.find((e) => e.event_id === payload.data.event_id)
        if (target) {
          target._status = payload.data._status
          if (payload.data._completed_at) target._completed_at = payload.data._completed_at
        }
      }
    }
  }

  return { events, wsConnected, fetchEvents, connectWS }
})
