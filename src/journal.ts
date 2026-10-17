export type JournalEntry = {
  readonly key: string;
  readonly output: unknown;
};

export class Journal {
  readonly #entries: JournalEntry[] = [];
  readonly #byKey = new Map<string, unknown>();

  has(key: string): boolean {
    return this.#byKey.has(key);
  }

  get(key: string): unknown | undefined {
    return this.#byKey.get(key);
  }

  append(key: string, output: unknown): void {
    if (this.#byKey.has(key)) {
      return;
    }
    this.#byKey.set(key, output);
    this.#entries.push({ key, output });
  }

  records(): readonly JournalEntry[] {
    return this.#entries;
  }
}

export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}
