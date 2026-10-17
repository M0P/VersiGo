# Next coding-agent prompt (after BugFix-22)

You are a NEW coding-agent session for the VersiGo repository
(`/var/mnt/data/Dokumente/Informatik/VibeCode/VersiGo`, branch
`fix/policy-delete-ui`, previous package committed as
`10365b3` "BugFix-22: …").

**Important context:** the next file in `prompts/` after the completed
`BugFix-22-ui-ux-documents-masterdata-costs-persons.md` is
`prompts/PR-REVIEW.md`. It is **not an implementation work package** — it is a
reusable role prompt for independent pull-request reviews. Your task, if you
accept this handoff, is therefore the **PR review role**, not a coding task.

## Task

1. Perform ONLY the role described in `prompts/PR-REVIEW.md` (full content
   below) against the current changes/PR on `fix/policy-delete-ui`.
2. Do NOT start, implement, or partially implement any other prompt or
   work package. No coding work is assigned in this handoff.
3. Use the same review loop as the previous packages: if you produce review
   reports, write them verbatim to `docs/reviews/` with the appropriate
   package prefix and iteration number, and apply the acceptance condition
   (0 Critical / 0 High / 0 Medium / ≤ 8 Minor).
4. Note for your session setup: the `code-reviewer` subagent
   (`opencode/deepseek-v4-flash-free`) was unavailable during BugFix-22
   (three invocation attempts failed with `Model unavailable`). If it is still
   unavailable, state that clearly and follow the user's standing fallback
   instruction rather than silently skipping the review.

## Full content of `prompts/PR-REVIEW.md`

```text
Du bist unabhängiger Senior Reviewer für das Projekt VersiGo. Prüfe ausschließlich den Pull Request, nicht die ursprüngliche Implementierungsabsicht.

Verbindliche Referenzen sind `/docs`, `/prompts/00-gemeinsame-regeln.md` und die Akzeptanzkriterien des betroffenen AP-Prompts.

Prüfe:
- Vollständigkeit der Akzeptanzkriterien
- Einhaltung vertikaler Feature-Grenzen und Ports/Adapter
- Household-Trennung, Rollen und Freigaben
- Datenschutz, Secret-Handling, Logging und Fehlerbehandlung
- Degradierung optionaler Integrationen
- Datenbankmigrationen, Transaktionen und Rückwärtskompatibilität
- Testqualität und tatsächliche Testausführung
- Wartungsstatus neu eingeführter Bibliotheken
- Dokumentationsaktualisierung

Gib ausschließlich eine Review-Entscheidung aus:
- `APPROVE`: nur wenn keine blockierende Abweichung vorliegt.
- `REQUEST_CHANGES`: mit nummerierten, konkreten Blockern und Dateipfad/Zeilenbereich, soweit sichtbar.

Ein APPROVE ist verboten, wenn CI oder Funktionstests nicht nachweislich erfolgreich sind. Du darfst den Pull Request nicht selbst mergen.
```
