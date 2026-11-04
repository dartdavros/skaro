import { readGraphFile as readFile } from '../read-file';
import { Parser, Language } from 'web-tree-sitter';
import runtimeWasm from 'web-tree-sitter/tree-sitter.wasm?asset';
import pythonWasm from 'tree-sitter-wasms/out/tree-sitter-python.wasm?asset';
import type { Facts, SourceFile } from '../facts';
import { parsePython } from './python-parse';
import { PythonResolver } from './python-resolve';
import type { PyDocument } from './python-model';
import type { AnalysisCache } from './cache';
/** AST schema/parser identity is independent of graph projection and publication changes. */
export const PYTHON_AST_VERSION = 'graph-1.0.3/python';

let ready: Promise<Language> | undefined;
async function language(): Promise<Language> {
  ready ??= (async () => {
    await Parser.init({ wasmBinary: await readFile(runtimeWasm) });
    return Language.load(await readFile(pythonWasm));
  })();
  return ready;
}
export async function analyzePython(
  files: SourceFile[],
  facts: Facts,
  diagnostic: (path: string, message: string) => void,
  cache?: AnalysisCache,
): Promise<PythonResolver> {
  const grammar = await language();
  const parser = new Parser();
  const documents: PyDocument[] = [];
  try {
    parser.setLanguage(grammar);
    for (const file of files.filter((file) => file.language === 'python')) {
      try {
        const cached = cache?.read<Omit<PyDocument, 'file'>>(file.path, file.hash);
        const document = cached ? { ...cached, file } : parsePython(parser, file, facts);
        if (cached) cache?.reused();
        else {
          const { file: _file, ...draft } = document;
          cache?.write(file.path, file.hash, draft);
        }
        documents.push(document);
        if (document.errors)
          diagnostic(
            file.path,
            'Python syntax contains errors; recoverable declarations are indexed with partial coverage',
          );
        for (const declaration of document.declarations)
          facts.node({
            id: declaration.id,
            kind: 'symbol',
            name: declaration.name,
            qualifiedName: `${document.module}.${declaration.qualified}`,
            origin: 'extracted-code',
            sources: [declaration.ref],
            attributes: {
              language: 'python',
              symbolKind: declaration.kind,
              module: document.module,
              scope: declaration.scope.join('.'),
            },
          });
      } catch (error) {
        diagnostic(file.path, String(error));
      }
    }
  } finally {
    parser.delete();
  }
  const resolver = new PythonResolver(documents);
  resolver.connect(facts);
  return resolver;
}
