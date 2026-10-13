'use strict'

// Burg Inspect: service worker
//
// Starts the overlay (inspect, ruler, grid) in the active tab and sets a
// crosshair cursor on the page while measuring.

importScripts('lib/i18n.js')

const CURSOR_CSS = 'html, html * { cursor: crosshair !important; }'

function flashError(tabId, message) {
  chrome.action.setBadgeBackgroundColor({ color: '#F2678C', tabId })
  chrome.action.setBadgeTextColor({ color: '#0E0E10', tabId })
  chrome.action.setBadgeText({ text: '!', tabId })
  chrome.action.setTitle({ title: `${t('extName')}: ${message}`, tabId })
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId })
    chrome.action.setTitle({ title: t('extName'), tabId })
  }, 6000)
}

/** request: 'inspect' | 'ruler' | 'grid' | 'show' | 'toggle' (see content/inspect.js) */
async function start(tabId, request) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (req) => (window.__burgInspectRequest = req),
      args: [request],
    })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/i18n.js', 'lib/style.js', 'content/inspect.js'] })
    return { ok: true }
  } catch {
    const error = t('errBlocked')
    flashError(tabId, error)
    return { ok: false, error }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'start':
      start(message.tabId, message.request).then(sendResponse)
      return true
    case 'cursor': {
      if (!sender.tab) return false
      const details = { target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, css: CURSOR_CSS }
      const action = message.on ? chrome.scripting.insertCSS(details) : chrome.scripting.removeCSS(details)
      action.catch(() => {})
      return false
    }
  }
  return false
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'inspect') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) start(tab.id, 'toggle')
})

// Burg Media: welcome page after installing, short page after removing.
// Only UTM tags in the URL, nothing else is sent.
const SITE = 'https://burgmedia.eu/extensies/burg-inspect/'
const utm = (campaign) => '?utm_source=burg-inspect&utm_medium=extension&utm_campaign=' + campaign
chrome.runtime.setUninstallURL(SITE + 'verwijderd/' + utm('uninstall'))
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: SITE + 'welkom/' + utm('install') })
})
