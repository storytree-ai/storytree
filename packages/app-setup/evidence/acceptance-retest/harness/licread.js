(() => { const t = document.body.innerText; const i = t.indexOf('PolyForm'); return 'license chars=' + t.length + ' polyform=' + (i >= 0) + ' offline-note=' + /available offline/i.test(t); })()
