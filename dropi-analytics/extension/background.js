// DropAnalytics Overlay - service worker: puente de fetch (evita CORS del content script)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'fetch' && msg.url) {
    fetch(msg.url)
      .then(r => r.json())
      .then(j => sendResponse({ ok: true, data: j }))
      .catch(e => sendResponse({ ok: false, err: String(e && e.message || e) }));
    return true; // respuesta asincrona
  }
  return false;
});
