'use strict'

// Burg Inspect: highlight elements on the page from the popup or the report.
//
// BurgHighlight runs inside the page (via scripting.executeScript({ func })),
// so it has to be self-contained. content/fonts.js or content/inventory.js
// stored the elements per key in window.__burgInspectRefs.

self.BurgHighlight = function highlight(key) {
  const elements = (window.__burgInspectRefs && window.__burgInspectRefs.get(key)) || []
  document.querySelector('burg-inspect-highlight')?.remove()
  const host = document.createElement('burg-inspect-highlight')
  host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;'
  const root = host.attachShadow({ mode: 'closed' })
  let shown = 0
  let first = null
  for (const el of elements) {
    if (!el.isConnected) continue
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    first ??= rect
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;left:${rect.left + scrollX}px;top:${rect.top + scrollY}px;width:${rect.width}px;height:${rect.height}px;outline:2px solid #F2E14C;outline-offset:1px;box-shadow:0 0 0 4px rgba(14,14,16,.55);border-radius:2px;transition:opacity .5s;`
    root.appendChild(box)
    shown++
  }
  if (!shown) return 0
  document.documentElement.appendChild(host)
  if (first && (first.bottom < 0 || first.top > innerHeight)) {
    scrollTo({ top: first.top + scrollY - innerHeight / 3, behavior: 'smooth' })
  }
  setTimeout(() => {
    for (const box of root.children) box.style.opacity = '0'
    setTimeout(() => host.remove(), 500)
  }, 2500)
  return shown
}
