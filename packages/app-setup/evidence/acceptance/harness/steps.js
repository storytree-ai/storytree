// Loaded before each step: helpers on window.st. Each step file calls one of them.
window.st = {
  byText(text, root = document) {
    return [...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim() === text);
  },
  async sleep(ms) { await new Promise((ok) => setTimeout(ok, ms)); },
  async menu(item) {
    const gear = document.querySelector("button.app-gear");
    if (document.querySelector("#app-menu")?.hidden !== false) gear.click();
    await this.sleep(400);
    const b = this.byText(item, document.querySelector("#app-menu-host") || document);
    if (!b) return `menu item ${item} not found`;
    b.click();
    await this.sleep(800);
    return `opened ${item}`;
  },
  async project(name) {
    await this.menu("Projects");
    const s = document.querySelector("select#project");
    const options = [...s.options].map((o) => o.value).join(",");
    s.value = name;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    await this.sleep(5000);
    return `options=${options} | now state=${document.body.dataset.state} project=${document.body.dataset.project}`;
  },
  closeMenu() { const c = this.byText("Close app menu"); if (c && c.offsetParent) c.click(); return "closed"; },
};
"helpers loaded";
