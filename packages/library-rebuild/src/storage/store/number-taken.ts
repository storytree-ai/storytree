// Capability 13 · Decision log
export class NumberTakenError extends Error {
  override readonly name = "NumberTakenError";
  readonly type: string;
  readonly field: string;
  readonly number: number;

  constructor(type: string, field: string, number: number) {
    super(`${type} ${field} ${number} is taken: a number a record has ever held is never given again`);
    this.type = type;
    this.field = field;
    this.number = number;
  }
}
