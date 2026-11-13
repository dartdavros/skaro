import { createHash } from 'node:crypto';
import { DockerfileParser, Copy, Env, ModifiableInstruction } from 'dockerfile-ast';
import { hasCacheControls } from './managed-cache-files';

export class UnsupportedManagedBuild extends Error {}
export function unsupportedManagedBuild(reason = 'dockerfile_or_secret_source'): never {
  throw new UnsupportedManagedBuild(`managed_build_unsupported_${reason}`);
}
export const MANAGED_BUILD_BYTE_LIMIT = 128 * 1024 ** 2;
export const MANAGED_BUILD_NODE_LIMIT = 4096;
export const managedBuildHash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

/** A deliberately supported static subset, parsed by the upstream Dockerfile AST, never rewritten. */
export function validateManagedDockerfile(text: string) {
  if (Buffer.byteLength(text) > 128 * 1024 || /\0|\r(?!\n)/.test(text)) unsupportedManagedBuild();
  const ast = DockerfileParser.parse(text);
  if (ast.getDirectives().length || /^\s*#\s*(syntax|escape|check)\s*=/im.test(text))
    unsupportedManagedBuild('custom_frontend_or_directive');
  const instructions: { name: string; body: string; paths?: string[] }[] = [];
  let base = '';
  for (const instruction of ast.getInstructions()) {
    const name = instruction.getKeyword().toUpperCase();
    const body = instruction.getArgumentsContent() ?? '';
    if (!body || instructions.length >= 64 || body.includes('<<')) unsupportedManagedBuild();
    if (instruction instanceof ModifiableInstruction && instruction.getFlags().length)
      unsupportedManagedBuild('instruction_flags');
    if (name === 'FROM') {
      if (
        base ||
        instructions.length ||
        !/^(?:scratch|(?:(?:docker\.io\/)?library\/)?[a-z0-9][a-z0-9_.-]*(?::[A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64})$/.test(
          body,
        )
      )
        unsupportedManagedBuild('official_pinned_single_stage_required');
      base = body;
    } else if (!base) unsupportedManagedBuild();
    else if (instruction instanceof Copy) {
      let paths: string[];
      if (body.startsWith('[')) {
        try {
          paths = JSON.parse(body) as string[];
        } catch {
          unsupportedManagedBuild('copy_syntax');
        }
      } else {
        paths = instruction.getArguments().map((arg) => arg.getValue());
        // Shell COPY is not executed by a shell. Restrict to unambiguous literal tokens.
        if (paths.some((path) => /["'\\]/.test(path))) unsupportedManagedBuild('copy_syntax');
      }
      if (
        !Array.isArray(paths) ||
        paths.length < 2 ||
        paths.some(
          (path) =>
            typeof path !== 'string' || !path || /[$`\\]/.test(path) || hasCacheControls(path),
        )
      )
        unsupportedManagedBuild('copy_syntax');
      for (const path of paths.slice(0, -1))
        if (path.startsWith('/') || /[:*?[\]]/.test(path) || path.split('/').includes('..'))
          unsupportedManagedBuild('external_or_dynamic_copy');
      instructions.push({ name, body, paths });
      continue;
    } else if (instruction instanceof Env) {
      if (
        instruction.getVariables().length ||
        /[$`]/.test(body) ||
        !instruction.getProperties().length
      )
        unsupportedManagedBuild('dynamic_env');
      for (const property of instruction.getProperties())
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(property.getName()) || property.getValue() === null)
          unsupportedManagedBuild('env_syntax');
    } else if (name === 'RUN') {
      if (base === 'scratch' || body.startsWith('--')) unsupportedManagedBuild('run_profile');
      if (body.startsWith('[')) {
        try {
          const args: unknown = JSON.parse(body);
          if (!Array.isArray(args) || !args.length || args.some((arg) => typeof arg !== 'string'))
            unsupportedManagedBuild();
        } catch {
          unsupportedManagedBuild('run_syntax');
        }
      }
    } else if (
      !['WORKDIR', 'EXPOSE', 'USER', 'CMD', 'ENTRYPOINT', 'STOPSIGNAL'].includes(name) ||
      instruction.getVariables().length
    )
      unsupportedManagedBuild();
    instructions.push({ name, body });
  }
  if (!base) unsupportedManagedBuild();
  return { base, instructions, recipeDigest: managedBuildHash(text) };
}

/** Compatibility policy: the default/offline profile remains bounded scratch-only. */
export function requireManagedScratch(text: string) {
  const { base, instructions } = validateManagedDockerfile(text);
  if (base !== 'scratch') unsupportedManagedBuild('unknown_base_expansion');
  let copies = 0,
    workdirs = 0,
    metadata = 0;
  if (instructions.length > 16) unsupportedManagedBuild();
  for (const { name, body, paths } of instructions) {
    if (name === 'COPY') {
      if (
        ++copies > 1 ||
        paths!.length !== 2 ||
        !['/app', '/app/'].includes(paths![1]!) ||
        paths![0]!.split('/').length > 8
      )
        unsupportedManagedBuild('copy_expansion');
    } else if (name === 'WORKDIR') {
      if (++workdirs > 1 || !['/app', '/app/'].includes(body))
        unsupportedManagedBuild('workdir_expansion');
    } else if ((metadata += Buffer.byteLength(body)) > 4096) unsupportedManagedBuild();
  }
}
