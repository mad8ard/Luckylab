export function nextNonOverlappingSignalIndex(terminalIndex) {
  if (!Number.isInteger(terminalIndex) || terminalIndex < 0) {
    throw new TypeError('terminalIndex must be a non-negative integer')
  }
  return terminalIndex + 1
}
