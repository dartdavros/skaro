# Connect Codex or Claude Code

Skaro runs tasks through Codex and Claude Code using your own agent account. At least one agent must be downloaded and ready before you can work with projects. You do not need to connect both.

## Download and sign in

1. Open **Settings → Agents**.
2. Find **Codex** or **Claude Code**. If it is not installed, click **Download now** and wait for the download to finish.
3. If the account is **Not signed in**, click **Sign in**. Complete the provider's sign-in flow yourself in the window or browser it opens.
4. Return to Skaro. Use **Check again** if the displayed status has not refreshed.
5. Confirm that the agent shows **Ready** and a signed-in account.

Use an account entitled to use the selected agent. Available models and usage limits depend on that account. Skaro does not supply an agent subscription or additional quota.

Skaro manages pinned agent versions that belong to its tested application bundle. You do not need to install a separate arbitrary CLI version with npm to follow this guide. Update managed agents through [Skaro's update flow](/articles/update-skaro).

## Choose a model and effort

In the agent's settings, select **Default model** and, where supported, **Effort**. The model list comes from the connected agent. It may take a moment to load after downloading or signing in.

These are defaults. A task or chat can use its own agent and model. The task's agent settings also let you inspect permissions, isolation and whether to plan first.

![The actual task agent dialog lets you inspect the selected agent, model and execution options.](../images/task-agent.jpg)

The screenshot uses an existing project. Its task text keeps the project's original language; the Skaro controls are in English. Model names are examples from this connected account, not a guaranteed catalog for every account.

## Check the project defaults

Open a project and select **Parameters** to inspect its agent defaults. Before starting a task, verify the agent and model shown for that task; changing a global default does not mean every existing task will adopt it.

Keep permissions appropriate to the job. **Full access** permits broader actions. **Separate branch** isolates Git changes in a worktree, but is not itself a security sandbox. See [Run Tasks and Work with Agents](/articles/run-tasks).

## If the agent is not ready

- **Not downloaded:** finish the download in Settings. Check the network and available disk space if it fails.
- **Not signed in or an authorization error:** sign in through that agent's account flow, then check again. Do not delete credential files as a routine repair step.
- **No model list yet:** wait for loading to finish and retry the status check. A failed model request is not proof that the account has no models.
- **Limit reached:** open **Remaining usage** from a project's sidebar and inspect the provider's reported windows and reset times.

Usage is shared with other applications and projects using the same provider account. Missing quota information does not mean zero remaining quota.

Next: [Start Here: Your First Project in Skaro](/articles/start-here).
