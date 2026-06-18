import { toIpcSerializable } from './ipc_serialization';

export const clonePlainData = <T>(value: T): T => toIpcSerializable(value);
