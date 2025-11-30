import * as path from 'path';
import * as fs from 'fs';

/**
 * Safely parse JSON with error context
 */
export function safeJsonParse<T = any>(jsonString: string, context: string): T {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Failed to parse JSON in ${context}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Safely parse JSON from file
 */
export async function safeJsonParseFile<T = any>(filePath: string): Promise<T> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return safeJsonParse<T>(content, `file: ${filePath}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Safely parse JSON from file synchronously
 */
export function safeJsonParseFileSync<T = any>(filePath: string): T {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return safeJsonParse<T>(content, `file: ${filePath}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

/**
 * Validate that a resolved path is within an allowed base directory
 * Prevents path traversal attacks
 */
export function validatePathWithinBase(filePath: string, baseDir: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, filePath);

  // Check if resolved path starts with base directory
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error(`Path traversal detected: ${filePath} is outside ${baseDir}`);
  }

  return resolvedPath;
}

/**
 * Safely construct a file path within a base directory
 * Validates against path traversal and returns absolute path
 */
export function safeJoinPath(baseDir: string, ...segments: string[]): string {
  const joined = path.join(...segments);
  return validatePathWithinBase(joined, baseDir);
}

/**
 * Wrap async function with error context
 */
export function withErrorContext<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  contextFn: (...args: T) => string
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const context = contextFn(...args);
      if (error instanceof Error) {
        error.message = `${context}: ${error.message}`;
      }
      throw error;
    }
  };
}
