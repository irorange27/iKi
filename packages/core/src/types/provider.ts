/**
 * Provider types are a thin projection of the domain contract.
 *
 * The schema and the derived types live in `../domain/models` (pi-style:
 * schema is the single source of truth, types are its static projection).
 * This module keeps the historical export names so consumers do not reach
 * into the domain layer, and adds the few view-shaped types that are not
 * persisted declarations.
 */
import type {
  JsonValue,
  Provider,
  ProviderModelOptions,
  ProviderModelOptionsMap,
} from '../domain/models';

export type { JsonValue, Provider, ProviderModelOptions, ProviderModelOptionsMap };
export type { ModelDefinition, ModelOverride, ModelsConfig, ProviderConfig } from '../domain/models';

/** A model with its capability snapshot, as the model picker sees it. */
export interface ProviderModelDescriptor extends ProviderModelOptions {
  id: string;
  source?: 'models.dev' | 'provider';
}

export type ModelCapabilitySnapshot = Pick<
  ProviderModelOptions,
  'contextWindow' | 'maxInputTokens' | 'maxOutputTokens' | 'supportsVision'
>;

export type ProviderModelDiscoveryOverride = Partial<
  Pick<
    Provider,
    'id' | 'type' | 'api_key' | 'base_url' | 'models' | 'model_options' | 'is_response_api'
  >
>;

type ProviderUpdatedAction = 'added' | 'updated' | 'deleted';

export interface ProviderUpdatedEvent {
  action: ProviderUpdatedAction;
  providerId: string;
}
