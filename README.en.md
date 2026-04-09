# MCP Web Manual Orchestrator

[简体中文](./readme.md) | **English**

An MCP server for AI agents that turns natural-language browser workflows into HTML operation manuals with highlighted screenshots.

Built with FastMCP and Playwright, this project is not just about clicking through pages. It focuses on the practical problems that show up in real delivery environments:

- Keeping the agent on MCP tools instead of falling back to ad hoc scripts
- Isolating each run with `run_id`-scoped state
- Minimizing token cost during element lookup and page inspection
- Producing auditable, deliverable manuals instead of raw execution logs

## Positioning

This is not a thin Playwright wrapper, and it is not an agent that generates execution code.

It is better understood as reusable agent infrastructure:

- The MCP server exposes the standard tool surface
- Agent prompts define orchestration rules and fallback behavior
- IDE skills make those rules usable inside Trae, Cursor, Claude Desktop, and similar environments

If your goal is "let AI operate a web app and also produce a training guide / SOP / delivery artifact", this project is a more complete foundation than a generic Playwright MCP server.

## Core Features

- `run_id`-scoped session isolation
  - Each run gets its own browser context, element cache, step log, and output directory.
- Highlight-first screenshots
  - Critical steps use `highlight_and_capture`, and click flows can fall back to pre-click screenshots when the element disappears after navigation or rerender.
- Low-token page inspection
  - The default path prefers `find_element`; `inspect_summary` and `inspect_detail` are used only when needed.
- Form validation self-healing
  - Required fields can be checked before submit, and submit failures can trigger automatic field completion and retry.
- Form-mode gateway
  - Add/edit/save flows inspect the active layer and form field summary first, then compile a structured pending queue before any field action runs.
- Full audit fields
  - Step records include `status`, `errorCode`, `retryCount`, `latencyMs`, `pageUrlBefore`, and `pageUrlAfter`.
- Direct HTML manual generation
  - The final output is a structured `manual.html` suitable for training, handoff, review, and archiving.

## Use Cases

- Generate operation manuals for admin panels, CRM, ERP, and internal tools
- Turn natural-language business workflows into screenshot-based SOPs
- Combine browser automation and document output in AI IDE workflows
- Produce delivery-ready artifacts for demo and test environments

## Architecture

```text
User Intent
   |
   v
Agent / Skill Orchestration
   |
   v
FastMCP Server
   |
   +-- navigate / find_element / click / input_text
   +-- inspect_summary / inspect_detail / inspect_active_layer / inspect_form / compile_form_plan / inspect_validation
   +-- highlight_and_capture / generate_manual / close_session
   |
   v
Playwright Browser Context
   |
   v
manualsByAi/run_<runId>/
  |- *.png
  |- manual.html
```

## Tooling Surface

The MCP tools currently exported by the codebase are:

| Tool | Description |
| --- | --- |
| `navigate` | Opens a target URL and records audit data for the step |
| `find_element` | Locates elements by semantic cues, text, placeholder, role, or CSS |
| `click` | Performs clicks with retry, navigation detection, and submit-time self-healing |
| `input_text` | Writes input values and records audit fields |
| `highlight_and_capture` | Highlights the target element and captures a screenshot, with pre-click fallback support |
| `inspect_summary` | Returns a lightweight summary of interactive elements on the page |
| `inspect_detail` | Returns detailed snapshots for specific `element_id` values |
| `inspect_active_layer` | Detects the current foreground layer such as a dialog, drawer, dropdown, or popover |
| `inspect_form` | Detects current form fields, control types, required hints, and reusable `element_id` values |
| `compile_form_plan` | Compiles field summaries, validation hints, and user intent into a structured pending queue |
| `inspect_validation` | Detects validation errors and missing required fields |
| `list_elements` | Lists recently cached elements for the current run |
| `get_run_context` | Returns recorded step context for the current run |
| `begin_step` | Allocates and activates a runtime-managed logical `step_id` |
| `generate_manual` | Generates the final HTML manual primarily from execution records, with optional `steps_json` overlays |
| `close_session` | Closes the current run's browser session and clears memory |

## Project Structure

```text
.
|- src/
|  |- core/                # Browser context, element cache, step log, self-heal state
|  |- tools/               # MCP tool definitions
|  |- utils/               # Highlighting, HTML generation, file and validation helpers
|  |- config.ts
|  |- index.ts             # FastMCP server entry
|  `- types.ts
|- prompts/
|  |- system-prompt.md
|  `- default-system-prompt.md
|- ide-configs/
|  |- claude-desktop/
|  |- cursor/
|  `- trae/
|     `- skills/web-manual-generator/SKILL.md
|- manualsByAi/            # Output directory for generated artifacts
|- dist/
|- AGENTS.md
|- package.json
`- readme.md
```

## Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Build the project

```bash
npm run build
```

### 3. Start the MCP server

```bash
node dist/index.js
```

The server runs over `stdio`, which makes it suitable for MCP-compatible clients and AI IDE integrations.

### 4. Local development commands

```bash
npm run dev
npm run typecheck
```

## Output Directory Convention

By default, all run artifacts are written to:

```text
<projectRoot>/manualsByAi/run_<runId>/
```

Typical contents:

```text
run_20260407_153012123/
|- 1_navigate.png
|- 2_click.png
|- 3_input.png
`- manual.html
```

You can override the output root with an environment variable:

```bash
MANUALS_DIR=D:\custom-manuals
```

If you pass a relative path, it is resolved from the project root.

## Default Field Value Policy

Default fallback values for form auto-fill are centralized in [src/utils/defaultFieldPolicy.ts](/d:/AI-agent/Node_Fast_Mcp_Web_Manual_Agent/src/utils/defaultFieldPolicy.ts). This policy is shared by both form planning and runtime self-healing, so there is only one place to maintain field defaults.

An example override file is provided at [examples/default-field-policy.example.json](/d:/AI-agent/Node_Fast_Mcp_Web_Manual_Agent/examples/default-field-policy.example.json).

Load an external policy file:

```bash
FIELD_DEFAULT_VALUE_POLICY_FILE=examples/default-field-policy.example.json
```

Or pass inline JSON:

```bash
FIELD_DEFAULT_VALUE_POLICY_JSON={"rules":[{"id":"brand","pattern":"品牌|brand","value":"示例品牌","priority":120}]}
```

On Windows PowerShell:

```powershell
$env:FIELD_DEFAULT_VALUE_POLICY_FILE="examples/default-field-policy.example.json"
npm run dev
```

Policy shape:

```json
{
  "option_placeholder_patterns": ["^请选择$"],
  "rules": [
    {
      "id": "category_override",
      "pattern": "分类|category|type|kind|group",
      "value": "饮品",
      "priority": 120
    }
  ]
}
```

Rules:

- `option_placeholder_patterns` extends the built-in placeholder filter used when picking a real option from a dropdown.
- `rules` are matched by regex against normalized field names such as label, placeholder, or `name`.
- `value` is a fixed fallback value; `generator` uses a built-in dynamic generator such as `current_date`.
- Higher `priority` wins. If priorities are equal, later-loaded rules win, so env-provided rules can override built-ins cleanly.

## Orchestration Rules

If you integrate this project at the agent or skill layer, these rules matter:

- All browser actions should go through MCP tools. Do not generate extra Playwright or JavaScript scripts.
- For a single logical step, `navigate`, `click`, `input_text`, and `highlight_and_capture` should share the same `step`.
- Start each logical step with `begin_step` so runtime allocates and pins the shared `step_id`.
- `generate_manual` should use execution records as the primary source of truth; `steps_json` may be empty and is treated as optional overlay metadata.
- If `steps_json` omits executed steps, runtime auto-repairs them before rendering; if `steps_json` contains steps without execution records, generation is blocked.
- For clicks that may trigger navigation, dialogs, or DOM refresh, capture before clicking when possible.

These constraints directly determine whether `manual.html` can be generated reliably and aligned with the executed workflow.

## Recommended Integration

The repository already includes sample IDE configurations:

- `ide-configs/trae/`
- `ide-configs/cursor/`
- `ide-configs/claude-desktop/`
- `ide-configs/README.md`

For Trae, the repository also includes a dedicated skill:

- `ide-configs/trae/skills/web-manual-generator/SKILL.md`

The recommended stack is:

- MCP server
- System prompt: `prompts/system-prompt.md`
- Fallback prompt: `prompts/default-system-prompt.md`
- IDE skill: `ide-configs/trae/skills/web-manual-generator/SKILL.md`

This combination makes it much less likely that the model bypasses MCP and writes automation scripts on its own.

## Example Task

Here is a natural-language workflow suitable for an agent:

```text
Generate a product-management operation manual for the coffee admin system:

1. Open http://localhost:5174/login and click "Login"
2. Go to the product management page at http://localhost:5174/products
3. Click "Add Product"
4. Fill the dialog with:
   - Name: Iced Americano
   - Price: 9.9
   - Category: Coffee
   - Stock: 20
5. Click "Confirm" to save
```

Expected result:

- The browser executes the full workflow
- Every critical step has a highlighted screenshot
- The final output includes `manual.html`

## How This Differs from a Generic Playwright MCP Server

| Dimension | Generic Playwright MCP | This Project |
| --- | --- | --- |
| Primary goal | Expose browser control APIs | Execution plus document delivery |
| Token strategy | Often pulls large page structures | Minimal inspection first, expand only when needed |
| Session isolation | Usually managed by the caller | Built-in `run_id` isolation |
| Screenshot strategy | Usually plain screenshots | Highlighted screenshots with click fallback |
| Form handling | Fail fast on submit errors | Pre-submit checks plus validation self-healing |
| Output | Execution result only | Deliverable HTML manual |

## Development Notes

Tech stack:

- TypeScript
- FastMCP
- Playwright
- Zod

Main scripts:

```json
{
  "dev": "tsx src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "typecheck": "tsc --noEmit -p tsconfig.json"
}
```

## Form-Mode Orchestration

If you use this project as the browser-automation foundation for an agent, keep the form gateway explicit:

1. Parse the user request into structured steps first.
2. When the task contains add/create/edit/fill/save/submit/confirm intent, detect form mode before executing any field.
3. Call `inspect_active_layer(run_id)` first, then `inspect_form(run_id, ...)`.
4. Immediately call `compile_form_plan(run_id, user_intent, ...)` so execution is driven from `pending_queue`, not from the raw user prose.
5. Reuse `inspect_validation(run_id, max_issues?)` as the required-field precheck and merge its result into the compiled plan.
6. Prefer `issues[].element_id` from validation or field `element_id` values from `inspect_form` / `compile_form_plan`.
7. Keep all required fields in the pending queue even when the user's request is vague.

If you extend the toolset, keep these design principles intact:

- Preserve `run_id`-scoped state isolation
- Keep audit fields complete
- Consider screenshot fallback for high-risk clicks
- Avoid returning large page structures unless necessary
- Keep manual generation anchored to runtime execution records, using `steps_json` only as optional overlay metadata

## License

MIT
