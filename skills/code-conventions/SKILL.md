---
name: code-conventions
description: Required conventions for code comments, docstrings, git history, commit messages, PR descriptions, and prose style. Load BEFORE writing or editing any code, adding or revising comments/docstrings, committing, or writing a PR description or review reply — in any repository.
related: [stack-changes]
---

## Documentation
Names, signatures, and public interfaces are the primary documentation of a
codebase. A comment is a fallback — an admission something couldn't be
expressed in code, like an invariant upheld only by convention or a contract
callers can't see from the interface.

- Before writing a comment to guard an invariant, uphold it structurally
  (types, asserts, encapsulation) when the fix is local and cheap. When it
  isn't, write the comment and flag the restructuring opportunity in your
  report.
- Write only load-bearing comments. Restating what the code does, narrating
  how it changed over time, or describing callers is noise — that context
  belongs in commit messages.
- TODO comments are load-bearing: they pin a known gap or planned change to
  the exact code it concerns, which no issue or commit can do. Keep them
  (anchored to an issue like `TODO(#120)` when one exists); never flag them
  as noise.
- Docstrings meet the same bar: document the contract (units, error behavior,
  ownership). A docstring that restates the signature shouldn't exist.
- While changing a region, delete its non-conforming comments in the same
  commit — as-you-go cleanup; don't derail the main task with a repo-wide
  purge. Before deleting, check the comment's history: if the commit that
  introduced it shows it guards something real, it is load-bearing — keep it
  or make it structural.

## History and Commits
- Before changing existing code, study its history to understand why it is
  the way it is. Depth proportional to how surprising or load-bearing the
  code is, but never skip the check. Code with no history (greenfield, or
  written by you this session) is exempt.
- Commit messages carry the why: considerations, constraints, and rejected
  alternatives — the full context at the time of writing. The diff already
  shows the what.
- Make atomic commits of only YOUR changes as you work. Each commit builds,
  is in a working state, and has automated formatting applied.
- Never squash-merge; commit history survives merges intact. PR descriptions
  stay high-level and point out what human reviewers need to know.

## Style
- Keep answers short and concise.
- No fluff or cheerful filler text.
- Technical prose only; be kind but direct (e.g., "Thanks @user" not
  "Thanks so much @user!").
- Do not write mannered prose.
