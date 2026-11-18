// Capability 1 · Lifecycle
export interface GpuResetsApp {
  disableDomainBlockingFor3DAPIs(): void;
  readonly commandLine: { appendSwitch(name: string): void };
}

export function keepDrawingThroughGpuResets(app: GpuResetsApp): void {
  app.disableDomainBlockingFor3DAPIs();
  app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
}
