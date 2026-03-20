export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error === null || error === undefined) return 'Unknown error';
  return String(error);
};
