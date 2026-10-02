import { expect, type Locator } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Compare native computed styles and element state, ignoring compiler-generated scope hashes. */
export async function compareBaseline(root: Locator, prefix: string | undefined, name: string) {
  if (!prefix) return;
  const layout = await root.evaluate((root) => {
    const props = [
      'display',
      'fontSize',
      'fontFamily',
      'fontWeight',
      'lineHeight',
      'color',
      'backgroundColor',
      'padding',
      'margin',
      'gap',
      'borderRadius',
      'gridTemplateColumns',
      'alignItems',
      'height',
      'width',
      'border',
      'whiteSpace',
      'overflow',
    ];
    return [root, ...root.querySelectorAll('div,span,button,input,textarea,pre,svg')].map((el) => {
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        classes: [...el.classList].filter((value) => !value.startsWith('svelte-')),
        disabled: el instanceof HTMLButtonElement ? el.disabled : undefined,
        input: el instanceof HTMLInputElement ? { type: el.type, value: el.value } : undefined,
        style: Object.fromEntries(
          props.map((prop) => [prop, style[prop as keyof CSSStyleDeclaration]]),
        ),
      };
    });
  });
  const path = `${prefix}-${name}.json`;
  if (existsSync(path)) expect(layout).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  else writeFileSync(path, JSON.stringify(layout, null, 2));
}
