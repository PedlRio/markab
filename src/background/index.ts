import type { ExtensionMessage } from '../types'

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, _sender: chrome.runtime.MessageSender, sendResponse) => {
    const message = rawMessage as ExtensionMessage

    switch (message.type) {
      case 'GET_VAULT_STATUS': {
        const response: Extract<ExtensionMessage, { type: 'VAULT_STATUS_RESPONSE' }> = {
          type: 'VAULT_STATUS_RESPONSE',
          payload: { connected: false, lastSyncedAt: null },
        }
        sendResponse(response)
        return true
      }
      default:
        return false
    }
  },
)
