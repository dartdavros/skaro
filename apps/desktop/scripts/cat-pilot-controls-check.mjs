/* global document, getComputedStyle, DOMMatrixReadOnly, requestAnimationFrame */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

/** Static requirement checks over the actual delivered files, not model-reported verdicts. */
export async function checkCatPilotDelivery(root) {
  const files = ['index.html'];
  for (const directory of ['css', 'js'])
    for (const filename of await readdir(join(root, directory)))
      files.push(`${directory}/${filename}`);
  const inputs = await Promise.all(
    files.map(async (path) => ({ path, bytes: await readFile(join(root, path)) })),
  );
  const totalBytes = inputs.reduce((sum, item) => sum + item.bytes.length, 0);
  assert(totalBytes < 150 * 1024, 'Delivered HTML/CSS/JS exceed 150 KiB');
  for (const input of inputs.filter(
    (item) => item.path.endsWith('.css') && item.path !== 'css/base.css',
  ))
    assert(
      !/#[\da-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\s*\(/i.test(
        input.bytes.toString(),
      ),
      `Color literal outside base.css: ${input.path}`,
    );
  const source = ts.createSourceFile(
    'controls.js',
    await readFile(join(root, 'js/controls.js'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const functions = new Set(['String']);
  const visitFunctions = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) functions.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      functions.add(node.name.text);
    ts.forEachChild(node, visitFunctions);
  };
  visitFunctions(source);
  const inspect = (node) => {
    assert(
      !ts.isNewExpression(node) && !ts.isImportDeclaration(node),
      'Controls may not construct animation engines or import behavior',
    );
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression))
        assert(functions.has(expression.text), `Unsupported controls call: ${expression.text}`);
      else {
        assert(ts.isPropertyAccessExpression(expression), 'Unsupported indirect controls call');
        const method = expression.name.text,
          first = node.arguments[0];
        assert(
          [
            'querySelector',
            'getElementById',
            'addEventListener',
            'toggle',
            'contains',
            'setAttribute',
          ].includes(method),
          `Unsupported controls method: ${method}`,
        );
        assert(first && ts.isStringLiteral(first), 'Controls methods require explicit targets');
        const allowed = {
          querySelector: ['#stage', '#pause-button'],
          getElementById: ['stage', 'pause-button'],
          addEventListener: ['click'],
          toggle: ['is-paused'],
          contains: ['is-paused'],
          setAttribute: ['aria-pressed'],
        };
        assert(allowed[method].includes(first.text), `Unsupported controls target: ${first.text}`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  assert(
    /index\.html/i.test(readme) &&
      /file:\/\/|открыть|open/i.test(readme) &&
      /storyboard\.md/i.test(readme),
    'README must describe actual launch and storyboard location',
  );
  return {
    totalBytes,
    files: inputs.map(({ path, bytes }) => ({ path, bytes: bytes.length })),
    controlsAst: 'allowed-class-and-button-calls',
    readme: 'present',
  };
}

/** Real click/keyboard/media/three-cycle acceptance on one actual browser engine. */
export async function checkCatPilotControls(page) {
  const button = page.locator('#pause-button');
  const state = () =>
    page.evaluate(() => ({
      paused: document.querySelector('#stage').classList.contains('is-paused'),
      text: document.querySelector('#pause-button').textContent,
      pressed: document.querySelector('#pause-button').getAttribute('aria-pressed'),
      animations: document
        .getAnimations()
        .map((animation) => ({ time: animation.currentTime, state: animation.playState })),
    }));
  const requireState = (value, paused) => {
    assert.equal(value.paused, paused);
    assert.equal(value.text.trim(), paused ? 'Играть' : 'Пауза');
    assert.equal(value.pressed, String(paused));
    assert(value.animations.length > 10, 'Full cat/plane story animations are absent');
    assert(value.animations.every((item) => item.state === (paused ? 'paused' : 'running')));
  };
  requireState(await state(), false);
  await button.click();
  const frozen = await state();
  requireState(frozen, true);
  await page.waitForTimeout(150);
  const later = await state();
  assert.deepEqual(later, frozen, 'An animation advances while the scene is paused');
  await button.click();
  await page.waitForTimeout(100);
  const resumed = await state();
  requireState(resumed, false);
  assert(
    resumed.animations.every(
      (item, index) =>
        item.time > frozen.animations[index].time &&
        item.time < frozen.animations[index].time + 500,
    ),
    'Resume resets or desynchronizes animation time',
  );
  await button.focus();
  await page.keyboard.press('Enter');
  requireState(await state(), true);
  await page.keyboard.press('Space');
  requireState(await state(), false);
  const animatedProperties = await page.evaluate(() => [
    ...new Set(
      document
        .getAnimations()
        .flatMap((animation) =>
          animation.effect
            .getKeyframes()
            .flatMap((frame) =>
              Object.keys(frame).filter(
                (name) => !['offset', 'computedOffset', 'easing', 'composite'].includes(name),
              ),
            ),
        ),
    ),
  ]);
  assert(
    animatedProperties.every((name) => ['transform', 'opacity'].includes(name)),
    'Unsupported animated property',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const plane = new DOMMatrixReadOnly(style('#plane').transform);
    return {
      count: document.getAnimations().length,
      stage: style('#stage').opacity,
      cat: style('#cat-walk').opacity,
      pilot: style('#cat-pilot').opacity,
      fish: style('#fish-cloud').opacity,
      scale: Math.hypot(plane.a, plane.b),
      raised: plane.f < 0,
    };
  });
  assert.equal(reduced.count, 0, 'Reduced motion still animates');
  assert.equal(reduced.stage, '1');
  assert.equal(reduced.cat, '0');
  assert.equal(reduced.pilot, '1');
  assert.equal(reduced.fish, '1');
  assert(
    Math.abs(reduced.scale - 0.6) < 0.05 && reduced.raised,
    'Reduced-motion plane must fly above the hills at scale ~0.6',
  );
  assert.equal(await button.isVisible(), false, 'Reduced-motion control is visible');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  const cycles = await page.evaluate(async () => {
    const animations = document.getAnimations();
    animations.forEach((animation) => {
      animation.currentTime = 0;
      animation.play();
    });
    const started = performance.now();
    let wraps = 0,
      previous = 0,
      maxSpreadMs = 0,
      maxFrameMs = 0,
      lastFrame = started,
      seamOpacity = 0;
    while (performance.now() - started < 30200) {
      await new Promise(requestAnimationFrame);
      const now = performance.now(),
        times = animations.map((animation) => Number(animation.currentTime));
      maxSpreadMs = Math.max(maxSpreadMs, Math.max(...times) - Math.min(...times));
      maxFrameMs = Math.max(maxFrameMs, now - lastFrame);
      const cycle = Math.floor(times[0] / 10000);
      if (cycle > previous) {
        wraps++;
        seamOpacity = Math.max(
          seamOpacity,
          Number(getComputedStyle(document.querySelector('#stage')).opacity),
        );
      }
      previous = cycle;
      lastFrame = now;
    }
    return { wraps, maxSpreadMs, maxFrameMs, seamOpacity, elapsedMs: performance.now() - started };
  });
  assert(
    cycles.wraps >= 3 && cycles.maxSpreadMs < 2 && cycles.seamOpacity < 0.1,
    'Three actual cycles drift or show the reset seam',
  );
  return { clickAndKeyboard: 'passed', pauseResume: 'passed', animatedProperties, reduced, cycles };
}
