const DIALOG_KEYS = [
  'DialogDrawTool',
  'DialogModifyDraw',
  'DialogTooltip',
  'DialogSelectRect',
  'DialogSearchIndex',
  'DialogModifyIndexParam',
]

let activeDialogTitle = null

export function installHqDialogDragTracker(container, doc = globalThis.document) {
  if (!doc?.addEventListener) return () => {}

  const onMouseDown = (event) => {
    for (const key of DIALOG_KEYS) {
      const dialog = container?.[key]
      if (dialog?.DivDialog?.contains?.(event.target)) {
        activeDialogTitle = dialog
        return
      }
    }
  }
  const onMouseUp = () => {
    releaseOwnedDialogDrag(activeDialogTitle, doc)
  }

  doc.addEventListener('mousedown', onMouseDown, true)
  doc.addEventListener('mouseup', onMouseUp, true)
  return () => {
    doc.removeEventListener('mousedown', onMouseDown, true)
    doc.removeEventListener('mouseup', onMouseUp, true)
    if (DIALOG_KEYS.some((key) => container?.[key] === activeDialogTitle)) activeDialogTitle = null
  }
}

export function releaseHqDialogDrags(container, doc = globalThis.document) {
  for (const key of DIALOG_KEYS) {
    const dialog = container?.[key]
    if (!dialog?.DragTitle) continue

    if (dialog === activeDialogTitle) releaseOwnedDialogDrag(dialog, doc)
    else dialog.DragTitle = null
  }
}

function releaseOwnedDialogDrag(dialog, doc) {
  if (!dialog?.DragTitle) {
    activeDialogTitle = null
    return
  }
  if (typeof dialog.DocOnMouseUpTitle === 'function') bestEffort(() => dialog.DocOnMouseUpTitle({}))
  dialog.DragTitle = null
  // HQChart's ModifyIndexParam dialog clears this.onmousemove instead of
  // document.onmousemove. Clear the tracked owner explicitly, while never
  // touching a newer drag owned by another chart instance.
  doc.onmousemove = null
  doc.onmouseup = null
  activeDialogTitle = null
}

export function destroyHqChartSafely(
  chart,
  element,
  { releaseDialogTracker = () => {}, releaseWheel = () => {} } = {},
) {
  const ownsHost = !element || element.JSChart === chart

  bestEffort(releaseWheel)
  bestEffort(() => releaseHqDialogDrags(chart?.JSChartContainer))
  bestEffort(() => chart?.StopAutoUpdate?.())
  // A late destroy from an old adapter must not tear down a newer chart that
  // already owns the same host.
  if (ownsHost) bestEffort(() => chart?.ChartDestroy?.())
  bestEffort(releaseDialogTracker)

  if (!element || !ownsHost) return ownsHost
  bestEffort(() => element.replaceChildren())
  bestEffort(() => delete element.JSChart)
  for (const key of Object.keys(element.dataset ?? {})) {
    if (key.startsWith('hq')) bestEffort(() => delete element.dataset[key])
  }
  return true
}

function bestEffort(cleanup) {
  try {
    cleanup()
  } catch {
    // Third-party cleanup is intentionally isolated so the remaining teardown
    // and the original application error can continue unchanged.
  }
}
