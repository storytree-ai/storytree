export type PublishWebsiteOptions = {
  directory: string;
  token?: string | undefined;
  fetch?: typeof globalThis.fetch;
  log?: (message: string) => void;
};

export async function publishWebsite(_options: PublishWebsiteOptions): Promise<void> {}
