// ============================================================
// DropAnalytics Overlay - script en el MUNDO de la pagina (world: MAIN)
// Intercepta las respuestas de products/v4/index que la propia app
// de Dropi recibe (fetch y XHR) y las reenvia al content script
// por postMessage. Esto nos da ID, nombre, precios y proveedor
// EXACTOS de cada producto mostrado, sin parsear el DOM.
// ============================================================
(function () {
  const send = (text, via) => {
    try { console.log('[DP MAIN] capturado via ' + via + ' len=' + String(text).length); } catch (e) {}
    try { window.postMessage({ __dpanalytics: true, type: 'products', text: String(text).substring(0, 3000000) }, '*'); } catch (e) {}
  };
  // --- fetch ---
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const u = typeof args[0] === 'string' ? args[0] : ((args[0] && args[0].url) || '');
        if (u.includes('products/v4/index')) { const c = res.clone(); c.text().then(t => send(t, 'fetch')).catch(e2 => { try { console.log('[DP MAIN] clone.text err: ' + e2.message); } catch (e3) {} }); }
      } catch (e) {}
      return res;
    };
  }
  // --- XMLHttpRequest ---
  const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XHR) {
    const origOpen = XHR.open;
    XHR.open = function (method, url) { this.__dpUrl = url; return origOpen.apply(this, arguments); };
    const origSend = XHR.send;
    XHR.send = function () {
      const xhr = this;
      xhr.addEventListener('load', function () {
        try {
          const u = String(xhr.__dpUrl || '');
          if (u.includes('products/v4/index') && xhr.responseText) send(xhr.responseText);
        } catch (e) {}
      });
      return origSend.apply(this, arguments);
    };
  }
  console.log('[DP MAIN] fetch/XHR parcheados');
})();
