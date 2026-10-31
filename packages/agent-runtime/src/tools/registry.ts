import type { BuiltinToolScope } from '@skaro/timeline';
import { requireRouteCapabilities } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import { PathScope } from './path-scope.ts';
import { schemas, isToolName } from './schemas.ts';
import { findFiles, searchText, readText } from './file-search.ts';
import { applyFilePatch } from './file-patch.ts';
import { readScopedFile, fileHash } from './text-file.ts';
import { ToolProcesses } from './processes.ts';
import { RuntimeContext } from '../context/service.ts';
import { contextHistoryPage } from '../context/history.ts';
import { ExtensionRegistry, type RuntimeExtensionHost } from '../extensions/registry.ts';
import { sessionFileScope } from './session-scope.ts';
import { runCheck, checkEvidence } from '../verification/checks.ts';

export class ToolRegistry {
  readonly scope: PathScope;
  readonly processes: ToolProcesses;
  private readonly config: BuiltinToolScope;
  private readonly journal: RuntimeJournal;
  readonly extensions: ExtensionRegistry;
  private constructor(
    scope: PathScope,
    config: BuiltinToolScope,
    journal: RuntimeJournal,
    host?: RuntimeExtensionHost,
  ) {
    this.scope = scope;
    this.config = config;
    this.journal = journal;
    this.processes = new ToolProcesses(config, journal);
    this.extensions = new ExtensionRegistry(journal.state.config!.extensions ?? [], host);
  }
  static async create(
    config: BuiltinToolScope,
    journal: RuntimeJournal,
    host?: RuntimeExtensionHost,
  ): Promise<ToolRegistry> {
    const scope = await sessionFileScope(journal);
    return new ToolRegistry(scope, config, journal, host);
  }
  parse(name: string, args: unknown): { name: string; args: Record<string, unknown> } {
    if (this.extensions.has(name)) return { name, args: this.extensions.parse(name, args) };
    if (!isToolName(name)) throw new Error(`Unknown tool: ${name}`);
    const result = schemas[name].safeParse(args);
    if (!result.success) throw new Error(`Invalid arguments for ${name}`);
    return { name, args: result.data };
  }
  async execute(
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (this.extensions.has(name)) return this.extensions.invoke(id, name, args, signal);
    switch (name) {
      case 'run_check':
        return runCheck(id, args, this.scope, this.processes, this.journal, signal);
      case 'check_evidence':
        return checkEvidence(args, this.scope, this.journal, signal);
      case 'context_read': {
        const context = await RuntimeContext.create(this.journal);
        if (!context) throw new Error('Host context is not configured');
        const input = schemas.context_read.parse(args);
        return context.page(input.id, input.cursor, input.limit, signal);
      }
      case 'context_history':
        return contextHistoryPage(this.journal, schemas.context_history.parse(args));
      case 'find_files':
        return findFiles(this.scope, schemas.find_files.parse(args), signal);
      case 'search_text':
        return searchText(this.scope, schemas.search_text.parse(args), signal);
      case 'read_file':
        return readText(this.scope, schemas.read_file.parse(args), signal);
      case 'apply_patch':
        return applyFilePatch(this.scope, schemas.apply_patch.parse(args), signal);
      case 'exec_command': {
        const input = schemas.exec_command.parse(args);
        const cwd = await this.scope.path(input.cwd ?? '.');
        return this.processes.exec(id, input, cwd, signal);
      }
      case 'write_stdin':
        return this.processes.stdin(schemas.write_stdin.parse(args), signal);
      case 'stop_process': {
        const { processId } = schemas.stop_process.parse(args);
        await this.processes.stop(processId);
        return this.processes.output(processId, 0);
      }
      case 'update_plan': {
        const { steps } = schemas.update_plan.parse(args);
        if (
          steps.filter((step) => step.status === 'active').length > 1 ||
          new Set(steps.map((step) => step.id)).size !== steps.length
        )
          throw new Error('Plan IDs must be unique and at most one step can be active');
        await this.journal.append(`plan:${id}`, [
          { type: 'timeline', event: { t: 'plan.updated', steps } },
        ]);
        return { steps };
      }
      case 'view_image': {
        const assessment = this.config.capabilities;
        if (!assessment) throw new Error('Image capability is not verified for this route');
        requireRouteCapabilities(this.journal.state.config!.route, assessment, ['images']);
        const file = await readScopedFile(this.scope, schemas.view_image.parse(args).path, signal);
        const bytes = file.bytes;
        const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? 'image/png'
          : bytes[0] === 0xff && bytes[1] === 0xd8
            ? 'image/jpeg'
            : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
              ? 'image/gif'
              : bytes.subarray(0, 4).toString() === 'RIFF' &&
                  bytes.subarray(8, 12).toString() === 'WEBP'
                ? 'image/webp'
                : undefined;
        if (!mime) throw new Error('Unsupported image format');
        return { path: file.path, mime, sha256: fileHash(bytes), bytes: bytes.length };
      }
      case 'ask_user':
        throw new Error('Question lifecycle belongs to the tool coordinator');
    }
  }
}
