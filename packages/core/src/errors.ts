export class NillaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "NillaError";
  }
}

export const nillaError = (error: unknown): NillaError =>
  error instanceof NillaError
    ? error
    : new NillaError(String((error as { code?: unknown } | null)?.code ?? "ERR_UNKNOWN"), String((error as { message?: unknown } | null)?.message ?? error));
