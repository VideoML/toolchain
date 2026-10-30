import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const browser = process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if (!browser) throw new Error('Set VIDEOML_CHROMIUM_EXECUTABLE_PATH to the pinned Chromium executable.');
for (const [fixture, expected] of [['frame', 0], ['wall-clock', 1], ['css-clock', 1]]) {
  test(`${fixture} fixture ${expected ? 'fails' : 'passes'} real-browser conformance`, () => {
    const output = mkdtempSync(join(tmpdir(), `videoml-conformance-${fixture}-`));
    const result = spawnSync(process.execPath, ['tests/conformance/run.mjs', '--fixture', fixture, '--output', output], { encoding: 'utf8', env: process.env });
    assert.equal(result.status, expected, result.stderr + result.stdout);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    assert.equal(report.passed, expected === 0);
    assert.ok(report.comparisons.length > 0);
    if (expected) assert.ok(report.comparisons.some(c => !c.equal));
    else assert.ok(report.comparisons.every(c => c.equal));
    assert.deepEqual(report.orders.map(o => o.name), ['sequential', 'repeat', 'reverse', 'random', 'partition-0', 'partition-1']);
  });
}

test('explicit local fixture path works and missing paths fail', () => {
  const output = mkdtempSync(join(tmpdir(), 'videoml-conformance-path-'));
  const result = spawnSync(process.execPath, ['tests/conformance/run.mjs', '--fixture-path', 'tests/conformance/fixtures/frame.js', '--output', output], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.fixture, join(process.cwd(), 'tests/conformance/fixtures/frame.js'));
  assert.match(report.environment.fixtureSha256, /^[a-f0-9]{64}$/);
  for (const path of ['tests/conformance/fixtures/missing.js', 'https://example.com/fixture.js']) {
    const bad = spawnSync(process.execPath, ['tests/conformance/run.mjs', '--fixture-path', path, '--output', output], { encoding: 'utf8', env: process.env });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /fixture|ENOENT/i);
  }
});

test('unknown built-in fixture fails clearly', () => {
  const result = spawnSync(process.execPath, ['tests/conformance/run.mjs', '--fixture', 'missing-fixture'], { encoding: 'utf8', env: process.env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown fixture/);
});
