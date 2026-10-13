'use strict'

// Burg Inspect: style inventory of the page.
//
// Counts all text styles (font + size + weight + line height), font sizes,
// colors, spacing (margin, padding, gap), border radii and shadows of visible
// elements. Injected after lib/i18n.js and lib/style.js; the result is the
// value of the last expression. The elements per value stay in
// window.__burgInspectRefs so the report can highlight them.
;(() => {
  const S = self.BurgStyle
  S.resetFonts()
  const MAX_ELEMENTS = 10000
  const MAX_REFS = 300
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'BR', 'WBR'])
  const PREFIXES = ['text:', 'size:', 'color:', 'bg:', 'space:', 'radius:', 'shadow:']

  const refs = (window.__burgInspectRefs ??= new Map())
  for (const key of [...refs.keys()]) if (PREFIXES.some((p) => key.startsWith(p))) refs.delete(key)

  const maps = { text: new Map(), size: new Map(), color: new Map(), bg: new Map(), space: new Map(), radius: new Map(), shadow: new Map() }

  /** Counts a value and remembers the element (once per element per key). */
  function add(kind, value, el, extra) {
    const key = `${kind}:${value}`
    let entry = maps[kind].get(value)
    if (!entry) {
      entry = { value, count: 0, ...extra }
      maps[kind].set(value, entry)
    }
    if (seen.has(key)) return entry
    seen.add(key)
    entry.count++
    let list = refs.get(key)
    if (!list) refs.set(key, (list = []))
    if (list.length < MAX_REFS) list.push(el)
    return entry
  }

  let seen = new Set() // keys the current element already counted
  const round = (n) => Math.round(n * 2) / 2

  const all = document.querySelectorAll('body, body *')
  let scanned = 0
  for (const el of all) {
    if (scanned >= MAX_ELEMENTS) break
    if (SKIP.has(el.tagName) || el instanceof SVGElement) continue
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) continue
    scanned++
    seen = new Set()
    const cs = getComputedStyle(el)

    if (S.hasOwnText(el)) {
      const font = S.renderedFont(cs.fontFamily).name
      const size = round(parseFloat(cs.fontSize))
      const lh = cs.lineHeight === 'normal' ? 'normal' : S.num(round(parseFloat(cs.lineHeight)))
      const key = [font, size, cs.fontWeight, lh, cs.fontStyle, cs.textTransform, cs.letterSpacing].join('|')
      const entry = add('text', key, el, {
        font, size, weight: cs.fontWeight, lineHeight: lh, italic: cs.fontStyle !== 'normal',
        transform: cs.textTransform, letterSpacing: cs.letterSpacing, family: cs.fontFamily, sample: '', tags: {},
      })
      entry.tags[el.localName] = (entry.tags[el.localName] || 0) + 1
      if (!entry.sample) entry.sample = S.ownText(el, 70)
      add('size', size, el)
      const color = S.hex(cs.color)
      if (color) add('color', color, el)
    }

    const bg = S.hex(cs.backgroundColor)
    if (bg) add('bg', bg, el)

    for (const prop of ['margin', 'padding']) {
      for (const v of S.sides(cs, prop)) if (v) add('space', round(v), el, { kinds: {} }).kinds[prop] = true
    }
    if (/flex|grid/.test(cs.display)) {
      for (const g of new Set([cs.rowGap, cs.columnGap])) {
        const v = parseFloat(g)
        if (v) add('space', round(v), el, { kinds: {} }).kinds.gap = true
      }
    }

    const radius = parseFloat(cs.borderTopLeftRadius) || parseFloat(cs.borderTopRightRadius) || parseFloat(cs.borderBottomLeftRadius)
    if (radius) add('radius', /%/.test(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : round(radius), el)
    if (cs.boxShadow !== 'none') add('shadow', S.shadow(cs.boxShadow), el)
  }

  const byCount = (map) => [...map.values()].sort((a, b) => b.count - a.count)
  const byValue = (map) => [...map.values()].sort((a, b) => parseFloat(a.value) - parseFloat(b.value))

  const text = byCount(maps.text).map((t) => ({
    ...t,
    tags: Object.entries(t.tags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag),
  }))
  // Largest text first, like a type scale
  text.sort((a, b) => b.size - a.size || parseInt(b.weight, 10) - parseInt(a.weight, 10) || b.count - a.count)

  return {
    url: location.href,
    title: document.title,
    scanned,
    truncated: all.length > MAX_ELEMENTS,
    text: text.slice(0, 120),
    textTotal: text.length,
    sizes: byValue(maps.size),
    colors: byCount(maps.color).slice(0, 80),
    backgrounds: byCount(maps.bg).slice(0, 80),
    spacing: byValue(maps.space).map((s) => ({ ...s, kinds: Object.keys(s.kinds) })),
    radii: byValue(maps.radius),
    shadows: byCount(maps.shadow).slice(0, 30),
  }
})()
