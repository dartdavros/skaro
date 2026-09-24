import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowAll, type PermissionLevel, type ProbeSession, type Responder } from './session.ts';

export interface Scenario {
  id: string;
  title: string;
  permission: PermissionLevel;
  authMissing?: boolean;
  sandbox?: boolean;
  /** Codex: needs the experimental API. */
  experimental?: boolean;
  responder?: Responder;
  run(session: ProbeSession): Promise<void>;
}

/** Golden scenarios (docs/agent-output.md, P8). Prompts ask for short answers to keep sessions small. */
export const scenarios: Scenario[] = [
  {
    id: 'read',
    title: 'Reading and search',
    permission: 'ask',
    run: async (s) => {
      await s.turn(
        'Read src/math.js and README.md, and search the repo for the word "assert". Then describe the project in one sentence. Do not modify anything.',
      );
    },
  },
  {
    id: 'edit',
    title: 'File edits',
    permission: 'auto',
    run: async (s) => {
      await s.turn(
        'Fix the bug in src/math.js so that add() returns the sum, and create CHANGELOG.md with one line describing the fix. Do not run any commands.',
      );
    },
  },
  {
    id: 'failing-command',
    title: 'Failing command',
    permission: 'full',
    run: async (s) => {
      await s.turn(
        'Run `node test.js` once and report the result in one sentence. Do not fix anything.',
      );
    },
  },
  {
    id: 'background-command',
    title: 'Background command',
    permission: 'full',
    run: async (s) => {
      await s.turn(
        'Start this command in the background: node -e "setTimeout(() => console.log(\'tick done\'), 8000)". ' +
          'Tell me it started, then wait for it to finish and report its output.',
      );
      // The agent may end the turn while the command runs and report in a later, self-started turn.
      await s.waitFor((e) => e.t === 'turn.completed', 60_000).catch(() => undefined);
    },
  },
  {
    id: 'agent-plan',
    title: 'Multi-step task with the agent plan',
    permission: 'full',
    run: async (s) => {
      await s.turn(
        'Do these three steps one by one and track them in your task list / plan as you go: ' +
          '1) fix add() in src/math.js, 2) add an assertion for mul(0, 5) to test.js, 3) add a "Usage" section to README.md. ' +
          'Run `node test.js` at the end. Keep the final answer to two lines.',
      );
    },
  },
  {
    id: 'question',
    title: 'Question to the user',
    permission: 'ask',
    experimental: true,
    run: async (s) => {
      await s.turn(
        'Before doing anything, ask me which approach I prefer, using your tool for asking the user a question with options: ' +
          '"Fix in place" (change the operator in add) or "Rewrite" (rewrite src/math.js). ' +
          'After I answer, just tell me what I chose. Do not modify files.',
      );
    },
  },
  {
    id: 'permission',
    title: 'Permission requests: deny, then allow',
    permission: 'ask',
    responder: (() => {
      let first = true;
      return (interaction) => {
        if (interaction.kind === 'approval' && first) {
          first = false;
          return {
            kind: 'approval',
            choice: 'deny',
            message: 'Not this one, try running the command instead.',
          };
        }
        return allowAll(interaction);
      };
    })(),
    run: async (s) => {
      await s.turn(
        'Create a file hello.txt containing "hi", then run `node --version` and tell me the version.',
      );
    },
  },
  {
    id: 'subagent',
    title: 'Subagent',
    permission: 'full',
    experimental: true,
    run: async (s) => {
      await s.turn(
        'Delegate this to a subagent: find every function defined under src/ and list them with a one-line description. ' +
          'Then summarize the subagent result in two lines.',
      );
    },
  },
  {
    id: 'interrupt',
    title: 'Interrupt a running command',
    permission: 'full',
    run: async (s) => {
      const done = s.waitFor((e) => e.t === 'turn.completed');
      await s.send(
        'Run node -e "setTimeout(() => {}, 120000)" in the foreground and wait for it to finish.',
      );
      const running = s.waitFor(
        (e) => e.t === 'item.upsert' && e.item.kind === 'command' && e.item.status === 'running',
      );
      running.catch(() => undefined);
      // The turn may end without a command (e.g. usage limit); interrupt only if the command started.
      if (
        (await Promise.race([done.then(() => 'done'), running.then(() => 'running')])) === 'running'
      ) {
        await new Promise((r) => setTimeout(r, 3000));
        await s.interrupt();
        await done;
      }
    },
  },
  {
    id: 'auth-error',
    title: 'Not logged in',
    permission: 'ask',
    authMissing: true,
    run: async (s) => {
      await s.turn('Say hi.');
    },
  },
  {
    id: 'compaction',
    title: 'Context compaction',
    permission: 'ask',
    run: async (s) => {
      await s.turn('Read src/math.js and tell me what add() does, in one sentence.');
      await s.compact();
      await s.turn('What file did you read before? One line.');
    },
  },
  {
    id: 'image',
    title: 'Images: agent views a file, user attaches one',
    permission: 'ask',
    run: async (s) => {
      await s.turn(
        'Look at the image file diagram.png in the repo and describe it in one sentence.',
      );
      await s.turn('What shape and color is in the attached image? One sentence.', ['diagram.png']);
    },
  },
  {
    id: 'plan-first',
    title: 'Plan first, approve, then implement',
    permission: 'plan',
    experimental: true,
    run: async (s) => {
      await s.turn('Fix the bug in add() in src/math.js. Keep the plan to three steps or fewer.');
      if (
        !s.events.some(
          (e) => e.t === 'interaction.opened' && e.interaction.kind === 'plan_approval',
        )
      ) {
        await s.approvePlan();
      }
    },
  },
  {
    id: 'question-plan',
    title: 'Question to the user while planning',
    permission: 'plan',
    experimental: true,
    run: async (s) => {
      await s.turn(
        'Before planning, ask me which approach I prefer, using your tool for asking the user a question with options: ' +
          '"Fix in place" (change the operator in add) or "Rewrite" (rewrite src/math.js). Then give a one-step plan for my choice.',
      );
    },
  },
  {
    id: 'rewind',
    title: 'Rewind to a previous message',
    permission: 'full',
    run: async (s) => {
      await s.turn('Create notes.txt containing exactly one line: one. Reply "ok" only.');
      await s.turn('Append a second line "two" to notes.txt. Reply "ok" only.');
      const before = readFileSync(join(s.workspace, 'notes.txt'), 'utf8');
      await s.rewind(2);
      const after = readFileSync(join(s.workspace, 'notes.txt'), 'utf8');
      console.log(
        `notes.txt before rewind: ${JSON.stringify(before)}; after: ${JSON.stringify(after)}`,
      );
      await s.turn(
        'What does notes.txt contain now, and what was the last thing I asked you before this message? Two lines.',
      );
    },
  },
  {
    id: 'sandbox',
    title: 'Sandboxed commands (auto mode)',
    permission: 'auto',
    sandbox: true,
    run: async (s) => {
      await s.turn(
        'Run `node --version`. Then try to create a file one directory above the repo root (../skaro-probe-outside.txt) using a shell command. Report exactly what happened for each, in two lines.',
      );
    },
  },
];
