---
slug: "opencode-v2-provider-tech"
title: "Diseño técnico: proveedor OpenCode V2"
description: "Materializador nativo v2, JSONC seguro, agentes, modelos, permisos, plugin de notificaciones, migración y matriz de validación."
spec_kind: spec-tech
status: approved
created_at: "2026-10-24T09:07:16.113Z"
last_updated: "2026-10-24T09:07:27.697Z"
source_spec: opencode-v2-provider
---
# Diseño técnico: proveedor OpenCode V2

## Fuente, estado y evidencia

Fuente funcional: [opencode-v2-provider.md](opencode-v2-provider.md), aprobada por el mantenedor el 2026-10-24. El usuario pidió además iniciar la implementación en esta misma sesión. Este documento recoge el diseño del alcance aprobado; la autorización de implementación no equivale a evidencia de funcionamiento.

Documentación primaria consultada mediante Context7 (/websites/opencode_ai_v2) y web oficial:
- [Migración](https://opencode.ai/v2/docs/migrate-v1/).
- [Config](https://opencode.ai/v2/docs/config/), [MCP](https://opencode.ai/v2/docs/mcp-servers/).
- [Agentes](https://opencode.ai/v2/docs/agents/), [permisos](https://opencode.ai/v2/docs/permissions/), [modelos](https://opencode.ai/v2/docs/models/).
- [Skills](https://opencode.ai/v2/docs/skills/), [comandos](https://opencode.ai/v2/docs/commands/), [instrucciones](https://opencode.ai/v2/docs/instructions/).
- [Plugins](https://opencode.ai/v2/docs/build/plugins), [migración de plugins](https://opencode.ai/v2/docs/build/plugins/migrate-v1/).

El informe Graphify de junio de 2026 se utilizó para orientación; las conclusiones se contrastaron con código actual. AHK está en 3.0.0; el SDK MCP servidor y cliente en 2.3.1. No hay dependencia instalada de OpenCode. La versión concreta v2 de validación debe quedar registrada antes de declarar compatibilidad runtime.

## Estado actual e inventario de impacto

| Archivos o módulos | Evidencia y cambio previsto |
|---|---|
| src/types.ts:6; src/core/materializer/index.ts | Provider tiene cinco valores. Añadir opencode-v2 y su materializador. |
| src/core/materializer/opencode.ts:30 | Genera cinco agentes, AGENTS.md, skills y opencode.json. Reutilizar contenidos, propiedad y respaldos; separar serialización v2. |
| src/core/materializer/mcp-merge.ts:283 | JSON.parse con fallback destructivo; MCP directo, enabled, permission y compaction legacy. Crear merge v2 seguro. |
| src/core/materializer/templates.ts:750; agent-restrictions.ts:96 | Frontmatter legacy permission/edit y name heredado. Añadir traductor completo v2 y restricciones por rol. |
| src/core/materializer/delegation-guidance.ts; provider-research-capabilities.ts | Tablas exhaustivas por proveedor; incorporar delegación y capacidades v2. |
| src/commands/init.ts; migrate.ts; src/cli.ts | Listas, selectores, ayuda y resúmenes de proveedor. |
| src/commands/models.ts:25; agent-preferences.ts; tipos de preferencias | OpenCode está excluido por guard, no cae a Cursor en ejecución normal. Añadir ruta propia v2, persistencia e herencia. |
| src/core/maintenance/config.ts; operations.ts; maintenance-tools.ts | Validaciones, roots, planes, init/build/migrate/reset/models y exposición MCP. |
| src/core/doctor.ts; operational-notices.ts | Rutas y diagnóstico de agentes/skills/configuración efectiva. |
| src/core/materializer/skill-migrations.ts; scaffold-utils.ts | Reconocer proveedor y preservar límites de migración, estado, propiedad y respaldos. |
| src/core/notifications/{types,config,providers,install,runtime}.ts; src/commands/notifications.ts | Adaptador v2, identidad, instalación y propiedad; revisar todos los enums y validadores relacionados. |
| README.md; docs/; src/core/materializer/skills/ahk-docs/resources/ | Documentar elección, límites, recuperación y pruebas. |
| src/tests/ | Añadir cobertura de proveedor y ampliar matrices existentes sin relajar regresiones v1. |

Los puntos de entrada deben volver a localizarse durante implementación mediante búsqueda de opencode y tablas Provider; el inventario no sustituye comprobar los usos indirectos o exhaustivos.

## Límites y arquitectura

Crear OpenCodeV2Materializer en src/core/materializer/opencode-v2.ts. Mantener OpenCodeMaterializer como backend v1. Reutilizar contenido de los roles, plantillas de skills, helpers de propiedad, detección de package manager y scaffold de health. Separar el traductor de frontmatter, merge MCP, políticas de permisos y plugin v2.

Contrato estable de AHK: Provider incluye opencode-v2, etiqueta OpenCode V2. No cambiar el contrato de tareas, acciones, health ni almacenamiento. Las operaciones CLI y MCP deben delegar en los mismos servicios de mantenimiento; no crear una segunda implementación de migración.

Flujo: entrada validada → config/preferencias → plan de archivos y conflictos → comprobación de propiedad y respaldo → materializador v2 → verificación de lecturas → reporte. Cuando una operación requiera varias escrituras, no actualizar el proveedor persistido antes de asegurar que los archivos preparados son válidos; usar la recuperación del servicio existente y evitar afirmar atomicidad de todo el filesystem.

## Configuración y contrato MCP

Forma nativa inicial:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "lead",
  "compaction": { "auto": true, "buffer": 10000 },
  "permissions": [
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "external_directory", "resource": "*", "effect": "ask" }
  ],
  "mcp": {
    "servers": {
      "agent-harness-kit": {
        "type": "local",
        "command": ["<package-manager executable>", "<existing AHK invocation arguments>"],
        "disabled": false,
        "codemode": false
      }
    }
  }
}
```
El array de command es ilustrativo: construirlo con getMcpCommandParts y la detección existente, incluyendo puerto/cwd según el contrato actual; nunca escribir los placeholders. No añadir shell interpolation ni URL HTTP si el transporte actual es stdio.

Codemode false es la decisión inicial para AHK: mantener herramientas directamente descubribles y permisos por herramienta. No alterar Code Mode de otros servidores. Mantener protocolo legacy por defecto; no forzar auto ni actualizar el SDK MCP sin evidencia. Si se administra timeout, usar objetos catalog/execution; no inventar valores distintos de los defaults actuales sin justificarlo. OAuth y servidores remotos ajenos se preservan, no se migran ni autentican automáticamente.

No emitir prune ni reserved en contenido nativo generado; reserved pasa a buffer. La política de preservación prevalece sobre defaults: no reemplazar compaction o permisos personalizados con los del ejemplo. Transformar solo valores de propiedad AHK reconocida y reportar conflictos entre formas v1/v2 para una misma clave.

### JSONC y ubicaciones

Reconocer opencode.json y opencode.jsonc tanto en la raíz como en .opencode. Inspeccionar las cuatro ubicaciones antes de decidir destino. Para proyecto nuevo usar raíz/opencode.json; para uno existente editar el destino declarado en el plan que contiene la entrada administrada. No crear una segunda entrada AHK que quede oculta por otra de mayor precedencia. Si no se puede identificar un destino sin ambigüedad, devolver diagnóstico de conflicto con las rutas y sin mutación.

Utilizar un parser/editor JSONC con errores estructurados y ediciones localizadas. Preservar comentarios y claves ajenas. Definir primero en Zod cualquier contrato nuevo de preferencias/entrada pública y derivar sus tipos. Archivo malformado, tipo raíz inválido, estructura MCP inválida o ruta insegura → error explícito sin escritura. Nunca catch-and-start-fresh.

Modificar solo las claves administradas y campos requeridos del servidor AHK; conservar campos adicionales compatibles. Proteger enlaces simbólicos y rutas fuera del proyecto con las garantías existentes. Verificar backup antes de reemplazar contenido y usar escritura temporal/rename cuando el helper disponible lo permita.

## Agentes, permisos y delegación

Mantener .opencode/agents/{lead,explorer,consultant,builder,reviewer}.md. Convertir toda la cabecera a v2: retirar name heredado, tools/disallowedTools, permission, disable y sampling legacy que el traductor encuentre; conservar descripción y cuerpo, añadir mode explícito y modelo opcional. No mezclar un campo v2 con frontmatter v1, porque cambia la interpretación de toda la definición.

- lead: primary; los otros cuatro roles: subagent.
- model: provider/model#variant cuando hay elección; omitirlo si se hereda.
- permissions: array nativo; restricciones específicas por rol, manteniendo builder capaz de implementar.
- No inventar variantes en base a etiquetas de esfuerzo: validar contra documentación/catálogo del runtime elegido o aceptar una referencia explícita del usuario.
- Las opciones específicas de inferencia pertenecen a variantes del modelo, no a campos sampling del agente.

Las reglas son ordenadas: última coincidencia gana. Para roles no implementadores, denegar edit y establecer shell deny por defecto con excepciones acotadas para inspección y comprobaciones necesarias. No permitir patrones amplios como git * o ejecutores arbitrarios para aparentar solo lectura. Reviewer necesita ejecutar health/tests previstos por el flujo: definir excepciones concretas para comandos del proyecto y documentar que esos procesos pueden producir artefactos locales. Evitar afirmar aislamiento absoluto.

Revisar permisos subagent del lead para delegar a los cuatro roles, y de los otros roles según el flujo canónico. No copiar prefijos mcp__ de Claude/Codex; usar nombres normalizados OpenCode. Mantener accesibles las herramientas MCP necesarias para acciones y handoffs.

Actualizar guidance: invocar roles mediante capacidad subagent documentada, tareas autocontenidas, contexto fresco, esperar resultados dependientes y consolidar sesiones en background. Validar cualquier sintaxis de @mention antes de incluirla como instrucción v2.

## Preferencias de modelo

Añadir preferencias de opencode-v2 y tipos/validación propios, con referencia de modelo opcional e herencia explícita. Integrar prompts de init/models/build --force y servicios MCP correspondientes usando las convenciones existentes de persistencia.

No introducir una lista fija de nombres de modelos. Mantener preferencias de otros proveedores. Para edición de configuración usar el servicio administrado actual. Un build ordinario conserva archivos personalizados y elecciones actuales; una regeneración explícita respalda antes de reemplazar. Validar variantes con la versión seleccionada y documentar límites de catálogos de proveedores privados.

## Skills, instrucciones y comandos

Reutilizar writeSkills y copiar recursos completos. Mantener .opencode/skills e IDs por directorio, más AGENTS.md con las reglas de provenance existentes. Registrar estado de migraciones del proveedor v2 sin ejecutar dos veces migraciones sobre una misma carpeta compartida; comprobar estado físico y propiedad.

No reescribir skills por diferencias cosméticas de frontmatter: v2 acepta las existentes. No duplicarlas en .agents ni generar slash commands adicionales. Preservar comandos del usuario; si AHK llega a administrar alguno, usar commands y subagent nativos, manteniendo template/description/agent y model#variant. No trasladar CLAUDE.md automáticamente; documentar AGENTS.md como entrada aplicable.

## Plugin y notificaciones

Crear un adaptador independiente de opencode-v2. V2 usa Plugin.define de @opencode/plugin, id estable y setup(ctx); los hooks se registran con ctx.tool.hook y los eventos se consumen con ctx.event.subscribe. La API de sesión y los payloads deben verificarse contra la versión seleccionada, sin reutilizar ciegamente client.session.get v1.

Instalar preferentemente un paquete local .opencode/plugins/ahk-notifications-v2/index.js con dependencias resolubles según el empaquetado soportado. Confirmar resolución de @opencode/plugin; no asumir que el package global del CLI satisface imports del proyecto. La ruta exacta final puede ajustarse según ese contrato sin cambiar la conducta funcional.

Conservar tracker/ledger común solo cuando sus contratos de entrada se normalicen explícitamente. Adaptar identidad proyecto/sesión/turno, distinguir padre e hijos, eventos de atención y respuestas MCP estructuradas. No deducir cierre de turno solo por idle incidental ni interpretar texto libre como marcador de negocio.

Mantener límites de colas, tiempos, stdin y procesos actuales. Cleanup cancela suscripciones, timers y recursos. Errores de audio o plugin son best-effort y no alteran health, resultados ni exit codes de negocio. Install/uninstall usa hashes/propiedad y backups. No cargar el plugin v1 junto al v2 por cambiar de proveedor: planificar retiro/restauración solo de archivos AHK reconocidos; archivo personalizado conflictivo detiene la operación.

## Migración y recuperación

V1/v2 comparten binario y rutas. No usar .opencode-v2 como si fuera una carpeta nativa reconocida. Una selección de proveedor no instala ni identifica por sí sola el runtime.

Plan v1→v2: inventario → clasificar archivos y campos propios → detectar conflictos → respaldar → preparar configuración y agentes v2 → verificar → aplicar → guardar proveedor → reportar. Archivos canónicos sin personalización pueden transformarse; archivos personalizados se preservan y se reportan como conflicto a resolver, nunca se pisan por coincidir el nombre.

Recuperación: restaurar el respaldo completo de las piezas AHK transformadas y la selección anterior, verificando que no se hayan introducido cambios posteriores. No convertir configuración externa v2 a v1 automáticamente. Reintentos no duplican reglas, servidor, plugin o skills. Reset no elimina raíces enteras compartidas ni archivos ajenos. Migraciones de skills no alteran docs/.

Doctor informa conflictos de versiones, formato efectivo, rutas duplicadas y si el plugin es incompatible. Si puede consultar versión del binario sin instalarlo, reportarla; si no está disponible, separar configuración válida de runtime no comprobado.

## Dependencias, alternativas y riesgos

- No existe evidencia para actualizar SDK MCP 2.3.1 ni cambiar stdio.
- Parser/editor JSONC: evaluar dependencia directa mantenida antes de incorporarla; fijar su versión compatible y justificarla. No confiar en dependencias transitivas para imports.
- Plugin: @opencode/plugin requiere versión compatible con el runtime elegido y una estrategia explícita de resolución/empaquetado. Consultar Context7 e índice de documentación disponible antes de elegir versión.
- Alternativa rechazada: cambiar opencode actual a v2, porque elimina la selección independiente solicitada.
- Alternativa rechazada: emitir solo formato legacy, porque omite integración nativa, advertencias y plugin incompatible.
- Alternativa rechazada: migrar toda configuración de OpenCode, porque excede propiedad de AHK.
- Alternativa diferida: Code Mode para AHK; evaluar después de la integración directa.
- Riesgos: falsa coexistencia v1/v2, pérdida de JSONC, políticas superiores que prevalezcan, shell demasiado permisivo, nombres duplicados de skills/plugins, correlación errónea de turnos, API v2 cambiante y preferencias de modelos no disponibles.

## Fases de implementación

1. Reclamar tarea y comprobar health; explorer mapea alcance actual, consultant revisa riesgos y contratos; handoff a builder.
2. Identidad opencode-v2 y soporte exhaustivo de CLI/MCP, validaciones y materializador.
3. Resolución de configuración, merge JSONC seguro, MCP, compaction, permisos y migración con backups.
4. Agentes nativos, guidance, skills, modelos y persistencia de preferencias.
5. Plugin v2, instalación/retirada y correlación de eventos.
6. Doctor, notices, reset/sync, documentación y pruebas de regresión.
7. Reviewer verifica criterios, health final y evidencias; registrar limitaciones de sesión real. No publicar como parte de esta tarea sin autorización específica.

Cada fase debe preservar trabajo ajeno y cerrar acciones/handoffs canónicos del harness. Un health fallido bloquea implementación ordinaria; usar repair auditado solo si la reparación de ese fallo pertenece al alcance autorizado.

## Matriz de validación y trazabilidad

| Criterios | Evidencia exigida |
|---|---|
| AC-01, AC-11 | Matrices de proveedor, validadores, CLI init/migrate/reset, mantenimiento MCP, doctor/notices y ayuda. |
| AC-02, AC-03, AC-12 | Fixtures JSON/JSONC: nuevo/existente, comentarios, servidor ajeno, AHK personalizado, conflictos legacy/native, ruta múltiple, error de parseo, symlinks, compaction/permisos y package managers. |
| AC-04, AC-05, AC-06 | Parseo del frontmatter completo, modos, permisos y delegación; sesión real verifica restricciones y comandos diagnósticos necesarios. |
| AC-07 | init/models/build --force y preferencias por rol: herencia, variante, preservación, validación inválida, MCP no interactivo y aislamiento respecto de otros proveedores. |
| AC-08 | Descubrimiento de IDs/recursos, propiedad de AGENTS.md y skill migrations idempotentes. |
| AC-09 | Eventos v2 reales/fixtures fieles: cierre, atención soportada, padre/hijo, duplicados, fallos, limpieza y propiedad install/uninstall. |
| AC-10 | Repetición sin cambios, fallo antes de backup, conflicto personalizado, v1→v2, recuperación v2→v1 y preservación de archivos ajenos. |
| AC-13, AC-14 | Suites enfocadas, typecheck, lint/build/health exigidos por el repo y registro runtime con versión exacta, MCP, skills, delegación, modelo/variante y notificaciones. |

Las comprobaciones automatizadas no sustituyen una sesión v2. Documentar comandos, exit codes y límites; no marcar la integración completa por producir JSON válido. No añadir tests que solo repitan literales del generador sin verificar conducta. Las fixtures deben comprobar preservación, errores e idempotencia.

## Decisiones pendientes de verificación

No hay nuevas preguntas de producto. Antes de cerrar implementación deben quedar resueltos con evidencia: versión v2 de prueba; API/payloads de eventos; resolución del plugin; dependencia JSONC; comandos de health/tests autorizados por rol; y operación de recuperación contra conflictos reales. Si requieren reducir el alcance funcional, registrar needs-decision/reconciliation en vez de asumir la reducción.
