'use strict'

localizePage()

const $ = (id) => document.getElementById(id)

// Same defaults as in content/inspect.js
const DEFAULT_GRID = { columns: 12, gutter: 24, maxWidth: 1280, margin: 16, baseline: 8, columnsOn: false, baselineOn: false }
const NUMBER_FIELDS = ['columns', 'gutter', 'maxWidth', 'margin', 'baseline']

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

let toastTimer = 0
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => ($('toast').hidden = true), 1500)
}

function showError(text) {
  $('error').textContent = text
  $('error').hidden = !text
}

function make(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const kb = (bytes) => (bytes ? `${bytes < 10240 ? (bytes / 1024).toFixed(1) : Math.round(bytes / 1024)} KB` : '? KB')
const CANT = t('errCant')

;(async () => {
  const tab = await activeTab()
  try {
    if (tab?.url) $('host').textContent = new URL(tab.url).host || t('popupSubtitle')
  } catch {}
  const [command] = (await chrome.commands.getAll()).filter((c) => c.name === 'inspect')
  $('shortcut').textContent = command?.shortcut || t('noShortcut')
})().catch(() => {})

// chrome:// links don't open from a normal <a>
$('shortcuts').addEventListener('click', (event) => {
  event.preventDefault()
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
})

// ---------------------------------------------------------------------------
// Start the overlay
// ---------------------------------------------------------------------------

async function start(request, keepOpen = false) {
  try {
    const tab = await activeTab()
    const response = await chrome.runtime.sendMessage({ type: 'start', tabId: tab?.id, request })
    if (response?.ok) keepOpen || window.close()
    else showError(response?.error || CANT)
  } catch {
    showError(CANT)
  }
}

$('inspect').addEventListener('click', () => start('inspect'))
$('ruler').addEventListener('click', () => start('ruler'))
$('grid').addEventListener('click', () => start('grid'))

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

function renderFonts(result, tabId) {
  $('fonts-meta').textContent = t(result.fonts.length === 1 ? 'fontsMeta1' : 'fontsMetaN', result.fonts.length, `${result.scanned}${result.truncated ? '+' : ''}`)
  const list = $('fonts-list')
  list.replaceChildren()
  if (!result.fonts.length) list.append(make('p', 'muted small', t('noText')))

  for (const font of result.fonts) {
    const button = make('button', 'font')
    button.title = font.stack || ''
    const top = make('div', 'top')
    top.append(make('span', 'name', font.name), make('span', 'count', `${font.count}×`))
    const meta = make('div', 'meta')
    meta.append(make('span', 'pill src', font.loading ? t('fontLoading', font.source) : font.source))
    for (const { weight } of font.weights) meta.append(make('span', 'pill', weight))
    if (font.italic) meta.append(make('span', 'pill', 'italic'))
    const sizes = make('div', 'sizes', font.sizes.map((s) => `${s}`).join(' · ') + ' px')
    button.append(top, meta, sizes)
    button.addEventListener('click', () => {
      chrome.scripting
        .executeScript({ target: { tabId }, func: self.BurgHighlight, args: [`font:${font.name}`] })
        .then(([r]) => toast(r?.result ? t(r.result === 1 ? 'highlighted1' : 'highlightedN', r.result) : t('nothingVisible')))
        .catch(() => toast(t('pageChanged')))
    })
    list.append(button)
  }

  $('missing').hidden = !result.missing.length
  $('missing').replaceChildren(
    ...result.missing.map((m) => make('div', '', t('missingFont', m.name, m.fallback.join(', '))))
  )

  $('files-wrap').hidden = !result.files.length
  $('files-sum').textContent = t(result.files.length === 1 ? 'fontFiles1' : 'fontFilesN', result.files.length, kb(result.totalBytes))
  $('files').replaceChildren(
    ...result.files.map((f) => {
      const row = make('div', 'file')
      row.title = f.url
      row.append(make('span', 'fname', f.file), make('span', 'fsrc', f.source), make('span', 'fsize', kb(f.bytes)))
      return row
    })
  )
  $('fonts-section').hidden = false
}

$('fonts').addEventListener('click', async () => {
  const tab = await activeTab()
  $('fonts').disabled = true
  showError('')
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/i18n.js', 'lib/style.js', 'content/fonts.js'],
    })
    if (!result) throw new Error()
    renderFonts(result, tab.id)
  } catch {
    showError(CANT)
  } finally {
    $('fonts').disabled = false
  }
})

// ---------------------------------------------------------------------------
// Style inventory → report in its own tab
// ---------------------------------------------------------------------------

$('inventory').addEventListener('click', async () => {
  const tab = await activeTab()
  $('inventory').disabled = true
  showError('')
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/i18n.js', 'lib/style.js', 'content/inventory.js'],
    })
    if (!result) throw new Error()
    await chrome.storage.session.set({ [`inventory:${tab.id}`]: { result, tabId: tab.id, at: Date.now() } })
    await chrome.tabs.create({ url: chrome.runtime.getURL(`report/report.html?tab=${tab.id}`), index: tab.index + 1 })
    window.close()
  } catch {
    showError(CANT)
    $('inventory').disabled = false
  }
})

// ---------------------------------------------------------------------------
// Grid settings (the overlay picks up changes via storage.onChanged)
// ---------------------------------------------------------------------------

let grid = { ...DEFAULT_GRID }

function fillGrid() {
  for (const name of NUMBER_FIELDS) $(`g-${name}`).value = grid[name]
  $('g-columnsOn').checked = grid.columnsOn
  $('g-baselineOn').checked = grid.baselineOn
}

async function saveGrid(patch) {
  grid = { ...grid, ...patch }
  await chrome.storage.local.set({ grid })
}

;(async () => {
  const { grid: stored } = await chrome.storage.local.get('grid')
  grid = { ...DEFAULT_GRID, ...stored }
  fillGrid()
})().catch(() => {})

for (const name of NUMBER_FIELDS) {
  $(`g-${name}`).addEventListener('input', (event) => {
    const value = Number(event.target.value)
    if (Number.isFinite(value) && event.target.value !== '') saveGrid({ [name]: value })
  })
}
// Turning it on also starts the overlay (idle), so you see the grid right away
async function toggleGrid(patch, on) {
  await saveGrid(patch)
  if (on) start('show', true)
}
$('g-columnsOn').addEventListener('change', (e) => toggleGrid({ columnsOn: e.target.checked }, e.target.checked))
$('g-baselineOn').addEventListener('change', (e) => toggleGrid({ baselineOn: e.target.checked }, e.target.checked))
for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', () => {
    const [columns, gutter, maxWidth, margin] = button.dataset.preset.split(',').map(Number)
    toggleGrid({ columns, gutter, maxWidth, margin, columnsOn: true }, true)
    fillGrid()
    toast(t('gridUpdated'))
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.grid) {
    grid = { ...DEFAULT_GRID, ...changes.grid.newValue }
    if (!document.activeElement?.matches('input[type="number"]')) fillGrid()
  }
})
