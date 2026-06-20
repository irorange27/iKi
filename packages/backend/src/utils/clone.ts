import { toPlainData } from './plain_clone';

export const clonePlainData = <T>(value: T): T => toPlainData(value);
