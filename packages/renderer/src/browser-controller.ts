import { createRequire } from 'node:module';

type ControllerRequire = { (id: string): typeof import('playwright-core'); resolve(id: string): string };

/** Prefer the optional Playwright peer; use the declared core controller otherwise. */
export function loadBrowserController(require: ControllerRequire = createRequire(import.meta.url)): typeof import('playwright-core') {
  let id: string;
  try {
    id = require.resolve('playwright');
  } catch (error: any) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    id = require.resolve('playwright-core');
  }
  return require(id);
}
