import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import winston from 'winston';
import { getUserDataPath } from './platform';

// Define log format
const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;

  // Clean up Symbol key if present (winston internals)
  const meta = { ...metadata } as Record<string | symbol, unknown>;
  const splat = meta[Symbol.for('splat')];
  if (Array.isArray(splat) && splat.length) {
    // If using logger.debug('msg', obj), obj is in splat
    // We don't need to double print if we handle metadata right
  }

  if (Object.keys(meta).length > 0) {
    // If there are extra fields/objects, pretty print them
    msg += ` ${JSON.stringify(meta, null, 2)}`;
  }
  return msg;
});

const resolveLogDirectory = (): string | null => {
  const candidates = [
    process.env.IKI_LOG_DIR,
    path.join(getUserDataPath(), 'logs'),
    path.resolve(process.cwd(), 'logs'),
    path.join(os.tmpdir(), 'iki-logs'),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      // try the next fallback
    }
  }

  return null;
};

const logDirectory = resolveLogDirectory();

const fileTransports = logDirectory
  ? [
      new winston.transports.File({
        filename: path.join(logDirectory, 'combined.log'),
        maxsize: 5242880,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logDirectory, 'error.log'),
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5,
      }),
    ]
  : [];

// Create the logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: combine(
    errors({ stack: true }), // Handle errors nicely
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    json()
  ),
  transports: [
    // Console transport for development feedback
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), consoleFormat),
    }),
    ...fileTransports,
  ],
});

export const setLogLevel = (level: string) => {
  logger.level = level;
};
