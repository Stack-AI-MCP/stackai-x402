'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

/** Discriminated union matching the gateway notification worker's publish schema. */
type NotificationEvent =
  | {
      type: 'payment'
      serverId: string
      tool: string
      amount: string
      token: string
      fromAddress: string
      txid: string
      timestamp: number
    }
  | {
      type: 'error-rate-alert'
      serverId: string
      errorRate: number
      timestamp: number
    }

function formatNotification(event: NotificationEvent): string {
  if (event.type === 'payment') {
    return `Payment: ${event.amount} ${event.token} for ${event.tool}`
  }
  const pct = (event.errorRate * 100).toFixed(1)
  return `Alert: ${pct}% error rate on ${event.serverId}`
}

/**
 * Subscribes to real-time SSE notifications for a server.
 *
 * Opens an EventSource connection to `/api/notifications/stream?serverId=...`
 * and fires sonner toasts for incoming events. The browser's native EventSource
 * handles auto-reconnection on disconnect (AC4).
 */
export function useNotifications(serverId: string | null) {
  useEffect(() => {
    if (!serverId) return

    const eventSource = new EventSource(`/api/notifications/stream?serverId=${serverId}`)

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as NotificationEvent
        if (event.type === 'error-rate-alert') {
          toast.error(formatNotification(event))
        } else {
          toast.success(formatNotification(event))
        }
      } catch {
        // Ignore unparseable messages
      }
    }

    return () => {
      eventSource.close()
    }
  }, [serverId])
}
