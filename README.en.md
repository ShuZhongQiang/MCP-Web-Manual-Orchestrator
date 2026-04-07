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
   +-- inspect_summary / inspect_detail / inspect_validation
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
| `inspect_validation` | Detects validation errors and missing required fields |
| `list_elements` | Lists recently cached elements for the current run |
| `get_run_context` | Returns recorded step context for the current run |
| `generate_manual` | Generates the final HTML manual from `steps_json` |
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

## Orchestration Rules

If you integrate this project at the agent or skill layer, these rules matter:

- All browser actions should go through MCP tools. Do not generate extra Playwright or JavaScript scripts.
- For a single logical step, `navigate`, `click`, `input_text`, and `highlight_and_capture` should share the same `step`.
- `generate_manual` must receive a non-empty `steps_json`; do not rely on raw execution logs to assemble the final manual.
- `steps_json[*].step` must exactly match the `step` values used during execution.
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

If you extend the toolset, keep these design principles intact:

- Preserve `run_id`-scoped state isolation
- Keep audit fields complete
- Consider screenshot fallback for high-risk clicks
- Avoid returning large page structures unless necessary
- Keep manual generation tied to explicit `steps_json`, not implicit log assembly

## License

MIT
