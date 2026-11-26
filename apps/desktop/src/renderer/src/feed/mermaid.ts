import { htmlSanitizer } from '../sanitize';

const sanitizeSvg = htmlSanitizer({ USE_PROFILES: { svg: true, svgFilters: true } });
let library: Promise<typeof import('mermaid').default> | undefined;
let sequence = 0;

function loadMermaid() {
  return (library ??= import('mermaid')
    .then(({ default: mermaid }) => {
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      mermaid.initialize({
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: 'dark',
        securityLevel: 'strict',
        htmlLabels: false,
        fontFamily: 'Nunito Sans Variable, sans-serif',
        themeVariables: {
          background: token('--sk-surface'),
          primaryColor: token('--sk-surface-2'),
          primaryTextColor: token('--sk-diagram-text'),
          primaryBorderColor: token('--sk-surface-2'),
          lineColor: token('--sk-text-25'),
          fontSize: token('--sk-fs-4'),
        },
      });
      return mermaid;
    })
    .catch((error: unknown) => {
      library = undefined;
      throw error;
    }));
}

export async function drawMermaid(root: ParentNode, streaming = false): Promise<void> {
  for (const block of root.querySelectorAll<HTMLElement>('.md-mermaid:not([data-done])')) {
    if (!block.isConnected || block.dataset['done']) continue;
    const source = block.dataset['source'] ?? '';
    if (streaming && block.classList.contains('md-mermaid-open')) {
      if (block.textContent !== source) block.textContent = source;
      block.classList.add('md-mermaid-error');
      continue;
    }
    block.dataset['done'] = '1';
    // Mermaid measures connected SVGs. Keep its intermediate DOM inside its owner.
    const host = document.createElement('div');
    host.style.visibility = 'hidden';
    host.style.width = '100%';
    try {
      const mermaid = await loadMermaid();
      if (!block.isConnected) continue;
      block.replaceChildren(host);
      const { svg } = await mermaid.render(`sk-mermaid-${++sequence}`, source, host);
      if (!host.isConnected) continue;
      block.innerHTML = sanitizeSvg(svg);
      block.classList.remove('md-mermaid-error');
    } catch {
      if (!block.isConnected) continue;
      block.textContent = source;
      block.classList.add('md-mermaid-error');
    } finally {
      host.remove();
    }
  }
}
