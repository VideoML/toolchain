import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserController} from '../../packages/renderer/src/browser-controller.ts';

test('browser capture uses declared core when the optional peer is absent', () => {
  const core = {chromium: {launch() {}}};
  const load = id => { assert.equal(id, '/core'); return core; };
  load.resolve = id => {
    if (id === 'playwright') throw Object.assign(new Error('missing'), {code: 'MODULE_NOT_FOUND'});
    assert.equal(id, 'playwright-core');
    return '/core';
  };
  assert.equal(loadBrowserController(load), core);
});
