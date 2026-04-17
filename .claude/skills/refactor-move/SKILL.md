---
name: Refactor-Move
description: Safely move or rename files/folders by finding all import references first, updating them, then verifying no broken paths remain. Use when moving JS modules, reorganizing directories, or renaming files that are imported elsewhere.
user-invocable: true
disable-model-invocation: false
---

# Refactor-Move

When moving or renaming files:

1. **Map dependencies first** — spawn a Haiku subagent (`model: haiku`) to grep the entire codebase for every import/require of the old path(s); collect results before touching anything
2. **List the plan** — show which files will move and which imports will be updated; wait for confirmation if the scope is large
3. **Move the files** — rename or relocate
4. **Update all references** — fix every import path found in step 1
5. **Verify** — run a preview or build check; look for 404s or module-not-found errors in console logs
6. **Report** — summarize what moved and what was updated
