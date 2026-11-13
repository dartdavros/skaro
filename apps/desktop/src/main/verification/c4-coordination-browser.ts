import assert from 'node:assert/strict';
import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { c4Hash } from '@skaro/core';
import type { Services } from '../app-services';

/** Actual documented file:// Cat-pilot contour in Chromium, with matched animation time. */
export async function verifyC4CoordinationBrowser(
  s: Services,
  project: string,
  directory: string,
  task = 'T-012',
  publishedRoot = false,
) {
  const root = s.projects.get(project).root,
    run = s.db.latestRun(project, task);
  assert(publishedRoot || run?.worktree);
  const window = new BrowserWindow({
    show: false,
    x: 0,
    y: 0,
    useContentSize: true,
    width: 1200,
    height: 720,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  const capture = async (path: string, name: string) => {
    const errors: string[] = [];
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    await window.loadURL(pathToFileURL(join(path, 'index.html')).href);
    await window.webContents.executeJavaScript(`(async () => {
      const animations = document.getAnimations();
      await Promise.all(animations.map(a => { a.pause(); return a.ready; }));
      for (const animation of animations) animation.currentTime = 5000;
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 150));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const state = await window.webContents.executeJavaScript(`({
      title: document.title,
      viewport: {width: innerWidth, height: innerHeight},
      styles: [...document.styleSheets].map(s => ({ href: new URL(s.href).pathname.split('/').pop(), rules: s.cssRules.length })),
      stage: { width: document.querySelector('#stage').getBoundingClientRect().width,
        height: document.querySelector('#stage').getBoundingClientRect().height },
      background: getComputedStyle(document.body).backgroundColor,
      cycle: getComputedStyle(document.documentElement).getPropertyValue('--cycle'),
      opacity: getComputedStyle(document.querySelector('#stage')).opacity,
      animations: document.getAnimations().map(a => ({time: a.currentTime, state: a.playState})),
      text: document.body.innerText,
      broken: [...document.querySelectorAll('img')].filter(i => !i.complete || !i.naturalWidth).length
    })`);
    assert.equal(state.broken, 0);
    assert.deepEqual(errors, []);
    const frame = await window.webContents.capturePage();
    assert.deepEqual(frame.getSize(), state.viewport);
    const screenshot = join(directory, name + '.png');
    await writeFile(screenshot, frame.toPNG());
    return { state, screenshot, pixels: c4Hash(frame.toBitmap().toString('base64')) };
  };
  try {
    const before = await capture(root, 'cat-pilot-before'),
      after = await capture(publishedRoot ? root : run!.worktree!, 'cat-pilot-after');
    assert.deepEqual(
      after.state.styles.map((s: { href: string }) => s.href),
      before.state.styles.map((s: { href: string }) =>
        s.href === 'base.css' ? 'layout.css' : s.href,
      ),
    );
    assert.deepEqual({ ...after.state, styles: undefined }, { ...before.state, styles: undefined });
    assert.equal(
      after.pixels,
      before.pixels,
      'Renaming the stylesheet must preserve the actual rendered frame',
    );
    return {
      before,
      after,
      identicalPixels: true,
      contour: 'documented file://',
      animationTimeMs: 5000,
    };
  } finally {
    window.destroy();
  }
}
