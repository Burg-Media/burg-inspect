'use strict'

// Burg Inspect: fonts of the page.
//
// Per font that is actually rendered: weights, styles, number of elements and
// origin (Google Fonts, Adobe, own @font-face, local or system). Plus the font
// files the page loaded, with their size, and fonts that were requested but
// did not load. Injected after lib/i18n.js and lib/style.js; the result is the
// value of the last expression. The elements per font stay in
// window.__burgInspectRefs so the popup can highlight them.
;(() => {
  const S = self.BurgStyle
  S.resetFonts()
  const MAX_ELEMENTS = 8000
  const MAX_REFS = 300
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'TITLE'])
  const FONT_FILE = /\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i

  const refs = (window.__burgInspectRefs ??= new Map())
  for (const key of [...refs.keys()]) if (key.startsWith('font:')) refs.delete(key)

  // Origin from readable @font-face rules, and from <link>s to font services
  const faceSource = new Map()
  let skippedSheets = 0
  function walk(rules) {
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        const family = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '').toLowerCase()
        const src = rule.style.getPropertyValue('src')
        if (!family || faceSource.has(family)) continue
        const url = /url\(\s*["']?([^"')]+)/.exec(src)?.[1]
        if (!url) faceSource.set(family, /local\(/.test(src) ? t('srcLocalFace') : t('srcOwnFace'))
        else if (url.startsWith('data:')) faceSource.set(family, t('srcEmbedded'))
        else {
          try {
            const u = new URL(url, rule.parentStyleSheet?.href || location.href)
            faceSource.set(family, sourceForHost(u.host) || `${t('srcOwnFace')}${u.host !== location.host ? ` (${u.host})` : ''}`)
          } catch {
            faceSource.set(family, t('srcOwnFace'))
          }
        }
      } else if (rule.cssRules) walk(rule.cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules)
    } catch {
      skippedSheets++
    }
  }

  function sourceForHost(h) {
    if (/fonts\.gstatic\.com|fonts\.googleapis\.com/.test(h)) return 'Google Fonts'
    if (/typekit\.net|use\.typekit|adobe/.test(h)) return 'Adobe Fonts'
    if (/fonts\.bunny\.net/.test(h)) return 'Bunny Fonts'
    if (/fontshare\.com/.test(h)) return 'Fontshare'
    if (/fonts\.com|fast\.fonts\.net/.test(h)) return 'Fonts.com'
    if (/cloud\.typography\.com/.test(h)) return 'Hoefler&Co'
    return ''
  }

  const links = [...document.querySelectorAll('link[href], style')].map((n) => (n.href || n.textContent || '').slice(0, 5000))
  function sourceFor(font) {
    if (font.kind === 'system') return t('srcSystem')
    if (font.kind === 'local') return t('srcInstalled')
    const key = font.name.toLowerCase()
    if (faceSource.has(key)) return faceSource.get(key)
    const plus = font.name.replace(/ /g, '+')
    for (const text of links) {
      if (/fonts\.googleapis\.com/.test(text) && (text.includes(plus) || text.includes(encodeURIComponent(font.name)))) return 'Google Fonts'
      if (/fonts\.bunny\.net/.test(text) && text.toLowerCase().includes(key.replace(/ /g, '-'))) return 'Bunny Fonts'
    }
    if (links.some((t) => /use\.typekit\.net|p\.typekit\.net/.test(t))) return t('srcAdobeLikely')
    return t('srcUnknown')
  }

  const webFamilies = new Set([...document.fonts].map((f) => f.family.replace(/^["']|["']$/g, '').toLowerCase()))

  // Walk through the elements with text
  const fonts = new Map()
  const missing = new Map() // requested but not loaded → what it fell back to
  const all = document.querySelectorAll('body, body *')
  let scanned = 0
  for (const el of all) {
    if (scanned >= MAX_ELEMENTS) break
    if (SKIP.has(el.tagName) || el instanceof SVGElement) continue
    if (!S.hasOwnText(el)) continue
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) continue
    scanned++
    const cs = getComputedStyle(el)
    const font = S.renderedFont(cs.fontFamily)
    let entry = fonts.get(font.name)
    if (!entry) {
      entry = { name: font.name, kind: font.kind, loading: !!font.loading, weights: new Map(), italic: false, count: 0, sizes: new Set(), stacks: new Set() }
      fonts.set(font.name, entry)
    }
    entry.count++
    entry.weights.set(cs.fontWeight, (entry.weights.get(cs.fontWeight) || 0) + 1)
    if (cs.fontStyle !== 'normal') entry.italic = true
    entry.sizes.add(Math.round(parseFloat(cs.fontSize) * 10) / 10)
    if (entry.stacks.size < 4) entry.stacks.add(cs.fontFamily)
    // Only real problems: a web font that didn't load, or the first font of the stack
    const first = S.families(cs.fontFamily)[0]
    for (const name of font.missing) {
      if (name !== first && !webFamilies.has(name.toLowerCase())) continue
      if (!missing.has(name)) missing.set(name, new Set())
      missing.get(name).add(font.name)
    }
    const key = `font:${font.name}`
    let list = refs.get(key)
    if (!list) refs.set(key, (list = []))
    if (list.length < MAX_REFS) list.push(el)
  }

  // Font files that were loaded
  const files = []
  for (const entry of performance.getEntriesByType('resource')) {
    if (!FONT_FILE.test(entry.name) && !/fonts\.gstatic\.com|use\.typekit\.net\/af\//.test(entry.name)) continue
    let u
    try {
      u = new URL(entry.name)
    } catch {
      continue
    }
    files.push({
      url: entry.name,
      host: u.host,
      file: decodeURIComponent(u.pathname.split('/').pop() || u.pathname).slice(0, 80),
      bytes: entry.encodedBodySize || entry.transferSize || 0,
      source: sourceForHost(u.host) || (u.host === location.host ? t('srcOwnServer') : u.host),
    })
  }

  return {
    url: location.href,
    scanned,
    truncated: all.length > MAX_ELEMENTS,
    skippedSheets,
    fonts: [...fonts.values()]
      .sort((a, b) => b.count - a.count)
      .map((f) => ({
        name: f.name,
        kind: f.kind,
        loading: f.loading,
        source: sourceFor(f),
        count: f.count,
        italic: f.italic,
        weights: [...f.weights.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => ({ weight: w, count: n })),
        sizes: [...f.sizes].sort((a, b) => a - b),
        stack: [...f.stacks][0],
      })),
    missing: [...missing.entries()].map(([name, used]) => ({ name, fallback: [...used] })),
    files: files.sort((a, b) => b.bytes - a.bytes),
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
  }
})()
