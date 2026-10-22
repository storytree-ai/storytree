// Contract 4.4's Windows run (increment_341abe802574): read, or press, the gear's update button in the
// installed app's own window, through the Chrome DevTools Protocol of an app started with
// --remote-debugging-port=<port>. The click is the button's own (the page's [data-app-updates]), so
// the request goes through the app's IPC to its release updater exactly as a user's click does.
//   node gear.mjs <port> status   print the button's text and the status panel's phase and words
//   node gear.mjs <port> click    open the gear, press the button, then print as status does
const [port, verb = "status"] = process.argv.slice(2);
if (port === undefined) throw new Error("usage: gear.mjs <port> [status|click]");

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((target) => target.type === "page");
if (page === undefined) throw new Error(`no page on port ${port}: ${JSON.stringify(pages)}`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const evaluate = (expression) => new Promise((resolve, reject) => {
  const ask = ++id;
  socket.addEventListener("message", function answer(event) {
    const message = JSON.parse(event.data);
    if (message.id !== ask) return;
    socket.removeEventListener("message", answer);
    if (message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails)));
    else resolve(message.result?.result?.value);
  });
  socket.send(JSON.stringify({ id: ask, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
});

const read = `(() => {
  const button = document.querySelector("[data-app-updates]");
  const status = document.querySelector("#app-update-status");
  return { at: new Date().toISOString(), button: button?.textContent ?? null, disabled: button?.disabled ?? null,
    phase: status?.dataset.phase ?? null, words: status?.textContent ?? null };
})()`;
if (verb === "click") {
  console.log(JSON.stringify({ before: await evaluate(read) }));
  await evaluate(`(() => { document.querySelector("[data-app-updates]").click(); return true; })()`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log(JSON.stringify(await evaluate(read)));
socket.close();
