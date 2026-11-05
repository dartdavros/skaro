Skaro 2.2.18

- Fix C4 validation for tasks created before newer changes reached the base branch.
- Block implementation plans while required C4 amendments remain unapplied, including confirmation and recovery; plan approval never accepts architecture on the owner's behalf.
- Automatically clean completed tasks' unused worktrees while preserving tasks, conversation history, branches and commits. Local changes and ignored data prevent removal.
- Restore cleaned worktrees when continuing work, accessing files, changing agents or reverting a merge.
- Limit Docker cleanup to recorded Skaro environments. Remove global pruning and preserve unrelated resources and shared build caches.
- Allow clarification messages while a protected or multi-question async form is pending, without treating the message as credentials or completed answers.
