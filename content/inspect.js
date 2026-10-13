'use strict'

// Burg Inspect: overlay on the page.
//
// Three modes, switched with the toolbar at the bottom or with a key:
//   I  inspect: card with font, sizes and colors; click = pin, after that
//      hovering another element shows the spacing between them
//   R  ruler: drag a rectangle, snaps to element edges (Alt = free)
//   ·  idle: the page works normally, only the grid and toolbar stay on it
// G and B turn the column grid and the baseline grid on or off.
//
// Injected each time (after lib/i18n.js and lib/style.js).
// window.__burgInspectRequest says what to do: 'inspect', 'ruler', 'grid'
// (columns on/off), 'show' (only make sure the overlay is there) or 'toggle'
// (keyboard shortcut).
;(() => {
  const request = window.__burgInspectRequest || 'toggle'
  delete window.__burgInspectRequest
  if (window.__burgInspect) {
    window.__burgInspect.handle(request)
    return
  }

  const S = self.BurgStyle
  const { num } = S
  const ACCENT = '#F2E14C'
  const MEASURE = '#FF5C1A'
  const SNAP = 6
  const DEFAULT_GRID = { columns: 12, gutter: 24, maxWidth: 1280, margin: 16, baseline: 8, columnsOn: false, baselineOn: false }

  let mode = 'inspect' // 'inspect' | 'ruler' | 'idle'
  let grid = { ...DEFAULT_GRID }
  let hovered = null
  let selected = null
  let x = -1
  let y = -1
  let ruler = null // { x1, y1, x2, y2 } in page coordinates
  let dragging = false
  let barTop = false
  let raf = 0
  let stopped = false
  let cardFor = null

  // ---------------------------------------------------------------------------
  // UI in a closed shadow root
  // ---------------------------------------------------------------------------

  const host = document.createElement('burg-inspect')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      /* all:initial on the host beats :host, so font and color are set per component */
      .card, .bar, .tip, .toast, .tag { font: 12px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #F4F3F0; }
      .abs { position: fixed; left: 0; top: 0; display: none; }
      .mono { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-variant-numeric: tabular-nums; }

      .grid, .baseline { position: fixed; inset: 0; display: none; }
      .grid div { position: absolute; top: 0; bottom: 0; background: rgba(255, 92, 26, .09);
                  border-left: 1px solid rgba(255, 92, 26, .35); border-right: 1px solid rgba(255, 92, 26, .35); }

      .mbox { border: 0 solid rgba(255, 155, 40, .38); }
      .bbox { border: 0 solid rgba(255, 213, 79, .55); }
      .pbox { border: 0 solid rgba(47, 183, 155, .38); background: rgba(46, 107, 255, .22); background-clip: padding-box; }
      .sel { outline: 2px solid ${ACCENT}; box-shadow: 0 0 0 1px rgba(14,14,16,.6), inset 0 0 0 1px rgba(14,14,16,.6); }
      .hov { outline: 1px dashed ${MEASURE}; }
      .tag { padding: 2px 6px; border-radius: 6px; background: #0E0E10; color: #F4F3F0; white-space: nowrap;
             font: 11px/1.4 ui-monospace, 'SFMono-Regular', Menlo, monospace; box-shadow: 0 2px 8px rgba(14,14,16,.3); }
      .tag b { color: ${ACCENT}; font-weight: 500; }

      .measure > div { position: fixed; }
      .ln { background: ${MEASURE}; }
      .ln.dash { background: none; border: 0 dashed ${MEASURE}; }
      .lbl { padding: 1px 5px; border-radius: 4px; background: ${MEASURE}; color: #0E0E10; white-space: nowrap;
             font: 600 11px/1.4 ui-monospace, 'SFMono-Regular', Menlo, monospace; transform: translate(-50%, -50%); }

      .rect { border: 1px solid ${MEASURE}; background: rgba(255, 92, 26, .12); }
      .gx, .gy { background: rgba(255, 92, 26, .7); }
      .gx { width: 1px; top: 0; bottom: 0; }
      .gy { height: 1px; left: 0; right: 0; }

      .card { width: 290px; max-height: calc(100vh - 24px); overflow: auto; padding: 0 0 8px; border-radius: 12px;
              background: #0E0E10; box-shadow: inset 0 3px 0 ${ACCENT}, 0 0 0 1px #2A2A30, 0 8px 28px rgba(14,14,16,.35); }
      .card.pinned { pointer-events: auto; }
      .head { display: flex; align-items: baseline; gap: 8px; padding: 11px 12px 6px; }
      .card.pinned .head { cursor: move; }
      .head .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .head .size { color: #A5A5AD; }
      .sec { margin: 6px 12px 0; padding-top: 6px; border-top: 1px solid #2A2A30; }
      .sec h4 { margin: 0 0 3px; font: 500 10px/1.4 ui-monospace, 'SFMono-Regular', Menlo, monospace; letter-spacing: .09em;
                text-transform: uppercase; color: #A5A5AD; }
      .row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; padding: 1px 0; align-items: baseline; }
      .row .k { color: #A5A5AD; }
      .row .v { min-width: 0; overflow-wrap: anywhere; }
      .font { font-size: 14px; font-weight: 600; }
      .kind { margin-left: 6px; padding: 0 5px; border-radius: 999px; border: 1px solid #2A2A30; color: #A5A5AD;
              font: 500 10px/1.5 ui-monospace, 'SFMono-Regular', Menlo, monospace; vertical-align: 1px; }
      .warn { color: #FFB547; }
      .muted { color: #A5A5AD; }
      .sw { display: inline-block; width: 12px; height: 12px; margin-right: 6px; border-radius: 3px; vertical-align: -1px;
            border: 1px solid rgba(244, 243, 240, .5); }
      .ok { color: #2FB79B; } .bad { color: #F2678C; }
      .acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 12px 0; }
      button { font: inherit; color: inherit; cursor: pointer; }
      .acts button { padding: 4px 10px; border-radius: 999px; border: 1px solid #2A2A30; background: #17171B; }
      .acts button:hover { border-color: #A5A5AD; }
      .acts button.main { background: ${ACCENT}; border-color: ${ACCENT}; color: #0E0E10; font-weight: 600; }
      .hint { margin: 8px 12px 0; color: #A5A5AD; font-size: 11px; }

      .bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 2px;
             padding: 4px; border-radius: 999px; background: #0E0E10; pointer-events: auto; white-space: nowrap;
             box-shadow: 0 0 0 1px #2A2A30, 0 6px 20px rgba(14,14,16,.35); }
      .bar.top { top: 14px; bottom: auto; }
      .bar button { display: flex; align-items: center; gap: 6px; padding: 5px 11px; border: 0; border-radius: 999px; background: none; color: #F4F3F0; }
      .bar button:hover { background: #1F1F25; }
      .bar button.on { background: ${ACCENT}; color: #0E0E10; font-weight: 600; }
      .bar kbd { font: 10px/1 ui-monospace, 'SFMono-Regular', Menlo, monospace; padding: 2px 4px; border-radius: 4px; background: rgba(244,243,240,.14); }
      .bar button.on kbd { background: rgba(14,14,16,.14); }
      .bar .sep { width: 1px; height: 18px; margin: 0 4px; background: #2A2A30; }
      .bar .icon { padding: 5px 9px; color: #A5A5AD; }
      .tip { position: fixed; left: 50%; bottom: 58px; transform: translateX(-50%); padding: 4px 10px; border-radius: 999px;
             background: rgba(14,14,16,.85); color: #A5A5AD; font-size: 11px; white-space: nowrap; transition: opacity .4s; }
      .tip.top { top: 58px; bottom: auto; }
      .tip.fade { opacity: 0; }
      .toast { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); display: none; padding: 7px 14px; border-radius: 999px;
               background: #0E0E10; box-shadow: inset 0 0 0 1px ${ACCENT}, 0 4px 14px rgba(14,14,16,.3); white-space: nowrap; }
      textarea { position: fixed; opacity: 0; }
    </style>
    <div class="grid"></div>
    <div class="baseline"></div>
    <div class="abs mbox"></div>
    <div class="abs bbox"></div>
    <div class="abs pbox"></div>
    <div class="abs sel"></div>
    <div class="abs hov"></div>
    <div class="abs tag"></div>
    <div class="measure"></div>
    <div class="abs rect"></div>
    <div class="abs gx"></div>
    <div class="abs gy"></div>
    <div class="abs tag readout"></div>
    <div class="abs card"></div>
    <div class="tip"></div>
    <div class="bar">
      <button data-act="inspect" title="${t('barInspectTitle')}">${t('actionInspect')} <kbd>I</kbd></button>
      <button data-act="ruler" title="${t('barRulerTitle')}">${t('actionRuler')} <kbd>R</kbd></button>
      <span class="sep"></span>
      <button data-act="columns" title="${t('barColumnsTitle')}">${t('actionGrid')} <kbd>G</kbd></button>
      <button data-act="baseline" title="${t('barBaselineTitle')}">${t('gBaseline')} <kbd>B</kbd></button>
      <span class="sep"></span>
      <button data-act="move" class="icon" title="${t('barMoveTitle')}">⇅</button>
      <button data-act="stop" class="icon" title="${t('barStopTitle')}">✕</button>
    </div>
    <div class="toast"></div>`
  document.documentElement.appendChild(host)

  const q = (sel) => root.querySelector(sel)
  const ui = {
    grid: q('.grid'), baseline: q('.baseline'),
    mbox: q('.mbox'), bbox: q('.bbox'), pbox: q('.pbox'),
    sel: q('.sel'), hov: q('.hov'), tag: q('.tag'), measure: q('.measure'),
    rect: q('.rect'), gx: q('.gx'), gy: q('.gy'), readout: q('.readout'),
    card: q('.card'), tip: q('.tip'), bar: q('.bar'), toast: q('.toast'),
  }

  function make(tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }

  function place(node, left, top, width, height) {
    node.style.display = 'block'
    node.style.left = `${left}px`
    node.style.top = `${top}px`
    if (width !== undefined) node.style.width = `${Math.max(0, width)}px`
    if (height !== undefined) node.style.height = `${Math.max(0, height)}px`
  }
  const hide = (...nodes) => nodes.forEach((n) => (n.style.display = 'none'))

  // ---------------------------------------------------------------------------
  // Grid settings
  // ---------------------------------------------------------------------------

  let pendingGrid = {} // changes made before the stored settings were read

  ;(async () => {
    const { grid: stored } = await chrome.storage.local.get('grid')
    grid = { ...DEFAULT_GRID, ...stored, ...pendingGrid }
    if (Object.keys(pendingGrid).length) saveGrid()
    renderGrid(true)
    renderBar()
  })().catch(() => {})

  const saveGrid = () => chrome.storage.local.set({ grid }).catch(() => {})

  function setGrid(patch) {
    Object.assign(grid, patch)
    Object.assign(pendingGrid, patch)
    saveGrid()
    renderGrid(true)
    renderBar()
  }

  const onStorage = (changes, area) => {
    if (area !== 'local' || !changes.grid) return
    grid = { ...DEFAULT_GRID, ...changes.grid.newValue }
    renderGrid(true)
    renderBar()
  }
  chrome.storage.onChanged.addListener(onStorage)

  let gridKey = ''
  function renderGrid(force) {
    const cw = document.documentElement.clientWidth
    ui.grid.style.display = grid.columnsOn ? 'block' : 'none'
    ui.baseline.style.display = grid.baselineOn ? 'block' : 'none'

    if (grid.columnsOn) {
      const key = JSON.stringify([cw, grid.columns, grid.gutter, grid.maxWidth, grid.margin])
      if (force || key !== gridKey) {
        gridKey = key
        const n = Math.max(1, Math.min(48, Math.round(grid.columns) || 1))
        const container = Math.min(grid.maxWidth > 0 ? grid.maxWidth : cw, cw)
        const inner = container - 2 * Math.max(0, grid.margin)
        const left = (cw - container) / 2 + Math.max(0, grid.margin)
        const width = (inner - Math.max(0, grid.gutter) * (n - 1)) / n
        ui.grid.replaceChildren()
        if (width > 0) {
          for (let i = 0; i < n; i++) {
            const col = make('div')
            col.style.left = `${left + i * (width + grid.gutter)}px`
            col.style.width = `${width}px`
            ui.grid.append(col)
          }
        }
      }
    }
    if (grid.baselineOn) {
      const step = Math.max(2, grid.baseline || 8)
      ui.baseline.style.width = `${cw}px`
      ui.baseline.style.backgroundImage = `repeating-linear-gradient(to bottom, rgba(46,107,255,.32) 0 1px, transparent 1px ${step}px)`
      ui.baseline.style.backgroundPosition = `0 ${-(scrollY % step)}px`
    }
  }

  // ---------------------------------------------------------------------------
  // Toolbar, notification, copying
  // ---------------------------------------------------------------------------

  const TIPS = {
    inspect: t('tipInspect'),
    ruler: t('tipRuler'),
    idle: t('tipIdle'),
  }
  let tipTimer = 0

  function renderBar() {
    for (const button of ui.bar.querySelectorAll('button[data-act]')) {
      const act = button.dataset.act
      const on = act === mode || (act === 'columns' && grid.columnsOn) || (act === 'baseline' && grid.baselineOn)
      button.classList.toggle('on', on)
    }
    ui.bar.classList.toggle('top', barTop)
    ui.tip.classList.toggle('top', barTop)
  }

  function showTip() {
    ui.tip.textContent = TIPS[mode]
    ui.tip.classList.remove('fade')
    clearTimeout(tipTimer)
    tipTimer = setTimeout(() => ui.tip.classList.add('fade'), 5000)
  }

  let toastTimer = 0
  function toast(text) {
    ui.toast.textContent = text
    ui.toast.style.display = 'block'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (ui.toast.style.display = 'none'), 1800)
  }

  async function copy(text, label) {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      root.appendChild(area)
      area.select()
      ok = document.execCommand('copy')
      area.remove()
    }
    toast(ok ? t('copied', label) : t('copyFailed'))
  }

  let cursorOn = false
  function setCursor(on) {
    if (on === cursorOn) return
    cursorOn = on
    chrome.runtime.sendMessage({ type: 'cursor', on }).catch(() => {})
  }

  function setMode(next) {
    mode = next
    if (mode !== 'inspect') selected = hovered = null
    if (mode !== 'ruler') ruler = null
    cardFor = null
    setCursor(mode !== 'idle')
    renderBar()
    showTip()
    schedule()
  }

  function handle(req) {
    if (req === 'show') return // the grid arrives via storage.onChanged
    if (req === 'toggle') return stop()
    if (req === 'grid') return setGrid({ columnsOn: !grid.columnsOn })
    setMode(req)
  }

  // ---------------------------------------------------------------------------
  // Info card
  // ---------------------------------------------------------------------------

  function row(section, key, value) {
    const r = make('div', 'row')
    r.append(make('span', 'k', key))
    const v = make('span', 'v')
    if (value instanceof Node) v.append(value)
    else v.textContent = value
    r.append(v)
    section.append(r)
    return v
  }

  function swatchText(value, suffix = '') {
    const span = make('span', 'mono')
    const sw = make('span', 'sw')
    sw.style.background = value
    span.append(sw, (S.hex(value) || t('transparent')) + suffix)
    return span
  }

  const KIND = { web: t('kindWeb'), local: t('kindLocal'), system: t('kindSystem') }

  function buildCard(el, pinned) {
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const card = ui.card
    card.replaceChildren()
    card.classList.toggle('pinned', pinned)

    const head = make('div', 'head')
    head.append(make('span', 'name mono', S.describe(el)), make('span', 'size mono', `${num(rect.width)} × ${num(rect.height)}`))
    card.append(head)

    // Text
    const text = make('div', 'sec')
    text.append(make('h4', '', t('secText')))
    const font = S.renderedFont(cs.fontFamily)
    const fontValue = make('span')
    fontValue.append(make('span', 'font', font.name), make('span', 'kind', font.loading ? t('loading') : KIND[font.kind]))
    row(text, 'Font', fontValue)
    if (font.missing.length) row(text, t('rowUnavailable'), font.missing.join(', ')).classList.add('warn')
    const stack = S.families(cs.fontFamily)
    if (stack.length > 1 || stack[0] !== font.name) row(text, t('rowStack'), cs.fontFamily).classList.add('muted', 'mono')
    const size = parseFloat(cs.fontSize)
    const lh = cs.lineHeight === 'normal' ? 'normal' : `${num(cs.lineHeight)}px (${num(parseFloat(cs.lineHeight) / size)})`
    row(text, t('rowSize'), `${num(size)}px / ${lh}`).classList.add('mono')
    row(text, t('rowWeight'), `${cs.fontWeight}${cs.fontStyle !== 'normal' ? ` · ${cs.fontStyle}` : ''}`).classList.add('mono')
    if (cs.letterSpacing !== 'normal') row(text, t('rowLetterSpacing'), cs.letterSpacing).classList.add('mono')
    if (cs.textTransform !== 'none') row(text, 'Transform', cs.textTransform).classList.add('mono')
    row(text, t('rowColor'), swatchText(cs.color))
    const bg = S.effectiveBackground(el)
    row(text, t('rowBackground'), swatchText(bg.value, bg.own ? '' : ` ${t('parentSuffix')}`))
    if (S.hasOwnText(el)) {
      const ratio = S.contrast(cs.color, bg.value)
      if (ratio) {
        const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700)
        const level = ratio >= 7 || (large && ratio >= 4.5) ? 'AAA' : ratio >= 4.5 || (large && ratio >= 3) ? 'AA' : ''
        const c = make('span', 'mono')
        c.append(`${ratio.toFixed(2)} : 1 `, make('span', level ? 'ok' : 'bad', level || t('contrastFail')))
        if (bg.partial) c.append(make('span', 'muted', ' ±'))
        row(text, 'Contrast', c)
      }
    }
    card.append(text)

    // Box
    const box = make('div', 'sec')
    box.append(make('h4', '', 'Box'))
    const margin = S.sides(cs, 'margin')
    const padding = S.sides(cs, 'padding')
    const border = S.sides(cs, 'border')
    row(box, 'Margin', S.shorthand(margin)).classList.add('mono')
    row(box, 'Padding', S.shorthand(padding)).classList.add('mono')
    if (border.some(Boolean)) {
      row(box, t('rowBorder'), `${S.shorthand(border)} ${cs.borderTopStyle} `).append(swatchText(cs.borderTopColor))
    }
    const radius = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => cs.getPropertyValue(`border-${c}-radius`))
    if (radius.some((r) => parseFloat(r))) row(box, 'Radius', S.shorthand(radius.map((r) => (r === '0px' ? '0' : r)))).classList.add('mono')
    if (cs.boxShadow !== 'none') row(box, t('rowShadow'), S.shadow(cs.boxShadow)).classList.add('mono')
    card.append(box)

    // Layout
    const layout = make('div', 'sec')
    layout.append(make('h4', '', 'Layout'))
    let display = cs.display
    if (/flex/.test(display)) display += ` · ${cs.flexDirection}${cs.flexWrap !== 'nowrap' ? ` · ${cs.flexWrap}` : ''}`
    if (/grid/.test(display)) display += ` · ${t('gridColumns', cs.gridTemplateColumns.split(' ').length)}`
    row(layout, 'Display', display).classList.add('mono')
    if (/flex|grid/.test(cs.display) && (cs.rowGap !== 'normal' || cs.columnGap !== 'normal')) {
      row(layout, 'Gap', cs.rowGap === cs.columnGap ? cs.rowGap : `${cs.rowGap} ${cs.columnGap}`).classList.add('mono')
    }
    if (cs.position !== 'static') row(layout, 'Position', `${cs.position}${cs.zIndex !== 'auto' ? ` · z ${cs.zIndex}` : ''}`).classList.add('mono')
    if (cs.opacity !== '1') row(layout, 'Opacity', cs.opacity).classList.add('mono')
    card.append(layout)

    if (pinned) {
      const acts = make('div', 'acts')
      const mk = (label, act, main) => {
        const b = make('button', main ? 'main' : '', label)
        b.dataset.act = act
        acts.append(b)
      }
      mk(t('btnCopyCss'), 'copy-css', true)
      mk('Selector', 'copy-sel')
      if (cs.fontFamily) mk('Font', 'copy-font')
      if (el.parentElement && el.parentElement !== document.documentElement) mk(t('btnParent'), 'parent')
      card.append(acts)
      card.append(make('div', 'hint', t('cardHint')))
    }
    cardFor = el
  }

  let cardPos = null // pinned card: its own position after dragging

  function positionCard(pinned) {
    const card = ui.card
    card.style.display = 'block'
    const w = card.offsetWidth
    const h = card.offsetHeight
    let left
    let top
    if (pinned) {
      left = cardPos ? cardPos.left : innerWidth - w - 16
      top = cardPos ? cardPos.top : 16
    } else {
      left = x + 20
      top = y + 20
      if (left + w > innerWidth - 8) left = x - 20 - w
      if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - 8 - h)
    }
    card.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`
    card.style.top = `${Math.max(8, Math.min(top, innerHeight - 40))}px`
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function schedule() {
    if (!raf && !stopped) raf = requestAnimationFrame(render)
  }

  function drawBoxModel(el) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const [mt, mr, mb, ml] = S.sides(cs, 'margin').map((v) => Math.max(0, v))
    const [bt, br, bb, bl] = S.sides(cs, 'border')
    const [pt, pr, pb, pl] = S.sides(cs, 'padding')
    place(ui.mbox, r.left - ml, r.top - mt, r.width + ml + mr, r.height + mt + mb)
    ui.mbox.style.borderWidth = `${mt}px ${mr}px ${mb}px ${ml}px`
    place(ui.bbox, r.left, r.top, r.width, r.height)
    ui.bbox.style.borderWidth = `${bt}px ${br}px ${bb}px ${bl}px`
    place(ui.pbox, r.left + bl, r.top + bt, r.width - bl - br, r.height - bt - bb)
    ui.pbox.style.borderWidth = `${pt}px ${pr}px ${pb}px ${pl}px`
  }

  function drawTag(el) {
    const r = el.getBoundingClientRect()
    ui.tag.replaceChildren(make('b', '', S.describe(el)), ` ${num(r.width)} × ${num(r.height)}`)
    ui.tag.style.display = 'block'
    const h = ui.tag.offsetHeight
    const w = ui.tag.offsetWidth
    const top = r.top - h - 4 >= 0 ? r.top - h - 4 : Math.min(r.bottom + 4, innerHeight - h - 4)
    place(ui.tag, Math.max(4, Math.min(r.left, innerWidth - w - 4)), top)
  }

  function outline(node, el) {
    const r = el.getBoundingClientRect()
    place(node, r.left, r.top, r.width, r.height)
  }

  // Distance lines
  function line(x1, y1, x2, y2, dashed) {
    const horizontal = y1 === y2
    const node = make('div', dashed ? 'ln dash' : 'ln')
    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    node.style.left = `${left}px`
    node.style.top = `${top}px`
    if (horizontal) {
      node.style.width = `${Math.abs(x2 - x1)}px`
      node.style.height = '1px'
      if (dashed) node.style.borderTopWidth = '1px'
    } else {
      node.style.width = '1px'
      node.style.height = `${Math.abs(y2 - y1)}px`
      if (dashed) node.style.borderLeftWidth = '1px'
    }
    ui.measure.append(node)
  }

  function label(cx, cy, value) {
    if (value < 0.5) return
    const node = make('div', 'lbl', num(value))
    node.style.left = `${cx}px`
    node.style.top = `${cy}px`
    ui.measure.append(node)
  }

  /**
   * Dimension line along one axis. axis 'x': from x=from to x=to at height at.
   * If the line lies beside element B (other), add a dashed line from the
   * end point (end) to the nearest edge of B.
   */
  function gap(axis, from, to, at, other, end) {
    if (to - from < 0.5) return
    if (axis === 'x') {
      line(from, at, to, at)
      label((from + to) / 2, at, to - from)
      if (other && (at < other.top || at > other.bottom)) line(end, at, end, at < other.top ? other.top : other.bottom, true)
    } else {
      line(at, from, at, to)
      label(at, (from + to) / 2, to - from)
      if (other && (at < other.left || at > other.right)) line(at, end, at < other.left ? other.left : other.right, end, true)
    }
  }

  function drawDistances(a, b) {
    const A = a.getBoundingClientRect()
    const B = b.getBoundingClientRect()
    const inside = (o, i) => o.left <= i.left && o.right >= i.right && o.top <= i.top && o.bottom >= i.bottom
    if (inside(B, A) || inside(A, B)) {
      const [outer, inner] = inside(B, A) ? [B, A] : [A, B]
      const cx = inner.left + inner.width / 2
      const cy = inner.top + inner.height / 2
      gap('y', outer.top, inner.top, cx)
      gap('y', inner.bottom, outer.bottom, cx)
      gap('x', outer.left, inner.left, cy)
      gap('x', inner.right, outer.right, cy)
      return
    }
    const vOverlap = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top)
    const hOverlap = Math.min(A.right, B.right) - Math.max(A.left, B.left)
    const atY = vOverlap > 0 ? Math.max(A.top, B.top) + vOverlap / 2 : A.top + A.height / 2
    const atX = hOverlap > 0 ? Math.max(A.left, B.left) + hOverlap / 2 : A.left + A.width / 2
    if (B.left >= A.right) gap('x', A.right, B.left, atY, B, B.left)
    else if (B.right <= A.left) gap('x', B.right, A.left, atY, B, B.right)
    if (B.top >= A.bottom) gap('y', A.bottom, B.top, atX, B, B.top)
    else if (B.bottom <= A.top) gap('y', B.bottom, A.top, atX, B, B.bottom)
    // If they overlap without containing each other: difference per edge
    if (vOverlap > 0 && hOverlap > 0) {
      const cx = atX
      const cy = atY
      if (Math.abs(B.top - A.top) >= 0.5) gap('y', Math.min(A.top, B.top), Math.max(A.top, B.top), cx)
      if (Math.abs(B.bottom - A.bottom) >= 0.5) gap('y', Math.min(A.bottom, B.bottom), Math.max(A.bottom, B.bottom), cx)
      if (Math.abs(B.left - A.left) >= 0.5) gap('x', Math.min(A.left, B.left), Math.max(A.left, B.left), cy)
      if (Math.abs(B.right - A.right) >= 0.5) gap('x', Math.min(A.right, B.right), Math.max(A.right, B.right), cy)
    }
  }

  function drawRuler() {
    const cw = document.documentElement.clientWidth
    if (x >= 0 && !overUi) {
      place(ui.gx, x, 0)
      place(ui.gy, 0, y, cw)
      ui.readout.textContent = `x ${num(x)} · y ${num(y)}`
      place(ui.readout, Math.min(x + 12, cw - 110), Math.min(y + 12, innerHeight - 26))
    } else hide(ui.gx, ui.gy, ui.readout)

    if (!ruler) return hide(ui.rect)
    const left = Math.min(ruler.x1, ruler.x2) - scrollX
    const top = Math.min(ruler.y1, ruler.y2) - scrollY
    const w = Math.abs(ruler.x2 - ruler.x1)
    const h = Math.abs(ruler.y2 - ruler.y1)
    place(ui.rect, left, top, w, h)
    const lbl = make('div', 'lbl', `${num(w)} × ${num(h)}`)
    const inside = w > 70 && h > 22
    lbl.style.left = `${left + w / 2}px`
    lbl.style.top = `${inside ? top + h / 2 : top + h + 12}px`
    ui.measure.append(lbl)
  }

  let overUi = false

  function render() {
    raf = 0
    ui.measure.replaceChildren()
    renderGrid(false)
    if (selected && !selected.isConnected) selected = null
    if (hovered && !hovered.isConnected) hovered = null

    if (mode !== 'ruler') hide(ui.rect, ui.gx, ui.gy, ui.readout)
    if (mode !== 'inspect') {
      hide(ui.mbox, ui.bbox, ui.pbox, ui.sel, ui.hov, ui.tag, ui.card)
      if (mode === 'ruler') drawRuler()
      return
    }

    const target = selected || hovered
    if (!target) {
      hide(ui.mbox, ui.bbox, ui.pbox, ui.sel, ui.hov, ui.tag, ui.card)
      return
    }
    drawBoxModel(target)

    if (selected) {
      outline(ui.sel, selected)
      if (cardFor !== selected || !ui.card.classList.contains('pinned')) buildCard(selected, true)
      positionCard(true)
      const other = hovered && hovered !== selected && !overUi ? hovered : null
      if (other) {
        outline(ui.hov, other)
        drawTag(other)
        drawDistances(selected, other)
      } else {
        hide(ui.hov)
        drawTag(selected)
      }
    } else {
      hide(ui.sel, ui.hov)
      drawTag(hovered)
      if (overUi) return hide(ui.card)
      if (cardFor !== hovered || ui.card.classList.contains('pinned')) buildCard(hovered, false)
      positionCard(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /** Element under the cursor, also inside open shadow roots of the page. */
  function elementAt(px, py) {
    let el = document.elementFromPoint(px, py)
    if (!el || el === host) return null
    while (el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(px, py)
      if (!inner || inner === el) break
      el = inner
    }
    return el
  }

  function snapPoint(px, py, free) {
    if (free) return [px, py]
    const xs = [0, document.documentElement.clientWidth]
    const ys = [0, innerHeight]
    // Elements under and right next to the cursor, so you also snap to an edge you are just outside of
    const nodes = new Set()
    for (const [dx, dy] of [[0, 0], [-SNAP, 0], [SNAP, 0], [0, -SNAP], [0, SNAP]]) {
      const el = elementAt(px + dx, py + dy)
      if (el) nodes.add(el).add(el.parentElement)
    }
    for (const node of nodes) {
      if (!node || node === document.documentElement) continue
      const r = node.getBoundingClientRect()
      xs.push(r.left, r.right)
      ys.push(r.top, r.bottom)
      const cs = getComputedStyle(node)
      const [pt, pr, pb, pl] = S.sides(cs, 'padding')
      const [bt, br, bb, bl] = S.sides(cs, 'border')
      xs.push(r.left + bl + pl, r.right - br - pr)
      ys.push(r.top + bt + pt, r.bottom - bb - pb)
    }
    const near = (v, list) => list.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), Infinity)
    const sx = near(px, xs)
    const sy = near(py, ys)
    return [Math.abs(sx - px) <= SNAP ? sx : px, Math.abs(sy - py) <= SNAP ? sy : py]
  }

  const fromUi = (event) => event.composedPath().includes(host)
  const block = (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function isEditable(event) {
    const t = event.composedPath()[0]
    return t instanceof Element && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  }

  function navigate(key) {
    const from = selected || hovered
    if (!from) return
    let next = null
    if (key === 'ArrowUp') next = from.parentElement
    else if (key === 'ArrowDown') next = from.firstElementChild
    else if (key === 'ArrowLeft') next = from.previousElementSibling
    else if (key === 'ArrowRight') next = from.nextElementSibling
    if (next && next !== document.documentElement && next !== host) {
      selected = next
      hovered = null
      const r = next.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight) next.scrollIntoView({ block: 'center', behavior: 'smooth' })
      schedule()
    }
  }

  function copySelected(what) {
    const el = selected || hovered
    if (!el) return
    if (what === 'css') copy(S.cssFor(el), 'CSS')
    else if (what === 'sel') copy(S.selector(el), 'Selector')
    else if (what === 'font') copy(`font-family: ${getComputedStyle(el).fontFamily};`, 'font-family')
  }

  const handlers = {
    mousemove(event) {
      x = event.clientX
      y = event.clientY
      overUi = fromUi(event)
      if (cardDrag) {
        cardPos = { left: x - cardDrag.dx, top: y - cardDrag.dy }
        positionCard(true)
        return
      }
      if (mode === 'inspect' && !overUi) hovered = elementAt(x, y) || hovered
      if (mode === 'ruler' && dragging && ruler) {
        const [sx, sy] = snapPoint(x, y, event.altKey)
        ruler.x2 = sx + scrollX
        ruler.y2 = sy + scrollY
      }
      if (mode !== 'idle') schedule()
    },
    mousedown(event) {
      if (fromUi(event) || mode === 'idle') return
      block(event)
      if (mode === 'ruler' && event.button === 0) {
        const [sx, sy] = snapPoint(event.clientX, event.clientY, event.altKey)
        ruler = { x1: sx + scrollX, y1: sy + scrollY, x2: sx + scrollX, y2: sy + scrollY }
        dragging = true
        schedule()
      }
    },
    mouseup(event) {
      if (cardDrag) {
        cardDrag = null
        return
      }
      if (fromUi(event) || mode === 'idle') return
      block(event)
      if (mode === 'ruler' && dragging) {
        dragging = false
        if (ruler && Math.abs(ruler.x2 - ruler.x1) < 2 && Math.abs(ruler.y2 - ruler.y1) < 2) ruler = null
        schedule()
      }
    },
    click(event) {
      if (fromUi(event) || mode === 'idle') return
      block(event)
      if (mode === 'inspect' && event.button === 0) {
        const el = elementAt(event.clientX, event.clientY)
        if (el) {
          selected = el
          hovered = null
          schedule()
        }
      }
    },
    contextmenu(event) {
      if (fromUi(event) || mode === 'idle') return
      block(event)
      escape()
    },
    keydown(event) {
      if (isEditable(event) || event.metaKey || event.ctrlKey) return
      const key = event.key
      if (key === 'Escape') {
        block(event)
        return escape()
      }
      if (event.altKey) return
      const letter = key.length === 1 ? key.toLowerCase() : ''
      if (letter === 'i') setMode(mode === 'inspect' ? 'idle' : 'inspect')
      else if (letter === 'r') setMode(mode === 'ruler' ? 'idle' : 'ruler')
      else if (letter === 'g') setGrid({ columnsOn: !grid.columnsOn })
      else if (letter === 'b') setGrid({ baselineOn: !grid.baselineOn })
      else if (letter === 'c' && mode === 'inspect') copySelected('css')
      else if (letter === 's' && mode === 'inspect') copySelected('sel')
      else if (key.startsWith('Arrow') && mode === 'inspect' && (selected || hovered)) navigate(key)
      else return
      block(event)
    },
    scroll: schedule,
    resize: schedule,
  }
  for (const type of ['pointerdown', 'pointerup', 'dblclick', 'auxclick']) {
    handlers[type] = (event) => {
      if (fromUi(event) || mode === 'idle') return
      // preventDefault() on pointer events would suppress the mouse events the ruler needs
      if (type.startsWith('pointer')) event.stopImmediatePropagation()
      else block(event)
    }
  }

  function escape() {
    if (mode === 'inspect' && selected) {
      selected = null
      cardPos = null
      cardFor = null
      schedule()
    } else if (mode === 'ruler' && ruler) {
      ruler = null
      schedule()
    } else stop()
  }

  for (const [type, fn] of Object.entries(handlers)) {
    window.addEventListener(type, fn, { capture: true, passive: type === 'scroll' || type === 'resize' })
  }

  // Clicks in our own UI (toolbar and pinned card)
  let cardDrag = null
  root.addEventListener('mousedown', (event) => {
    event.stopPropagation()
    const head = event.target.closest?.('.head')
    if (head && ui.card.classList.contains('pinned')) {
      const r = ui.card.getBoundingClientRect()
      cardDrag = { dx: event.clientX - r.left, dy: event.clientY - r.top }
      event.preventDefault()
    }
  })
  root.addEventListener('click', (event) => {
    event.stopPropagation()
    const act = event.target.closest?.('[data-act]')?.dataset.act
    if (!act) return
    if (act === 'inspect' || act === 'ruler') setMode(mode === act ? 'idle' : act)
    else if (act === 'columns') setGrid({ columnsOn: !grid.columnsOn })
    else if (act === 'baseline') setGrid({ baselineOn: !grid.baselineOn })
    else if (act === 'move') {
      barTop = !barTop
      renderBar()
    } else if (act === 'stop') stop()
    else if (act === 'copy-css') copySelected('css')
    else if (act === 'copy-sel') copySelected('sel')
    else if (act === 'copy-font') copySelected('font')
    else if (act === 'parent') navigate('ArrowUp')
  })
  for (const type of ['pointerdown', 'pointerup', 'mouseup', 'dblclick', 'contextmenu', 'keydown']) {
    root.addEventListener(type, (event) => event.stopPropagation())
  }

  const onFonts = () => {
    S.resetFonts()
    cardFor = null
    schedule()
  }
  document.fonts.addEventListener('loadingdone', onFonts)

  function stop() {
    if (stopped) return
    stopped = true
    delete window.__burgInspect
    for (const [type, fn] of Object.entries(handlers)) window.removeEventListener(type, fn, { capture: true })
    chrome.storage.onChanged.removeListener(onStorage)
    document.fonts.removeEventListener('loadingdone', onFonts)
    cancelAnimationFrame(raf)
    clearTimeout(tipTimer)
    clearTimeout(toastTimer)
    setCursor(false)
    host.remove()
  }

  window.__burgInspect = { handle }

  // Start
  if (request === 'grid') {
    pendingGrid.columnsOn = true
    grid.columnsOn = true
    setMode('idle')
  } else if (request === 'show') setMode('idle')
  else setMode(request === 'ruler' ? 'ruler' : 'inspect')
  renderGrid(true)
})()
