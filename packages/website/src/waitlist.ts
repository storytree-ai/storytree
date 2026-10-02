type Answers = { email: string; computer?: string; agent?: string };
type Outcome = "joined" | "invalid" | "refused" | "rate-limited" | "failed";

/** A browser-only, same-origin insert. No owner key or read/update/delete path enters the page. */
export async function submitWaitlist(answers: Answers, key: string, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<Outcome> {
  const email = answers.email.trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || (answers.computer && !["windows", "mac", "linux"].includes(answers.computer))
    || (answers.agent && !["claude-code", "codex", "other"].includes(answers.agent))) return "invalid";
  try {
    const response = await fetch("./.herenow/data/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ email, ...(answers.computer ? { computer: answers.computer } : {}), ...(answers.agent ? { agent: answers.agent } : {}) }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (response.status === 429) return "rate-limited";
    if (!response.ok) return response.status >= 400 && response.status < 500 ? "refused" : "failed";
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || !("record" in result)) return "failed";
    const record = result.record;
    return typeof record === "object" && record !== null && "id" in record && typeof record.id === "string" && record.id.length > 0 ? "joined" : "failed";
  } catch {
    return "failed";
  }
}

const messages: Record<Outcome, string> = {
  joined: "You’re on the waitlist. Mick will email you once, when your invitation is ready.",
  invalid: "Enter a valid email address and choose from the options shown. Your answers are still here.",
  refused: "Your sign-up was not accepted. Check your email and try again, or message Mick on LinkedIn. Your answers are still here.",
  "rate-limited": "Too many attempts. Please try again later, or message Mick on LinkedIn. Your answers are still here.",
  failed: "We couldn’t confirm your sign-up. Please try again, or message Mick on LinkedIn. Your answers are still here.",
};

export function wireWaitlist(form: HTMLFormElement): void {
  const button = form.querySelector<HTMLButtonElement>("#waitlist-submit");
  const status = form.querySelector<HTMLElement>("#waitlist-status");
  const email = form.querySelector<HTMLInputElement>("#waitlist-email");
  if (!button || !status || !email) return;
  let previous = "";
  let key = "";
  form.noValidate = true;
  form.hidden = false;
  form.dataset.waitlistState = "idle";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (form.dataset.waitlistState === "pending" || form.dataset.waitlistState === "joined") return;
    const data = new FormData(form);
    const answers = { email: email.value, computer: String(data.get("computer") ?? ""), agent: String(data.get("agent") ?? "") };
    const serialized = JSON.stringify({ ...answers, email: answers.email.trim() });
    if (serialized !== previous) { key = crypto.randomUUID(); previous = serialized; }
    form.dataset.waitlistState = "pending";
    form.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Joining…";
    status.textContent = "Sending your sign-up…";
    // Preserve the submitted values while waiting, without moving keyboard focus off the button.
    const inputs = [...form.querySelectorAll<HTMLInputElement>("input")];
    inputs.forEach(input => { input.disabled = true; });
    const outcome = await submitWaitlist(answers, key);
    form.dataset.waitlistState = outcome;
    form.removeAttribute("aria-busy");
    status.textContent = messages[outcome];
    button.textContent = outcome === "joined" ? "You’re on the waitlist" : "Join the waitlist";
    if (outcome !== "joined") {
      inputs.forEach(input => { input.disabled = false; });
      button.removeAttribute("aria-disabled");
    }
  });
}
