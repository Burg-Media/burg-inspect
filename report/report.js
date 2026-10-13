'use strict'

// Burg Inspect: style inventory report.
//
// The popup puts the result of content/inventory.js in storage.session under
// 'inventory:<tabId>' and opens this page with ?tab=<tabId>. Clicking
// highlights the elements in that tab (as long as the activeTab access lasts).

localizePage()

const $ = (id) => document.getElementById(id)
const tabId = Number(new URLSearchParams(location.search).get('tab'))
const storageKey = `inventory:${tabId}`
let data = null

function make(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

let toastTimer = 0
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 1800)
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('copied', label))
  } catch {
    toast(t('copyFailed'))
  }
}

async function point(key) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: self.BurgHighlight, args: [key] })
    toast(r?.result ? t(r.result === 1 ? 'highlightedTab1' : 'highlightedTabN', r.result) : t('nothingVisible'))
  } catch {
    toast(t('unreachable'))
  }
}

const plural = (n, one, more) => `${n} ${n === 1 ? one : more}`

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function stat(value, label, flag) {
  const box = make('div', flag ? 'stat flag' : 'stat')
  box.append(make('b', '', String(value)), make('span', '', label))
  return box
}

function chip(text, count, key, off) {
  const button = make('button', off ? 'chip off' : 'chip')
  button.append(text, make('small', '', `${count}×`))
  button.addEventListener('click', () => point(key))
  return button
}

function swatch(hex, count, key) {
  const button = make('button', 'sw')
  button.title = t('swatchTitle')
  const color = make('div', 'chipcolor')
  color.style.background = hex
  const lbl = make('div', 'lbl')
  lbl.append(hex, make('small', '', `${count}×`))
  button.append(color, lbl)
  button.addEventListener('click', () => {
    copy(hex, hex)
    point(key)
  })
  return button
}

function render() {
  const r = data.result
  document.title = t('reportTitle', r.title || r.url)
  $('page').textContent = r.url
  $('page').title = `${r.title}\n${r.url}`

  const onGrid = r.spacing.filter((s) => Number(s.value) % 4 === 0)
  $('stats').replaceChildren(
    stat(r.textTotal, t('statText'), r.textTotal > 20),
    stat(r.sizes.length, t('statSizes'), r.sizes.length > 10),
    stat(r.colors.length, t('statColors'), r.colors.length > 12),
    stat(r.backgrounds.length, t('statBgs')),
    stat(r.spacing.length, t('statSpacing'), r.spacing.length > 16),
    stat(r.radii.length, t('statRadii')),
    stat(r.shadows.length, t('statShadows'))
  )
  const when = new Date(data.at).toLocaleString(t('lang'), { dateStyle: 'medium', timeStyle: 'short' })
  $('note').textContent = t('note', `${r.scanned}${r.truncated ? '+' : ''}`, when)

  // Text styles
  $('c-text').textContent = r.textTotal > r.text.length ? t('countOf', r.text.length, r.textTotal) : String(r.textTotal)
  $('text').replaceChildren(
    ...r.text.map((t) => {
      const tr = make('tr')
      const sample = make('td', 'sample', t.sample || 'Aa Bb Cc')
      sample.style.fontFamily = t.family
      sample.style.fontSize = `${Math.min(t.size, 40)}px`
      sample.style.fontWeight = t.weight
      if (t.italic) sample.style.fontStyle = 'italic'
      if (t.transform !== 'none') sample.style.textTransform = t.transform
      if (t.letterSpacing !== 'normal') sample.style.letterSpacing = t.letterSpacing
      sample.title = t.sample
      const extras = [t.italic ? 'italic' : '', t.transform !== 'none' ? t.transform : '', t.letterSpacing !== 'normal' ? `ls ${t.letterSpacing}` : '']
        .filter(Boolean)
        .join(' · ')
      const font = make('td')
      font.append(make('div', 'fontname', t.font))
      if (extras) font.append(make('div', 'mono', extras))
      const tags = make('td')
      for (const tag of t.tags) tags.append(make('span', 'tagpill', tag))
      tr.append(
        sample,
        font,
        make('td', 'mono', `${t.size} / ${t.lineHeight}`),
        make('td', 'mono', t.weight),
        tags,
        make('td', 'num mono', String(t.count))
      )
      tr.addEventListener('click', () => point(`text:${t.value}`))
      return tr
    })
  )

  $('c-sizes').textContent = String(r.sizes.length)
  $('sizes').replaceChildren(...r.sizes.map((s) => chip(`${s.value}px`, s.count, `size:${s.value}`)))

  $('c-colors').textContent = String(r.colors.length)
  $('colors').replaceChildren(...r.colors.map((c) => swatch(c.value, c.count, `color:${c.value}`)))
  $('c-bgs').textContent = String(r.backgrounds.length)
  $('bgs').replaceChildren(...r.backgrounds.map((c) => swatch(c.value, c.count, `bg:${c.value}`)))

  $('c-spacing').textContent = String(r.spacing.length)
  $('grid-fit').textContent = r.spacing.length
    ? t('gridFit', onGrid.length, r.spacing.length)
    : t('noSpacing')
  $('spacing').replaceChildren(
    ...r.spacing.map((s) => {
      const kinds = s.kinds.map((k) => ({ margin: 'm', padding: 'p', gap: 'g' })[k]).join('')
      return chip(`${s.value}px ${kinds}`, s.count, `space:${s.value}`, Number(s.value) % 4 !== 0)
    })
  )

  $('c-radii').textContent = String(r.radii.length)
  $('radii').replaceChildren(
    ...(r.radii.length ? r.radii.map((s) => chip(/%/.test(s.value) ? s.value : `${s.value}px`, s.count, `radius:${s.value}`)) : [make('p', 'hint', t('noRadii'))])
  )

  $('c-shadows').textContent = String(r.shadows.length)
  $('shadows').replaceChildren(
    ...(r.shadows.length
      ? r.shadows.map((s) => {
          const button = make('button', 'shadow')
          const demo = make('div', 'demo')
          demo.style.boxShadow = s.value
          button.append(demo, make('code', '', s.value), make('small', '', `${s.count}×`))
          button.addEventListener('click', () => {
            copy(`box-shadow: ${s.value};`, 'box-shadow')
            point(`shadow:${s.value}`)
          })
          return button
        })
      : [make('p', 'hint', t('noShadows'))])
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function tokens() {
  const r = data.result
  const lines = [`/* ${t('tokensHeader', r.url)} */`, ':root {']
  const group = (title, list) => {
    if (!list.length) return
    lines.push(`  /* ${title} */`)
    list.forEach(([name, value]) => lines.push(`  --${name}: ${value};`))
  }
  const stacks = [...new Map(r.text.map((t) => [t.font, t.family])).values()]
  group('Fonts', stacks.map((f, i) => [`font-${i + 1}`, f]))
  group(t('tokSizes'), r.sizes.map((s, i) => [`font-size-${i + 1}`, `${s.value}px`]))
  group(t('tokColors'), r.colors.map((c, i) => [`color-text-${i + 1}`, c.value]))
  group(t('secBgs'), r.backgrounds.map((c, i) => [`color-bg-${i + 1}`, c.value]))
  group(t('secSpacing'), r.spacing.filter((s) => Number(s.value) > 0).map((s, i) => [`space-${i + 1}`, `${s.value}px`]))
  group('Radius', r.radii.map((s, i) => [`radius-${i + 1}`, /%/.test(s.value) ? s.value : `${s.value}px`]))
  group(t('secShadows'), r.shadows.map((s, i) => [`shadow-${i + 1}`, s.value]))
  lines.push('}')
  return lines.join('\n')
}

$('tokens').addEventListener('click', () => data && copy(tokens(), t('cssVariables')))
$('json').addEventListener('click', () => data && copy(JSON.stringify(data.result, null, 2), 'JSON'))

$('again').addEventListener('click', async () => {
  $('again').disabled = true
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/i18n.js', 'lib/style.js', 'content/inventory.js'],
    })
    if (!result) throw new Error()
    data = { result, tabId, at: Date.now() }
    await chrome.storage.session.set({ [storageKey]: data })
    render()
    toast(t('reanalyzed'))
  } catch {
    toast(t('unreachable'))
  } finally {
    $('again').disabled = false
  }
})

;(async () => {
  const stored = (await chrome.storage.session.get(storageKey))[storageKey]
  if (!stored) {
    for (const id of ['stats', 'note', 'sec-text', 'sec-sizes', 'sec-spacing']) $(id).hidden = true
    for (const node of document.querySelectorAll('.two')) node.hidden = true
    for (const id of ['again', 'json', 'tokens']) $(id).disabled = true
    $('empty').hidden = false
    return
  }
  data = stored
  render()
})()
