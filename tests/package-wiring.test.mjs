import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const pkg = path => JSON.parse(readFileSync(resolve(root, path, 'package.json')));
test('CLI consumes toolchain through its public package', () => {
  const cli = readFileSync(resolve(root, '../cli/src/cli.ts'), 'utf8');
  assert.match(cli, /from ["']@videoml\/toolchain["']/);
  assert.doesNotMatch(cli, /from ["']\.\.\/\.\.\/\.\.\//);
  assert.equal(pkg('../cli').dependencies['@videoml/toolchain'], '0.0.0');
});
test('all renderer exports exist in the package', () => {
  const renderer = pkg('packages/renderer');
  for (const target of Object.values(renderer.exports)) assert.ok(existsSync(resolve(root, 'packages/renderer', target)), target);
});
test('player declares portable stdlib dependency', () => {
  assert.equal(pkg('../player').dependencies['@videoml/stdlib'], '0.0.0');
});
