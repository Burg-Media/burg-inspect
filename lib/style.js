'use strict'

// Burg Inspect: shared helpers for the scripts in the page.
//
// Colors to HEX, the font that is actually rendered, short descriptions and
// selectors of elements, and "Copy CSS" (only what differs from the default).
// Injected before content/*.js (after lib/i18n.js); injecting it again is
// harmless.

self.BurgStyle ??= (() => {
  const GENERIC = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji', 'fangsong',
    'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont',
  ])
  const SYSTEM_NAMES = { '-apple-system': 'system-ui', blinkmacsystemfont: 'system-ui' }

  // ---------------------------------------------------------------------------
  // Numbers and colors
  // ---------------------------------------------------------------------------

  /** '16.6667px' → '16.67' (without unit), '0px' → '0' */
  function num(value) {
    const n = typeof value === 'number' ? value : parseFloat(value)
    if (!Number.isFinite(n)) return String(value)
    return String(Math.round(n * 100) / 100)
  }

  const hex2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0').toUpperCase()

  /** Reads rgb()/rgba() (both syntaxes). Returns { r, g, b, a } or null. */
  function parseRgb(value) {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(String(value).trim())
    if (!m) return null
    let a = m[4] === undefined ? 1 : parseFloat(m[4])
    if (m[4]?.endsWith('%')) a /= 100
    return { r: +m[1], g: +m[2], b: +m[3], a }
  }

  /** 'rgb(14, 14, 16)' → '#0E0E10'; transparent → null; other notations (oklch …) are left as they are. */
  function hex(value) {
    if (!value || value === 'transparent') return null
    const c = parseRgb(value)
    if (!c) return value
    if (c.a === 0) return null
    return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ''}`
  }

  /** Replaces every rgb()/rgba() in a value (shadows, gradients, borders) with HEX. */
  function hexAll(value) {
    return String(value).replace(/rgba?\([^()]*\)/gi, (m) => hex(m) || 'transparent')
  }

  /** Splits on commas outside parentheses: 'a, rgb(1, 2, 3) b' → ['a', 'rgb(1, 2, 3) b'] */
  function splitTop(value) {
    const parts = []
    let depth = 0
    let start = 0
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        parts.push(value.slice(start, i).trim())
        start = i + 1
      }
    }
    parts.push(value.slice(start).trim())
    return parts
  }

  /** Chrome puts the color first in box-shadow; the way you would write it, it goes last. */
  function shadow(value) {
    if (!value || value === 'none') return value
    return splitTop(value)
      .map((part) => {
        const m = /^(rgba?\([^()]*\)|#[0-9a-f]+|transparent)\s+(.*)$/i.exec(part)
        return m ? `${m[2]} ${hex(m[1]) || 'transparent'}` : hexAll(part)
      })
      .join(', ')
  }

  function luminance({ r, g, b }) {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }

  /** WCAG contrast between two rgb() values; null if either one can't be read. */
  function contrast(fg, bg) {
    const a = parseRgb(fg)
    const b = parseRgb(bg)
    if (!a || !b) return null
    // Blend semi-transparent text over the background
    const mix = { r: a.r * a.a + b.r * (1 - a.a), g: a.g * a.a + b.g * (1 - a.a), b: a.b * a.a + b.b * (1 - a.a) }
    const l1 = luminance(mix)
    const l2 = luminance(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }

  /** First non-transparent background color of the element or an ancestor. */
  function effectiveBackground(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const c = parseRgb(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) return { value: getComputedStyle(node).backgroundColor, own: node === el, partial: c.a < 1 }
    }
    return { value: 'rgb(255, 255, 255)', own: false, partial: false }
  }

  // ---------------------------------------------------------------------------
  // Fonts
  // ---------------------------------------------------------------------------

  /** '"Geist Mono", Inter, sans-serif' → ['Geist Mono', 'Inter', 'sans-serif'] */
  function families(fontFamily) {
    const out = []
    for (const part of String(fontFamily).match(/"[^"]*"|'[^']*'|[^,]+/g) || []) {
      const name = part.trim().replace(/^["']|["']$/g, '').trim()
      if (name) out.push(name)
    }
    return out
  }

  let faceIndex = null
  function faces() {
    if (faceIndex) return faceIndex
    faceIndex = new Map()
    for (const face of document.fonts) {
      const key = face.family.replace(/^["']|["']$/g, '').toLowerCase()
      if (!faceIndex.has(key)) faceIndex.set(key, [])
      faceIndex.get(key).push(face)
    }
    return faceIndex
  }

  const installedCache = new Map()
  let measureCtx = null
  /** Installed locally? Compares the text width with generic fallback families. */
  function installed(family) {
    const key = family.toLowerCase()
    if (installedCache.has(key)) return installedCache.get(key)
    measureCtx ??= new OffscreenCanvas(10, 10).getContext('2d')
    const text = 'mmmmmmmmmmlli1WQ@#'
    let found = false
    for (const fallback of ['monospace', 'serif', 'sans-serif']) {
      measureCtx.font = `72px ${fallback}`
      const base = measureCtx.measureText(text).width
      measureCtx.font = `72px "${family.replace(/"/g, '')}", ${fallback}`
      if (measureCtx.measureText(text).width !== base) {
        found = true
        break
      }
    }
    installedCache.set(key, found)
    return found
  }

  const renderedCache = new Map()

  /** Look again after web fonts load (pages often load them later). */
  function resetFonts() {
    faceIndex = null
    renderedCache.clear()
  }

  /**
   * Which font from the font-family stack is actually used?
   * → { name, kind: 'web' | 'local' | 'system', loading, missing: [names that were skipped] }
   * Approximation: the first web font with a loaded variant, otherwise the
   * first locally installed one, otherwise the first generic family.
   */
  function renderedFont(fontFamily) {
    if (renderedCache.has(fontFamily)) return renderedCache.get(fontFamily)
    const missing = []
    let result = null
    for (const family of families(fontFamily)) {
      const key = family.toLowerCase()
      if (GENERIC.has(key)) {
        result = { name: SYSTEM_NAMES[key] || family, kind: 'system' }
        break
      }
      const list = faces().get(key)
      if (list) {
        if (list.some((f) => f.status === 'loaded')) {
          result = { name: family, kind: 'web' }
          break
        }
        if (list.some((f) => f.status === 'loading')) {
          result = { name: family, kind: 'web', loading: true }
          break
        }
        missing.push(family)
        continue
      }
      if (installed(family)) {
        result = { name: family, kind: 'local' }
        break
      }
      missing.push(family)
    }
    result ??= { name: t('defaultFont'), kind: 'system' }
    result.missing = missing
    renderedCache.set(fontFamily, result)
    return result
  }

  // ---------------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------------

  /** div#main.card.large */
  function describe(el) {
    if (!el || el.nodeType !== 1) return ''
    let text = el.localName
    if (el.id) text += `#${el.id}`
    const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || ''
    const classes = cls.trim().split(/\s+/).filter(Boolean)
    if (classes.length) text += `.${classes.slice(0, 2).join('.')}${classes.length > 2 ? '…' : ''}`
    return text.length > 60 ? `${text.slice(0, 59)}…` : text
  }

  /** Unique CSS selector, as short as is reasonable. */
  function selector(el) {
    if (!el || el.nodeType !== 1) return ''
    const parts = []
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(node.id)}`)
        break
      }
      if (node === document.body || node === document.documentElement) {
        parts.unshift(node.localName)
        break
      }
      let part = CSS.escape(node.localName)
      const cls = (typeof node.className === 'string' ? node.className : '').trim().split(/\s+/).filter(Boolean)
      const stable = cls.filter((c) => !/\d{3,}|^(is|has)-|active|hover|focus/.test(c)).slice(0, 2)
      if (stable.length) part += stable.map((c) => `.${CSS.escape(c)}`).join('')
      const parent = node.parentElement
      if (parent) {
        const same = [...parent.children].filter((c) => c.matches(part))
        if (same.length > 1) {
          const index = [...parent.children].filter((c) => c.localName === node.localName).indexOf(node) + 1
          part += `:nth-of-type(${index})`
        }
      }
      parts.unshift(part)
      const sel = parts.join(' > ')
      try {
        if (document.querySelectorAll(sel).length === 1 && parts.length >= 1 && document.querySelector(sel) === el) return sel
      } catch {
        /* unusual class names */
      }
    }
    return parts.join(' > ')
  }

  /** Does the element have its own (non-empty) text? */
  function hasOwnText(el) {
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return true
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && /\S/.test(node.nodeValue)) return true
    }
    return false
  }

  function ownText(el, max = 60) {
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) return el.value || el.placeholder || ''
    let text = ''
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue
    text = text.replace(/\s+/g, ' ').trim()
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
  }

  const SIDES = ['top', 'right', 'bottom', 'left']

  /** [top, right, bottom, left] as px numbers for margin/padding/border-width */
  function sides(cs, prop) {
    return SIDES.map((s) => parseFloat(cs.getPropertyValue(prop === 'border' ? `border-${s}-width` : `${prop}-${s}`)) || 0)
  }

  /** [8,16,8,16] → '8px 16px' */
  function shorthand(values, unit = 'px') {
    const v = values.map((n) => (typeof n === 'number' ? (n ? num(n) + unit : '0') : n))
    if (v[1] === v[3]) {
      if (v[0] === v[2]) return v[0] === v[1] ? v[0] : `${v[0]} ${v[1]}`
      return `${v[0]} ${v[1]} ${v[2]}`
    }
    return v.join(' ')
  }

  // ---------------------------------------------------------------------------
  // Copy CSS
  // ---------------------------------------------------------------------------

  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
    'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio', 'overflow-x', 'overflow-y',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self',
    'justify-items', 'justify-self', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow',
    'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'row-gap', 'column-gap',
    '@margin', '@padding', '@border', '@radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-transform', 'text-decoration-line', 'white-space',
    'opacity', 'box-shadow', 'transform', 'filter', 'backdrop-filter', 'mix-blend-mode', 'cursor',
  ]
  const TYPE_PROPS = new Set(['color', 'font-family', 'font-size', 'font-weight', 'line-height'])
  const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

  /** Computed style of a bare element with the same tag, isolated from the page's CSS. */
  function defaultStyle(el) {
    const host = document.createElement('div')
    host.style.cssText = 'all:initial;position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;'
    const root = host.attachShadow({ mode: 'closed' })
    const twin = el.namespaceURI === 'http://www.w3.org/1999/xhtml'
      ? document.createElement(el.localName)
      : document.createElementNS(el.namespaceURI, el.localName)
    root.appendChild(twin)
    document.documentElement.appendChild(host)
    const cs = getComputedStyle(twin)
    const copy = {}
    for (const name of cs) copy[name] = cs.getPropertyValue(name)
    host.remove()
    return copy
  }

  function cssFor(el) {
    const cs = getComputedStyle(el)
    const def = defaultStyle(el)
    const differs = (name) => cs.getPropertyValue(name) !== def[name]
    const text = hasOwnText(el)
    const lines = []
    const rect = el.getBoundingClientRect()
    lines.push(`/* ${describe(el)} · ${num(rect.width)} × ${num(rect.height)} px */`)

    for (const prop of PROPS) {
      if (prop === '@margin' || prop === '@padding') {
        const name = prop.slice(1)
        if (SIDES.some((s) => differs(`${name}-${s}`))) {
          lines.push(`${name}: ${shorthand(SIDES.map((s) => cs.getPropertyValue(`${name}-${s}`)).map((v) => (v === '0px' ? '0' : v)))};`)
        }
        continue
      }
      if (prop === '@border') {
        const per = SIDES.map((s) => ({
          w: cs.getPropertyValue(`border-${s}-width`),
          s: cs.getPropertyValue(`border-${s}-style`),
          c: hex(cs.getPropertyValue(`border-${s}-color`)) || 'transparent',
        }))
        const visible = per.map((b) => b.s !== 'none' && parseFloat(b.w) > 0)
        if (!visible.some(Boolean)) continue
        const same = per.every((b) => b.w === per[0].w && b.s === per[0].s && b.c === per[0].c)
        if (same) lines.push(`border: ${per[0].w} ${per[0].s} ${per[0].c};`)
        else per.forEach((b, i) => visible[i] && lines.push(`border-${SIDES[i]}: ${b.w} ${b.s} ${b.c};`))
        continue
      }
      if (prop === '@radius') {
        const values = CORNERS.map((c) => cs.getPropertyValue(`border-${c}-radius`))
        if (values.every((v) => parseFloat(v) === 0)) continue
        if (values.some((v) => v.includes(' '))) values.forEach((v, i) => lines.push(`border-${CORNERS[i]}-radius: ${v};`))
        else lines.push(`border-radius: ${shorthand(values.map((v) => (v === '0px' ? '0' : v)))};`)
        continue
      }
      const value = cs.getPropertyValue(prop)
      if (!differs(prop) && !(text && TYPE_PROPS.has(prop))) continue
      if (prop === 'background-color' && !hex(value)) continue
      // Only relevant in the right context
      if (/^(top|right|bottom|left|z-index)$/.test(prop) && cs.position === 'static') continue
      if (/^(flex-direction|flex-wrap|justify-content|align-items|align-content)$/.test(prop) && !/flex|grid/.test(cs.display)) continue
      if (/^(grid-template|grid-auto-flow|justify-items)/.test(prop) && !/grid/.test(cs.display)) continue
      if (/^(row-gap|column-gap)$/.test(prop) && !/flex|grid/.test(cs.display) && cs.columnCount === 'auto') continue
      if (/^background-(size|position|repeat)$/.test(prop) && cs.backgroundImage === 'none') continue
      if (/^min-(width|height)$/.test(prop) && value === 'auto') continue
      if (prop === 'white-space' && value === 'normal') continue
      lines.push(`${prop}: ${prop === 'box-shadow' ? shadow(value) : hexAll(value)};`)
    }
    return lines.join('\n')
  }

  return {
    num, hex, hexAll, shadow, parseRgb, contrast, effectiveBackground,
    families, renderedFont, resetFonts, describe, selector, hasOwnText, ownText, sides, shorthand, cssFor,
  }
})()
