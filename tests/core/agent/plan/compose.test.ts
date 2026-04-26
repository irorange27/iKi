import { describe, expect, it, vi } from 'vitest';

import { composePrepareSteps } from '../../../../src/core/agent/plan/compose';

describe('composePrepareSteps', () => {
  it('returns a no-op function when no prepareSteps are provided', () => {
    const result = composePrepareSteps();
    expect(typeof result).toBe('function');
    expect(result({ steps: [], messages: [] })).toBeUndefined();
  });

  it('returns a no-op function when all inputs are undefined', () => {
    const result = composePrepareSteps(undefined, undefined);
    expect(typeof result).toBe('function');
    expect(result({ steps: [], messages: [] })).toBeUndefined();
  });

  it('forwards directly when there is a single prepareStep', () => {
    const step = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'hello' }] });
    const result = composePrepareSteps(step);

    const output = result({ steps: [], messages: [] });
    expect(output).toEqual({ messages: [{ role: 'user', content: 'hello' }] });
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('merges messages from multiple prepareSteps in order', async () => {
    const stepA = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'a' }] });
    const stepB = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'b' }] });

    const composed = composePrepareSteps(stepA, stepB);
    const output = await composed({ steps: [], messages: [] });

    expect(output).toEqual({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    });
  });

  it('propagates undefined messages from steps that return nothing', async () => {
    const stepA = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'a' }] });
    const stepB = vi.fn().mockReturnValue(undefined);
    const stepC = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'c' }] });

    const composed = composePrepareSteps(stepA, stepB, stepC);
    const output = await composed({ steps: [], messages: [] });

    expect(output).toEqual({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'c' },
      ],
    });
  });

  it('returns undefined when all steps return nothing', async () => {
    const stepA = vi.fn().mockReturnValue(undefined);
    const stepB = vi.fn().mockReturnValue(undefined);

    const composed = composePrepareSteps(stepA, stepB);
    const output = await composed({ steps: [], messages: [] });

    expect(output).toBeUndefined();
  });

  it('continues execution when one prepareStep throws', async () => {
    const stepA = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'a' }] });
    const stepB = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const stepC = vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'c' }] });

    const composed = composePrepareSteps(stepA, stepB, stepC);
    const output = await composed({ steps: [], messages: [] });

    expect(output).toEqual({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'c' },
      ],
    });
  });

  it('handles async prepareSteps', async () => {
    const stepA = vi.fn().mockResolvedValue({ messages: [{ role: 'user', content: 'a' }] });
    const stepB = vi.fn().mockResolvedValue({ messages: [{ role: 'user', content: 'b' }] });

    const composed = composePrepareSteps(stepA, stepB);
    const output = await composed({ steps: [], messages: [] });

    expect(output).toEqual({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    });
  });
});
