import { afterEach, beforeEach, vi } from 'vitest';

type ErrorChannel = 'console';

type ErrorLogEntry = {
  channel: ErrorChannel;
  args: unknown[];
};

type ErrorExpectation = {
  channel: ErrorChannel;
  matcher: (entry: ErrorLogEntry) => boolean;
  description: string;
  times: number;
};

const state: {
  entries: ErrorLogEntry[];
  expectations: ErrorExpectation[];
} = {
  entries: [],
  expectations: [],
};

const formatArg = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatEntry = (entry: ErrorLogEntry): string =>
  `${entry.channel}.error(${entry.args.map(formatArg).join(', ')})`;

const consumeExpectation = (
  pending: ErrorLogEntry[],
  expectation: ErrorExpectation
): ErrorLogEntry[] => {
  const remaining = [...pending];
  let matches = 0;

  for (let index = remaining.length - 1; index >= 0 && matches < expectation.times; index -= 1) {
    const entry = remaining[index];
    if (!entry) continue;
    if (!expectation.matcher(entry)) continue;
    remaining.splice(index, 1);
    matches += 1;
  }

  if (matches !== expectation.times) {
    throw new Error(
      `Expected ${expectation.description} to be logged ${expectation.times} time(s), but saw ${matches}.`
    );
  }

  return remaining;
};

export const recordErrorLog = (channel: ErrorChannel, args: unknown[]): void => {
  state.entries.push({ channel, args });
};

export const expectConsoleErrorArgs = (...expectedArgs: unknown[]): void => {
  state.expectations.push({
    channel: 'console',
    times: 1,
    description: `console.error(${expectedArgs.map(formatArg).join(', ')})`,
    matcher: entry =>
      entry.channel === 'console' &&
      entry.args.length === expectedArgs.length &&
      expectedArgs.every((expectedArg, index) => Object.is(entry.args[index], expectedArg)),
  });
};

export const expectConsoleErrorMatching = (
  matcher: (args: unknown[]) => boolean,
  description: string,
  times = 1
): void => {
  state.expectations.push({
    channel: 'console',
    times,
    description,
    matcher: entry => entry.channel === 'console' && matcher(entry.args),
  });
};

export const installStrictErrorLogGuard = (): void => {
  beforeEach(() => {
    state.entries = [];
    state.expectations = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      recordErrorLog('console', args);
    });
  });

  afterEach(() => {
    let pending = [...state.entries];

    for (const expectation of state.expectations) {
      pending = consumeExpectation(pending, expectation);
    }

    if (pending.length > 0) {
      throw new Error(
        `Unexpected error logs detected:\n${pending.map(entry => `- ${formatEntry(entry)}`).join('\n')}`
      );
    }
  });
};
