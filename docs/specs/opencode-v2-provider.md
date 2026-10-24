---
slug: "opencode-v2-provider"
title: "OpenCode V2 como proveedor independiente de AHK"
description: "Opción independiente de OpenCode V2 con MCP, agentes, skills, modelos, permisos, notificaciones y migración preservando personalizaciones."
spec_kind: spec
status: approved
created_at: "2026-10-24T09:05:34.420Z"
last_updated: "2026-10-24T09:05:37.211Z"
---
# OpenCode V2 como proveedor independiente de AHK

## Origen, aprobación y documentos relacionados

El mantenedor solicitó revisar https://opencode.ai/v2/docs para incorporar una opción nueva «OpenCode V2» en AHK, incluyendo MCP, skills, agentes y los componentes relacionados. El 2026-10-24 aprobó el plan presentado en la conversación y pidió persistir la especificación funcional y técnica. Esta aprobación autoriza documentar el alcance acordado; esta entrega no implementa ni publica el proveedor.

- Fuente: petición directa del mantenedor; no existen casos de uso upstream registrados para esta petición.
- Diseño derivado: [opencode-v2-provider-tech.md](opencode-v2-provider-tech.md).
- Relación de compatibilidad: [sonidos-ahk-hooks-providers.md](sonidos-ahk-hooks-providers.md), [mcp-cli-parity-autonomous-maintenance.md](mcp-cli-parity-autonomous-maintenance.md) y [operational-notices.md](operational-notices.md). Estos documentos son contexto, no fuentes que sustituyan la aprobación de este alcance.

## Problema y resultado esperado

AHK solo ofrece OpenCode como un proveedor y genera formatos v1. Un usuario que elija OpenCode V2 debe recibir una configuración nativa coherente, agentes utilizables como roles del harness, skills descubribles, preferencias de modelo y notificaciones compatibles. La opción actual debe conservar su identidad y comportamiento.

El resultado es una sexta opción de proveedor, «OpenCode V2», disponible en las superficies públicas de AHK que administran proveedores. Elegirla configura el proyecto para v2; no instala OpenCode ni convierte automáticamente la configuración personal o las integraciones ajenas al harness.

## Usuarios y recorridos

1. Proyecto nuevo: el usuario elige OpenCode V2, define sus preferencias y obtiene un proyecto con lead, explorer, consultant, builder, reviewer, skills y conexión MCP.
2. Proyecto existente: el usuario cambia explícitamente a OpenCode V2. AHK muestra los archivos afectados, conserva las personalizaciones y respalda cualquier contenido administrado que necesite transformar.
3. Mantenimiento: build, sync, doctor y las operaciones equivalentes por MCP reconocen el proveedor y diagnostican la configuración real.
4. Preferencias: el usuario puede elegir o heredar modelo y variante por rol; puede revisarlos posteriormente sin perder preferencias de otros proveedores.
5. Notificaciones: el usuario puede instalar, comprobar y retirar el adaptador v2 con las mismas garantías de propiedad y entrega del sistema existente.

## Alcance funcional

### F-01. Identidad y selección

Añadir «OpenCode V2» como opción independiente. OpenCode existente continúa disponible. Los selectores, validaciones, ayuda y resultados de CLI y mantenimiento MCP deben usar la identidad correcta. Un valor desconocido produce un diagnóstico claro, nunca una selección implícita de otro proveedor.

### F-02. MCP y configuración

Generar configuración nativa v2 y conservar el transporte stdio y la detección del gestor de paquetes que ya utiliza AHK. Preservar los servidores, credenciales referenciadas y ajustes del usuario. La conexión del harness debe ser visible para el modelo y compatible con las reglas de permisos del proveedor.

Admitir las ubicaciones JSON/JSONC que AHK declare soportadas para OpenCode V2. Una lectura inválida debe detener la operación con un diagnóstico sin reemplazar el archivo. La especificación técnica define cómo evitar conflictos entre ubicaciones y versiones.

### F-03. Agentes y delegación

Mantener los cinco roles canónicos. Lead es el agente principal; explorer, consultant, builder y reviewer son subagentes. Los agentes deben tener metadatos nativos v2, descripciones descubribles y pautas de transferencia de contexto y espera de resultados.

Preservar la separación de responsabilidades de AHK. Las restricciones de un rol deben contemplar tanto herramientas de edición como ejecución de comandos; no presentar un simple bloqueo de edición como aislamiento del filesystem.

### F-04. Modelos y variantes

Permitir elegir modelo y variante por rol o heredar el comportamiento nativo. Integrar la elección en init, ahk models, regeneración explícita y operaciones de mantenimiento equivalentes. No inventar un catálogo fijo de modelos disponibles ni imponer un esfuerzo que el proveedor o modelo no soporte. No modificar credenciales globales para resolver una elección.

### F-05. Skills, comandos e instrucciones

Mantener las skills canónicas, sus recursos y los identificadores existentes. Actualizar únicamente las instrucciones específicas de delegación y uso de herramientas cuando v2 lo requiera. Conservar AGENTS.md y respetar su propiedad.

Las skills y los slash commands son capacidades distintas. Esta entrega no añade una segunda copia de todas las skills como comandos. Si existen comandos del usuario, conservarlos; documentar el formato nativo v2 cuando corresponda.

### F-06. Permisos y valores por defecto

Emitir reglas v2 coherentes y ordenadas. Conservar decisiones explícitas del usuario y evitar ampliar permisos de manera silenciosa al cambiar de versión. Documentar la diferencia de acceso a directorios externos. Mantener las capacidades de diagnóstico requeridas por los roles sin permitir escritura indiscriminada mediante shell.

Los valores generados de compaction deben representar el formato v2, sin campos heredados ignorados. Los permisos son controles de herramientas; no equivalen a un sandbox del sistema operativo.

### F-07. Notificaciones

Ofrecer un adaptador de notificaciones v2 con eventos y API compatibles. Mantener entrega best-effort, deduplicación, correlación por proyecto/sesión/turno, tratamiento de sesiones hijas, instalación reversible y limpieza de recursos. Un error de notificación no puede cambiar el resultado de una operación del harness ni bloquear OpenCode.

### F-08. Migración, mantenimiento y preservación

V1 y v2 comparten el ejecutable y rutas de OpenCode. La opción nueva no promete coexistencia aislada ni dos instalaciones simultáneas. AHK debe detectar el conflicto al cambiar entre formatos y no sobrescribir agentes personalizados, plugins ajenos o ajustes no administrados.

La migración debe tener respaldo verificable y recuperación documentada. Debe poder repetirse sin duplicar entradas, reglas, plugins o skills. Reset y uninstall solo retiran contenido cuya propiedad corresponde a AHK. Las migraciones de skills quedan limitadas a sus rutas administradas y no limpian documentación del usuario.

### F-09. Diagnóstico y documentación

Doctor debe reconocer las rutas efectivas, roles, skills, modelos y estado de integración v2 que sea posible comprobar sin iniciar trabajo del agente. Distinguir configuración válida, herramienta instalada y funcionamiento comprobado en runtime.

Actualizar ayuda, README y recursos ahk-docs. Explicar la diferencia OpenCode/OpenCode V2, migración, respaldo, recuperación, configuración de modelos, notificaciones y límites de prueba.

## Exclusiones

- Instalar o actualizar OpenCode, cambiar el PATH o modificar la configuración global del usuario.
- Convertir automáticamente todos los providers LLM, plugins, comandos o ajustes externos de OpenCode.
- Cambiar el protocolo o los contratos públicos del servidor MCP de AHK sin una necesidad demostrada.
- Añadir endpoints, rediseñar la API de tareas o alterar health gates y persistencia de negocio.
- Migrar otros proveedores de AHK, actualizar sus modelos o cambiar sus archivos.
- Adoptar la API cliente v2 como requisito para operaciones que ya funcionan mediante MCP stdio.
- Prometer aislamiento entre v1/v2, protección absoluta frente a shell o compatibilidad validada sin sesión real.
- Hacer commit, publicar paquete o release como parte de la redacción de estas especificaciones.

## Criterios de aceptación

| ID | Resultado verificable |
|---|---|
| AC-01 | OpenCode V2 aparece y se acepta como proveedor en CLI y mantenimiento MCP; OpenCode v1 y los otros proveedores conservan sus rutas existentes. |
| AC-02 | Un proyecto nuevo genera MCP nativo v2 y se conecta al servidor AHK mediante stdio con el gestor de paquetes detectado. |
| AC-03 | Se preservan ajustes y servidores del usuario en JSON/JSONC; un archivo inválido no se sobrescribe. |
| AC-04 | Lead inicia como principal y puede delegar a los cuatro subagentes, que reciben una tarea autocontenida y devuelven resultados antes de los pasos dependientes. |
| AC-05 | Los cinco agentes usan un único formato v2 por definición; no dependen de campos heredados ignorados. |
| AC-06 | Los roles no implementadores tienen restricciones comprobadas de edición y shell, conservando sus diagnósticos necesarios. |
| AC-07 | Las elecciones o herencia de modelo/variante por rol se guardan, se regeneran y se pueden cambiar con ahk models sin alterar preferencias ajenas. |
| AC-08 | Las skills y recursos se descubren con sus IDs existentes, sin duplicación; AGENTS.md personalizado se conserva. |
| AC-09 | Las notificaciones v2 funcionan para finalización y atención soportada, sin duplicados de sesiones hijas ni interferencia con negocio; install/uninstall preservan archivos ajenos. |
| AC-10 | Build y migraciones repetidos son idempotentes; los cambios v1→v2 y el retorno mediante recuperación documentada protegen archivos y respaldos. |
| AC-11 | Doctor, reset, sync, migraciones de skills y operational notices reconocen el proveedor y no actúan sobre rutas equivocadas. |
| AC-12 | La configuración generada de compaction y permisos no produce advertencias por campos legacy de AHK ignorados. |
| AC-13 | Las pruebas automatizadas y health requerido pasan; se registra además una sesión real v2 con MCP, skills, delegación, modelos y notificaciones. |
| AC-14 | La documentación distingue evidencia estática, pruebas del generador y verificación real, e identifica la versión v2 probada. |

## Decisiones y asuntos pendientes

Decisiones aprobadas: proveedor independiente; conservar OpenCode actual; configuración nativa v2; reutilizar contenidos y skills comunes; cubrir modelos, permisos, notificaciones, migración y pruebas. Para la integración inicial de AHK se adopta exposición directa de herramientas MCP, sin Code Mode; su eventual activación es trabajo posterior.

No quedan preguntas de producto que impidan redactar el diseño. La versión exacta de OpenCode v2 usada como referencia de pruebas y los detalles de adaptación de eventos se fijarán y comprobarán durante implementación. Si esa comprobación revela una capacidad ausente o una pérdida de comportamiento, se debe registrar la diferencia y reconciliar las especificaciones antes de reducir el alcance.

## Fuentes oficiales revisadas el 2026-10-24

- [Migración v1 a v2](https://opencode.ai/v2/docs/migrate-v1/): compatibilidad, rutas compartidas, compaction y formatos heredados.
- [Configuración](https://opencode.ai/v2/docs/config/) y [MCP](https://opencode.ai/v2/docs/mcp-servers/).
- [Agentes](https://opencode.ai/v2/docs/agents/), [permisos](https://opencode.ai/v2/docs/permissions/) y [modelos](https://opencode.ai/v2/docs/models/).
- [Skills](https://opencode.ai/v2/docs/skills/), [comandos](https://opencode.ai/v2/docs/commands/) e [instrucciones](https://opencode.ai/v2/docs/instructions/).
- [Migración de plugins](https://opencode.ai/v2/docs/build/plugins/migrate-v1/).

La revisión documental se realizó mediante Context7 y páginas oficiales. El índice Mintlify no estaba disponible entre los conectores de la sesión. No se verificó todavía una instalación ni una sesión real de OpenCode v2.
