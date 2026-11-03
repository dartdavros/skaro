import { createHash } from 'node:crypto';
import { mkdir, writeFile, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface McpImageStore {
  /** Host-private artifacts only; never a model-selected destination or an external upload. */
  save(
    data: Uint8Array,
    mime: string,
    signal: AbortSignal,
  ): Promise<{
    kind: 'image-artifact';
    path: string;
    mime: string;
    sha256: string;
    bytes: number;
  }>;
}

export async function createMcpImageStore(directory: string): Promise<McpImageStore> {
  if (!isAbsolute(directory)) throw new Error('MCP artifact directory must be absolute');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Unsafe MCP artifact directory');
  const root = await realpath(directory);
  return {
    async save(data, mime, signal) {
      signal.throwIfAborted();
      const bytes = Buffer.from(data);
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg =
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
      const extension =
        mime === 'image/png' && png ? 'png' : mime === 'image/jpeg' && jpeg ? 'jpg' : null;
      if (!extension || bytes.length > 4_194_304) throw new Error('Unsupported MCP image');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const path = join(root, `${sha256}.${extension}`);
      try {
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600, signal });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Do not follow a replaced artifact or trust an existing file by its name alone.
        const stat = await lstat(path);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          stat.size !== bytes.length
        )
          throw new Error('Unsafe existing MCP artifact', { cause: error });
        const { readFile } = await import('node:fs/promises');
        const existing = await readFile(path);
        if (!bytes.equals(existing))
          throw new Error('MCP artifact content changed', { cause: error });
      }
      signal.throwIfAborted();
      return { kind: 'image-artifact', path, mime, sha256, bytes: bytes.length };
    },
  };
}

export async function mcpContent(
  content: unknown,
  images: McpImageStore | undefined,
  signal: AbortSignal,
) {
  if (!Array.isArray(content)) throw new Error('Invalid MCP content');
  const text: string[] = [];
  const artifacts: Awaited<ReturnType<McpImageStore['save']>>[] = [];
  for (const part of content) {
    signal.throwIfAborted();
    if (part.type === 'text' && typeof part.text === 'string') text.push(part.text);
    else if (part.type === 'image' && images && typeof part.data === 'string') {
      if (part.data.length > 5_592_408 || part.data.length % 4 || /[^A-Za-z0-9+/=]/.test(part.data))
        throw new Error('Invalid MCP image encoding');
      const bytes = Buffer.from(part.data, 'base64');
      if (bytes.toString('base64') !== part.data) throw new Error('Invalid MCP image encoding');
      artifacts.push(await images.save(bytes, part.mimeType, signal));
    } else throw new Error('MCP response requires an unsupported content type');
  }
  return { text: text.join('\n'), ...(artifacts.length ? { artifacts } : {}) };
}
