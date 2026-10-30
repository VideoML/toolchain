import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const fixturePathOption = option('--fixture-path');
if (fixturePathOption && /^[a-z][a-z0-9+.-]*:/i.test(fixturePathOption)) throw new Error('Fixture path must be a local filesystem path, not a URL');
if (fixturePathOption && args.includes('--fixture')) throw new Error('Choose either --fixture or --fixture-path');
const fixture = fixturePathOption ? resolve(fixturePathOption) : option('--fixture', 'frame');
const output = resolve(option('--output', 'conformance-output'));
if (!fixturePathOption && !['frame', 'wall-clock', 'css-clock'].includes(fixture)) throw new Error(`Unknown fixture ${fixture}`);
const executablePath = process.env.VIDEOML_CHROMIUM_EXECUTABLE_PATH;
if (!executablePath) throw new Error('Set VIDEOML_CHROMIUM_EXECUTABLE_PATH to the pinned Chromium executable.');
const config = { width: 1280, height: 720, fps: 30, seed: 0, assets: {} };
const frames = [0, 1, 9, 10, 15, 19, 20, 29];
// Fixed-seed Fisher-Yates, using uint32 arithmetic.
let state = config.seed >>> 0;
const random = [...frames];
for (let i = random.length - 1; i > 0; i--) {
  state = (Math.imul(1664525, state) + 1013904223) >>> 0;
  const j = state % (i + 1); [random[i], random[j]] = [random[j], random[i]];
}
const orders = [
  { name: 'sequential', frames }, { name: 'repeat', frames: [...frames] },
  { name: 'reverse', frames: [...frames].reverse() }, { name: 'random', frames: random },
  { name: 'partition-0', frames: frames.filter((_, i) => i % 2 === 0) },
  { name: 'partition-1', frames: frames.filter((_, i) => i % 2 === 1) },
];
await mkdir(output, { recursive: true });
const fixturePath = fixturePathOption ? resolve(fixturePathOption) : join(dirname(fileURLToPath(import.meta.url)), 'fixtures', `${fixture}.js`);
const fixtureSource = readFileSync(fixturePath, 'utf8');
const executableHash = createHash('sha256');
for await (const chunk of createReadStream(executablePath)) executableHash.update(chunk);
const browser = await chromium.launch({ executablePath, headless: true });
const report = { fixture, config, frames, orders, environment: { platform: process.platform, architecture: process.arch, osRelease: os.release(), node: process.version, playwright: JSON.parse(readFileSync(new URL('../../node_modules/playwright/package.json', import.meta.url))).version, chromium: browser.version(), executablePath, executableSha256: executableHash.digest('hex'), fixtureSha256: createHash('sha256').update(fixtureSource).digest('hex'), fonts: 'No text or fonts used by these fixtures', releaseGate: `${process.platform} ${process.arch} smoke only; pinned Linux x86_64 Chromium/FFmpeg and bundled-font release gate not verified` }, comparisons: [], passed: false };
const baseline = new Map();
const sha = data => createHash('sha256').update(data).digest('hex');
async function openWorker() {
  const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent('<!doctype html><style>html,body{margin:0;padding:0}</style><div id="root"></div>');
  await page.addScriptTag({ content: fixtureSource });
  await page.evaluate(c => window.fixture.mount(document.querySelector('#root'), c), config);
  const decoder = await context.newPage();
  return { context, page, decoder };
}
async function decodedRgba(decoder, png) {
  const base64 = png.toString('base64');
  const result = await decoder.evaluate(async data => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let binary = ''; for (let i = 0; i < rgba.length; i += 32768) binary += String.fromCharCode(...rgba.subarray(i, i + 32768));
    return { width: canvas.width, height: canvas.height, base64: btoa(binary) };
  }, base64);
  if (result.width !== config.width || result.height !== config.height) throw new Error('Unexpected capture dimensions');
  return Buffer.from(result.base64, 'base64');
}
async function capture(worker, order, frame) {
  await worker.page.evaluate(f => window.fixture.seek(f), frame);
  const png = await worker.page.screenshot();
  const rgba = await decodedRgba(worker.decoder, png);
  const name = `${order.name}-frame-${String(frame).padStart(4, '0')}.png`;
  await writeFile(join(output, name), png);
  const digest = sha(rgba);
  if (order.name === 'sequential') baseline.set(frame, rgba);
  else {
    const reference = baseline.get(frame);
    if (!reference) throw new Error(`Missing baseline for frame ${frame}`);
    report.comparisons.push({ order: order.name, frame, equal: reference.equals(rgba), rgbaSha256: digest, baselineSha256: sha(reference), capture: name });
  }
}
async function closeWorker(worker) { await worker.page.evaluate(() => window.fixture.dispose()); await worker.context.close(); }
try {
  const worker = await openWorker();
  try { for (const order of orders.slice(0, 4)) for (const frame of order.frames) await capture(worker, order, frame); }
  finally { await closeWorker(worker); }
  const workers = await Promise.all([openWorker(), openWorker()]);
  try { await Promise.all(workers.map(async (worker, index) => { const order = orders[4 + index]; for (const frame of order.frames) await capture(worker, order, frame); })); }
  finally { await Promise.all(workers.map(closeWorker)); }
  report.passed = report.comparisons.length === frames.length * 4 && report.comparisons.every(c => c.equal);
} finally {
  await browser.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`${fixture}: ${report.passed ? 'PASS' : 'FAIL'} (${report.comparisons.filter(c => !c.equal).length}/${report.comparisons.length} mismatches); report: ${join(output, 'report.json')}`);
if (!report.passed) process.exitCode = 1;
