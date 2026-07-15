---
name: ahk-review
description: Preview a code review against ticket/objective alignment, with deep semantic (name-vs-behavior) analysis. No tasks created, no harness tracking.
---

You are in **lightweight review mode**. The ticket/objective: $ARGUMENTS

> If `$ARGUMENTS` is empty, ask the user to provide the ticket guidelines or objective before doing anything else.

## Rules
- NO MCP calls — no tasks.*, no actions.*, no tasks.acceptance.update, no other MCP write of any kind
- NO health.sh unless explicitly relevant to the objective
- NO builder, NO reviewer
- Create files ONLY if user explicitly asked to save the output
- This is a preview/rubric generator, not the official reviewer — it never mutates harness state

## Process

1. Proactively enumerate the skills currently available/installed in your context and decide which are relevant to the objective. The provider has already injected available skills into your context — check what skills you are aware of, identify which are relevant to this objective, and reference them explicitly in your review. If no installed skills seem relevant to the objective, recommend running `npx autoskills` to fetch appropriate skill packs.

2. Invoke **Explorer** as a subagent with this exact instruction:
   > "Read-only review investigation — no MCP harness, no task creation. Ticket/objective: `$ARGUMENTS`. Map the files relevant to this objective — what changed, what's implicated, what patterns are involved. Additionally, for each relevant function or module you touch, read its full body and evaluate whether its name matches what it actually does — flag any name/behavior mismatch with an exact file:line reference, even if the mismatch falls outside the direct scope of the stated objective. Return both the file map and the name/behavior audit as plain structured text."

3. Synthesize the ticket/objective guidelines, the relevant skills identified in step 1, and Explorer's findings (including any name/behavior divergences) into the REQUIRED output format below. Do not skip or reorder sections.

## Required output format

---

**Alineación con el ticket**
Qué tan bien el código/cambio se alinea con el ticket u objetivo declarado. Señala cualquier desviación.

**Hallazgos de nomenclatura y semántica**
Divergencias entre el nombre de una función/módulo y su comportamiento real, con referencia exacta `archivo:línea` para cada una. Si no se encontró ninguna, indica "ninguno encontrado".

**Skills aplicadas**
Skills de tu contexto que aplican a este objetivo, o la recomendación de `npx autoskills` si ninguna aplica.

**Checklist de acceptance criteria propuesto**
Lista concreta y verificable de criterios de aceptación derivados del ticket/objetivo y de los hallazgos anteriores.

**Riesgos y deuda técnica**
Riesgos, deuda técnica o efectos secundarios que el cambio podría introducir.

---
