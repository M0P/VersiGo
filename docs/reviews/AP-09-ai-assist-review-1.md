# Review 1 — AP-09-ai-assist

## Summary
- Critical: 0
- High: 3
- Medium: 5
- Minor: 4
- Verdict: CHANGES REQUIRED

## Findings

### High

- [High] Worker processor has no test coverage
- [High] CapabilityFlagsService registered with self-referencing `useExisting` alias
- [High] NoOpAIAdapter instantiated manually via `new` instead of DI

### Medium

- [Medium] Queue name constant defined in service but used in queue module (circular dependency risk)
- [Medium] Duplicate `tryParseExtractionResponse` logic in ollama and openai-compat adapters
- [Medium] Duplicate adapter implementations in worker processor
- [Medium] Worker package.json has no `test` script defined
- [Medium] Unnecessary `void` expression on parameter in controller

### Minor

- [Minor] Unused `AI_ADAPTER` re-export
- [Minor] `AiHealthCheckResponseDto` missing validation decorators
- [Minor] `JSON.parse(JSON.stringify(...))` pattern repeated
- [Minor] .env.example missing comment about AI_ENABLED=false
