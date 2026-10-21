
import { addProvider } from '@iki/backend/db/providers';

export const seedTurnProvider = (options: {
  providerId: string;
  providerType?: string;
  model: string;
  baseUrl?: string;
}): void => {
  try {
    addProvider({
      id: options.providerId,
      name: options.providerId,
      type: options.providerType ?? 'openai',
      api_key: `key-${options.providerId}`,
      models: JSON.stringify([options.model]),
      base_url: options.baseUrl ?? 'http://127.0.0.1:9/v1',
      enabled: true,
    } as never);
  } catch (error) {
    if (!String(error).includes('UNIQUE constraint failed')) throw error;
  }
};
