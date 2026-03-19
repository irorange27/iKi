import type { TaskAgent } from './task_agent';
import type {
  CatalogSelectionRequest,
  CatalogSelectionRuntime,
} from '../runtimes/catalog_selection_runtime';

export class CatalogSelectionAgent<T> implements TaskAgent<CatalogSelectionRequest<T>, string[]> {
  constructor(private readonly runtime: CatalogSelectionRuntime) {}

  async run(request: CatalogSelectionRequest<T>): Promise<string[]> {
    if (request.availableCatalog.length === 0) return [];
    return this.runtime.run(request);
  }
}
