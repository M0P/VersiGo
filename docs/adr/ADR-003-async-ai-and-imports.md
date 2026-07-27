# ADR-003 Asynchrone AI- und Importjobs

## Status
Accepted

## Entscheidung
AI-Extraktion, AI-Zusammenfassungen und Integrationsimporte laufen asynchron über Job-Queues.

## Konsequenzen
- UI bleibt responsiv
- Retries und Fehlerisolierung werden einfacher
- Provider-Ausfälle beeinträchtigen Kernfunktionen nicht direkt
