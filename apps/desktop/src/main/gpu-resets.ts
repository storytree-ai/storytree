/** Capability 1 · Lifecycle. What startup asks of Electron's app so the window keeps drawing through the machine's GPU resets. */
export interface GpuResetsApp {
  disableDomainBlockingFor3DAPIs(): void;
  readonly commandLine: { appendSwitch(name: string): void };
}

/**
 * Turn off Chromium's two blocks after GPU crashes (contract 1.14): the per-page block on 3D APIs after a crash
 * it blames on the page, and the switch to no WebGL after three GPU process crashes. A Windows GPU reset crashes
 * the GPU process; with either block on, the globe's lost context is never restored and it stays white until a
 * restart. Call before the app is ready.
 */
export function keepDrawingThroughGpuResets(app: GpuResetsApp): void {
  app.disableDomainBlockingFor3DAPIs();
  app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
}
