// Minimal DOM stand-in: useSettings applies a theme at module load, and finance
// imports it. No jsdom in this project and none is being added for an audit.
;(globalThis as unknown as { document: unknown }).document = {
  documentElement: { dataset: {} as Record<string, string>, style: { setProperty() {} } },
}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null, setItem() {}, removeItem() {},
}
