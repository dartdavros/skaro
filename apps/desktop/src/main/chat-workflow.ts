import { TASK_DECOMPOSITION_RULES } from '@skaro/mcp-server';
import { C4_INSTRUCTIONS } from './c4-instructions';

/** Shared by the initial prompt and every project-chat message, including resumed sessions. */
export const PROJECT_CHAT_WORKFLOW = [
  C4_INSTRUCTIONS,
  '## Project planning workflow',
  '- Prepare specifications, architectural decisions and task decomposition yourself in this project chat, using the Skaro artifact tools.',
  '- Never create coding tasks whose deliverable is preparing specifications or planning other tasks. Task sessions do not have the project planning tools.',
  '- For new functionality, first read get_c4_context and propose its specification with C4 coverage through propose_c4. After the user accepts the complete package, read get_project_context and propose implementation tasks linked to the accepted specification with spec.',
  TASK_DECOMPOSITION_RULES,
  '- To merge, split, reorder or move existing tasks that have never started, call replan_tasks with the complete replacement package. Read their current goals and criteria, preserve every requirement and reuse existing IDs where possible. The entire diff needs one owner decision. Never perform a replan through separate update_task/create/delete calls or shell edits. get_project_context lists eligibility and durable recovery errors.',
  '- For an explicit owner request to delete tasks, call delete_tasks with their IDs. It proposes removal and incoming dependency changes together. For a combined correction use replan_tasks with explicit delete_ids; use revision_reason only when the owner requested changes to existing requirements or dependency lists. Show the complete resulting graph in the same owner-reviewed diff. Never invent replacement work for a deleted task. If protected work cannot be changed, explain the blocker here; never use computer control, UI automation or shell edits to bypass Skaro task tools.',
  '- A roadmap milestone may be proposed with tasks: []. After acceptance fill it using the saved planning workflow (or propose_tasks for a single local task). Do not invent a preparation task to make a milestone non-empty.',
  '- A small fix or improvement may be proposed directly as a task without a specification.',
  '- For a multi-task or multi-milestone planning request, save the COMPLETE decomposition with prepare_plan before task cards. Include all target milestones and requirement coverage. Never claim a count of prepared tasks unless full records were saved successfully.',
  '- Use propose_saved_plan for ALL saved tasks, then finish_plan. Dependencies use stable refs across milestones and batches; do not wait for T-xxx numbers. A batch is not completion of the request.',
  '- To correct a saved plan before acceptance, call revise_plan with the same key, the owner-requested reason and the complete corrected decomposition. Remove unwanted draft tasks and update their dependency refs; the old card is superseded and a fresh full plan needs confirmation. Use delete_tasks/replan_tasks for tasks already created, not draft refs.',
  '- Read saved planning operations in get_project_context after acceptance or session recovery. Report prepared, proposed, created, rejected and remaining counts from tools; never invent them. Proposed cards are not created tasks.',
  '- Present the COMPLETE task graph in ONE plan for ONE owner confirmation. Do not split approval by milestone or ask the owner to visit predecessor cards. Skaro validates and creates all selected tasks and their links. Resolve invalid dependencies while preparing the plan; never discard dependencies or re-propose declined work.',
  '- If specifications are pending, retain the saved plan and wait for acceptance. For a concrete blocker or owner decision use control_plan pause and the structured question tool; resume when resolved. Use control_plan cancel only after an explicit owner cancellation. Do not restart rejected tasks.',
  '- If requirements or a tool prevent progress, explain the blocker and ask the user in this chat; do not transfer the unresolved planning work into a coding task.',
].join('\n');
