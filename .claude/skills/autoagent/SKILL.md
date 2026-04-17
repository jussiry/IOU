---
name: autoagent
description: Analyze the user's task against the current model's capabilities and decide whether to run inline, escalate to a single more-capable subagent, or parallelize across multiple subagents. Only spawn subagents when the current agent is clearly not the right fit.
user-invocable: true
disable-model-invocation: true
---

# autoagent

Route the user's task to the right model/agent configuration. **Default bias: run inline** (no subagents). Only spawn subagents when there's a clear reason.

## Step 1 — Analyze the task

Briefly (2–4 sentences) consider:

- **Complexity** — does this need deeper reasoning than the current model provides?
- **Parallelizability** — are there independent sub-tasks that could run concurrently?
- **Scope** — is this a large read/grep-heavy task that would bloat main context?
- **Context dependence** — does the task rely heavily on prior conversation? (If yes, prefer inline — subagents lose context.)

## Step 2 — Choose one routing decision

Pick the **least** intervention that fits:

| Situation | Action |
|---|---|
| Current model handles it fine | **Run inline** — do not spawn |
| Task is clearly beyond current model's reasoning depth | Spawn **one** subagent on a more capable model |
| Task has independent parts that can run in parallel | Spawn **multiple** subagents (use cheapest model sufficient for each part) |
| Task is read-heavy / grep-heavy and would bloat context | Spawn a **Haiku** subagent for the exploration |

**Do not spawn when:**
- The current model is already capable enough
- The task needs full conversation context
- Routing overhead would exceed the benefit

## Step 3 — Inform the user

Before spawning, output a short block like:

```
Routing decision: <inline | 1 subagent | N parallel subagents>
Reason: <one sentence>
Spawning: <model> (effort: <level if controllable>)
Context passed: <summary of what the subagent will receive>
```

If running inline, just say: `Routing decision: inline — <reason>` and proceed.

## Step 4 — Pass good context to subagents

Subagents start fresh — they see only what you pass. From the analysis step, include:
- The specific goal (not just the raw user prompt)
- Relevant file paths already identified
- Constraints or acceptance criteria already discussed
- What to report back (e.g. "under 200 words", "list of file paths only")

## Step 5 — Execute and report

After subagents return, briefly tell the user what came back and what you're doing with it.

---

**Guardrails:**
- Never spawn single subagent with same model as the current model (pointless cost)
- Never spawn when a single `Grep` or `Read` call would suffice
- If unsure whether escalation is needed, run inline and mention that you could escalate if the result is insufficient