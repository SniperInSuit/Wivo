/**
 * Node 20 has no global WebSocket, and supabase-js refuses to construct its
 * realtime client without one — so any test that imports a module which
 * imports lib/supabase failed at load, before a single assertion ran. Tests
 * never open a socket; a stand-in that is never connected is enough. Node 22+
 * has the real one and this does nothing there.
 */
if (typeof globalThis.WebSocket === 'undefined') {
  class TestWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = 3
    close(): void {}
    send(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  ;(globalThis as { WebSocket?: unknown }).WebSocket = TestWebSocket
}
