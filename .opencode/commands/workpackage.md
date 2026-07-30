---
description: Implement one numbered work package with automated review-and-fix cycles
agent: coding-agent
subtask: false
---

Execute the complete implementation workflow for exactly this work package:

@prompts/$1

The work package number is: $1

Follow the coding-agent workflow exactly:
- Implement only this work package. Look at docs/reviews/NEXT-CODING-AGENT-PROMPT.md for instructions.
- Use @code-reviewer for every review.
- Save each review under docs/reviews/.
- Fix and re-review until there are no Critical, High, or Medium findings and no more than eight Minor findings.
- Commit only when the acceptance condition is met.
- After committing, create docs/reviews/NEXT-CODING-AGENT-PROMPT.md from the next numbered file in /prompts.
- Stop after creating that prompt; never start the next work package.
- Never push or merge.
