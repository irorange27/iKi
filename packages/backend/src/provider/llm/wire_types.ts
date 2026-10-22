
export type JsonPrimitive = string | number | boolean | null;
export type JSONValue = JsonPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type ProviderMetadata = Record<string, Record<string, JSONValue>>;
export type SharedV3ProviderOptions = ProviderMetadata;

