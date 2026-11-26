// Capability 4 · Work model
export interface ContractNumber {
  readonly capability: number;
  readonly contract: number;
}

export function capabilityNumber(title: string): number | undefined {
  const found = /^(\d+) · /.exec(title);
  return found === null ? undefined : Number(found[1]);
}

export function contractNumber(title: string): ContractNumber | undefined {
  const found = /^(\d+)\.(\d+) · /.exec(title);
  return found === null ? undefined : { capability: Number(found[1]), contract: Number(found[2]) };
}

export function testedNumber(number: string): ContractNumber | undefined {
  const found = /^(\d+)\.(\d+)$/.exec(number.trim());
  return found === null ? undefined : { capability: Number(found[1]), contract: Number(found[2]) };
}

export function said(number: ContractNumber): string {
  return `${number.capability}.${number.contract}`;
}

export function separated(title: string): string {
  return title.replace(/^(\d+\.\d+) (?!·)/, "$1 · ");
}

export function unnumbered(title: string): string {
  return title.replace(/^\d+\.\d+ · /, "");
}
