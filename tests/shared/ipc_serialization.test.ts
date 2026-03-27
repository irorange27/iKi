import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import { toIpcSerializable } from '../../src/shared/utils/ipc_serialization';

describe('toIpcSerializable', () => {
  it('converts reactive task payloads into structured-clone-safe plain data', () => {
    const taskForm = ref({
      name: 'Daily',
      prompt: 'Summarize',
      tools: ['web', 'fetch'],
      nested: {
        enabled: true,
      },
    });

    const payload = {
      name: taskForm.value.name,
      prompt: taskForm.value.prompt,
      tools: taskForm.value.tools,
      nested: taskForm.value.nested,
    };

    expect(() => structuredClone(payload)).toThrow();

    const serialized = toIpcSerializable(payload);

    expect(serialized).toEqual({
      name: 'Daily',
      prompt: 'Summarize',
      tools: ['web', 'fetch'],
      nested: {
        enabled: true,
      },
    });
    expect(() => structuredClone(serialized)).not.toThrow();
    expect(serialized.tools).not.toBe(taskForm.value.tools);
    expect(serialized.nested).not.toBe(taskForm.value.nested);
  });

  it('preserves built-in cloneable values without degrading them through JSON', () => {
    const payload = {
      ranAt: new Date('2026-03-20T09:30:00.000Z'),
      buffer: new Uint8Array([1, 2, 3]),
    };

    const serialized = toIpcSerializable(payload);

    expect(serialized.ranAt).toBeInstanceOf(Date);
    expect(serialized.ranAt.toISOString()).toBe('2026-03-20T09:30:00.000Z');
    expect(serialized.buffer).toBeInstanceOf(Uint8Array);
    expect(Array.from(serialized.buffer)).toEqual([1, 2, 3]);
    expect(() => structuredClone(serialized)).not.toThrow();
  });

  it('clones bigint typed arrays without falling back to JSON', () => {
    const payload = {
      buffer: new BigUint64Array([1n, 2n, 3n]),
    };

    const serialized = toIpcSerializable(payload);

    expect(serialized.buffer).toBeInstanceOf(BigUint64Array);
    expect(Array.from(serialized.buffer)).toEqual([1n, 2n, 3n]);
    expect(serialized.buffer).not.toBe(payload.buffer);
  });
});
