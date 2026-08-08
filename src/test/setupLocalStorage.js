function createStorage() {
  const map = new Map()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => map.delete(String(key)),
    setItem: (key, value) => map.set(String(key), String(value)),
  }
}

if (typeof window !== 'undefined') {
  const storage = createStorage()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })
}
