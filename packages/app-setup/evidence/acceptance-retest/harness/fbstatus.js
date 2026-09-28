(() => { const s = [...document.querySelectorAll('[role=status], .status, output, p')].map(e => e.textContent.trim()).filter(x => /draft|browser|copy/i.test(x)); return s.join(' || '); })()
