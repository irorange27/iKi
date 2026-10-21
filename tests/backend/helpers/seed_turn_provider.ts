/**
 * Seed the provider row a durable-layer suite needs.
 *
 * Those suites assert what happens AROUND the model call (retry, session log,
 * persistence, recovery). Since ADR 009 the only supply is Pi, and Pi resolves a
 * real provider row before it will admit a turn — a suite that mocks the old
 * `createModel` seam now fails with "provider … is not configured" instead of
 * reaching the code under test.
 *
 * `baseUrl` points at a closed port on purpose: the suite scripts the model, so
 * any attempt to actually dial is a bug the test should surface, not paper over.
 */
import { addProvider } from '@iki/backend/db/providers';

export const seedTurnProvider = (options: {
  providerId: string;
  providerType?: string;
  model: string;
  baseUrl?: string;
}): void => {
  addProvider({
    id: options.providerId,
    name: options.providerId,
    type: options.providerType ?? 'openai',
    api_key: `key-${options.providerId}`,
    models: JSON.stringify([options.model]),
    base_url: options.baseUrl ?? 'http://127.0.0.1:9/v1',
    enabled: true,
  } as never);
};
