# AP-24 Review – Round 4

> **Work package:** `BugFix-22-KOSTENBERECHNUNG_BRUTTO_NETTO and AP-24-detailverbesserungen`
> **Branch:** `feature/ap-24-detailverbesserungen` · **Commit:** `a812a59`
> **Reviewer:** `code-reviewer` subagent, invoked via Task, session `ses_eaf8effbdffeA2u4PLTxgcH3b2` (continued from rounds 1–3)
> **Scope of this round:** exclusively the post-commit handoff document
> `docs/reviews/NEXT-CODING-AGENT-PROMPT.md`, which had been rewritten *after*
> the round-3 PASS and was therefore not yet covered by any review.
> The application code is unchanged since round 3 and was not re-reviewed.
> **Outcome:** `VERDICT: PASS` — **0 Critical, 0 High, 0 Medium, 0 Minor.**

---

All concrete claims in `docs/reviews/NEXT-CODING-AGENT-PROMPT.md` are verified against the supplied evidence and the repository:

| Claim | Evidence |
|-------|----------|
| Branch `feature/ap-24-detailverbesserungen` from `868bc78`, commit `a812a59`, 82 files +8384/−710 | `git log --oneline -1`, `git show --stat` |
| `main`/`origin/main` in sync at `868bc78`, feature branch 1 commit ahead | `git rev-list --count`, `git log --oneline -1 origin/main`, `git log --oneline -1 main` |
| AP-01.1 byte-identical to AP-02 | `cmp prompts/AP-01.1... prompts/AP-02...` → "FILES ARE IDENTICAL" |
| Scaffold directories exist | `ls -d apps/api apps/web apps/worker packages/foundation` |
| Review outcomes (3 rounds) | Match `docs/reviews/AP-24-review-1/2/3.md` verbatim |
| Medium findings fixed with 5 new tests | Gate: "873 api tests = 868 before + 5 new where-clause assertions" |
| All verification steps (build, gate, smoke) | `04-gate-check-output.txt`, `08-smoke-check-output.txt` |
| Test counts 1288 (web 234/17, foundation 122/13, worker 59/4, api 873/68) | Gate output lines 26-33 |
| Minor m1 (string-scan fragility) | My round 3 finding |
| Cost-extraction manual QA not performed | Disclosed in `docs/06-integrations.md:94-97` |
| Drift guard enums-only | Work package statement |
| Pre-existing `.opencode/agents/*.md` deletions | `git status --porcelain` shows `D .opencode/agents/code-reviewer.md` and `D .opencode/agents/coding-agent.md` |
| Host licence check fails, container passes | "Host-only licence check failure... Checked 578 packages" vs container "Checked 563 packages" |
| Podman `-f Dockerfile.test` requirement | Gate note: "earlier attempt omitted -f Dockerfile.test... never executed license/version/i18n" |
| Host `node_modules` stale (2026-08-08) vs lockfile (2026-10-18) | Evidence explicitly states both timestamps |
| Trilium note `BRpbPoqTaGKk` append verified | "Trilium note `BRpbPoqTaGKk` append verified (`blobId` became `xNNJlPJ4iktOCZ1NuXI3`)" |

No misleading verification claims — the document explicitly distinguishes host vs container checks and states the manual QA was **not performed**. No secrets or personal data. Internally consistent with review reports and gate outputs. Actionability is clear: "NONE — await an explicit instruction from the user."

**VERDICT: PASS**
