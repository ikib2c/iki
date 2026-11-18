// popup de DropAnalytics Overlay
const srvEl = document.getElementById('srv');
const prodEl = document.getElementById('prod');
const badEl = document.getElementById('bad');
const onEl = document.getElementById('on');

chrome.storage.local.get(['dpOn'], v => { onEl.checked = v.dpOn !== false; });
onEl.addEventListener('change', () => {
  chrome.storage.local.set({ dpOn: onEl.checked });
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.reload(tabs[0].id);
  });
});

const getSrv = () => new Promise(resolve => {
  try {
    chrome.runtime.sendMessage({ type: 'fetch', url: 'http://localhost:3777/api/ping' }, r => {
      if (chrome.runtime.lastError || !r || !r.ok) return resolve(null);
      resolve(r.data);
    });
  } catch (e) { resolve(null); }
});

getSrv().then(j => {
  if (j && j.ok) { srvEl.textContent = 'OK · ' + j.productos + ' prods'; srvEl.style.color = '#3fb950'; }
  else { srvEl.textContent = 'APAGADO'; srvEl.style.color = '#f85149'; }
});

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (!tabs[0] || !tabs[0].id) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: 'stats' }, resp => {
    if (chrome.runtime.lastError) return;
    if (resp) {
      prodEl.textContent = resp.live || 0;
      badEl.textContent = resp.badges || 0;
    }
  });
});
