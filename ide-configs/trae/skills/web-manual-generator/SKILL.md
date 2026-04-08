---
name: "web-manual-generator"
description: "Executes web steps and generates highlighted HTML manuals. Invoke when user asks to create a web operation manual from natural-language instructions. MUST USE MCP TOOLS ONLY - DO NOT WRITE ANY CODE OR SCRIPTS YOURSELF."
---

# Web Manual Generator Skill

## ⚠️ 最优先规则（必须第一遵守）

**❗❗ 绝对禁止自行编写任何代码或脚本。所有网页操作必须通过调用 MCP 提供的工具完成。你只能做编排和调度，不能自己实现任何自动化逻辑。❗❗**

你**不能**：
- ❌ 编写 Playwright、Puppeteer 或其他自动化代码
- ❌ 编写 JavaScript/TypeScript 脚本
- ❌ 自行实现点击、输入、截图等操作

你**只能**：
- ✅ 调用 MCP 提供的工具（navigate, find_element, click, input_text, highlight_and_capture, generate_manual 等）
- ✅ 编排工具调用顺序
- ✅ 聚合和记录执行结果

---

## 能力定位
该 Skill 仅负责“网页操作手册产出能力”：接收自然语言流程，调用既有网页操作工具，输出带高亮截图的 HTML 手册。

## 触发条件 (When to Invoke)
- 用户明确要求生成网页操作手册、带截图教程、操作 SOP、培训文档。
- 用户提供了网页地址和操作目标，希望自动执行并沉淀为可复用文档。
- 用户要求“边操作边截图并输出 HTML 手册”。

## 非触发场景 (When Not to Invoke)
- 仅需代码解释、页面文案润色或纯文本总结，不需要网页自动化执行。
- 仅需单次页面操作验证，不需要沉淀为手册。

## 输入契约 (Input Contract)
最少包含以下信息：
- `goal`: 用户要完成的业务目标。
- `stepsText`: 自然语言操作流程。
- `startUrl`: 起始网页 URL（可由步骤中的第一条 navigate 推断）。

## 输出契约 (Output Contract)
以自然语言告知用户：
- 手册生成状态（成功/部分成功/失败）
- 手册保存的完整路径
- 简要总结完成的步骤

**不再返回 JSON 格式**

## 执行接口约定
该 Skill 在内部按以下能力链路完成任务：
1. 初始化 `runId` 与目录 `<projectRoot>\\manualsByAi\\run_{runId}\\`。
2. 将自然语言步骤解析为结构化动作。
3. 循环执行：
   - `click` 且可能触发跳转/弹窗/DOM 刷新：`find_element` -> `highlight_and_capture` -> `click` -> （如需）`highlight_and_capture` 回退确认。
   - 其他动作：`find_element` -> `navigate/input_text/click` -> `highlight_and_capture` -> 记录步骤。
4. 调用 `generate_manual` 生成 HTML，且必须传入非空 `steps_json`。
   - 推荐格式：`{ "title": "业务标题", "summary": "手册概述", "modules": [{ "title": "模块名", "description": "模块说明", "steps": [1,2] }], "steps": [...] }`
   - 若用户未明确提供标题，可根据步骤语义自行归纳一个适合手册的标题。
   - `steps[*].desc` 应写成适合文档阅读的说明，而不是只保留极短动作词。
5. 调用 `close_session` 回收浏览器内存。
6. 以自然语言告知用户手册生成完成及手册保存位置。

## 约束规则 (Execution Rules)
- **零代码原则**：禁止自行编写自动化执行代码；所有网页交互必须通过预定义 Skills。
- **高亮截图必选**：禁止普通截图，每个关键步骤都必须调用 `highlight_and_capture`。
- **截图时机规则**：默认“定位元素 -> 执行动作 -> 高亮截图”；但对高风险 `click`（跳转/弹窗/重渲染）优先“定位元素 -> 高亮截图 -> 点击”，并允许点击后截图失败时回退到点击前截图。
- **路径隔离**：HTML 与截图只能写入 `<projectRoot>\\manualsByAi\\run_{runId}\\`，且必须为绝对路径。
- **失败重试**：定位失败和动作失败均自动重试 2 次；定位失败记 `warning` 并继续，动作失败记 `error`，截图失败该步记 `FAIL`。
- **固定回退链路**：元素定位按 `stableSelector -> semantic(text/label/placeholder/role) -> inspectSummary` 顺序回退，禁止随意跳步。
- **结构探测懒加载**：默认不调用 `inspect_summary`，仅在定位失败、候选歧义高、动作后状态不符合预期时触发。
- **Token 节流**：优先 `find_element`；需要探测时使用 `inspect_summary(query, compact=true, max_elements<=20)`，仅在 `has_more=true` 时分页继续。
- **关键词最小化**：优先短关键词（业务词 + 控件词），避免长句直接查询；若关键词过长先裁剪停用词后再调用工具。

## Skills 使用指南 (Skills Usage)
仅调用以下预定义 Skills，不做越权操作：
- `navigate(run_id, url, step?)`：打开指定网页 URL 并记录审计字段。同一逻辑步骤必须复用同一个 `step`。
- `find_element(run_id, target, return_candidates?, max_candidates?, retry_count?)`：传入自然语言或选择器，返回 `element_id`。
- `click(element_id, run_id, text?, step?, retry_count?)`：点击元素并记录状态、错误码、重试次数、耗时、URL 前后值。同一逻辑步骤必须复用同一个 `step`。
- `input_text(element_id, value, run_id, text?, step?, retry_count?)`：输入内容并记录状态、错误码、重试次数、耗时、URL 前后值。同一逻辑步骤必须复用同一个 `step`。
- `highlight_and_capture(element_id, step?, action, text, run_id)`：高亮元素并截图，返回截图绝对路径。
- `generate_manual(run_id, steps_json, clear_after_generate=false)`：生成最终 HTML 操作手册。`steps_json` 必须非空；可传旧版步骤数组，也可传包含 `title/summary/modules/steps` 的对象，禁止传 `[]`。
- `inspect_summary(run_id, max_elements?, offset?, include_hidden?, query?, compact?, max_text_len?)`：返回页面标题、URL、标签统计和分页元素摘要。
- `inspect_detail(run_id, element_ids, compact?)`：按 `element_id` 返回详细元素信息。
- `list_elements(run_id, limit?)`：查看当前 run 最近缓存的 `element_id` 与摘要信息。
- `get_run_context(run_id, limit?)`：读取步骤上下文，供 AI 连续决策。
- `close_session(run_id)`：关闭当前浏览器会话并回收内存。

## 当前 Node 项目对齐信息
- MCP 启动入口：`src/index.ts`，使用 FastMCP `start({ transportType: "stdio" })`。
- 截图与手册目录：固定为 `<projectRoot>\\manualsByAi\\run_{runId}\\`。
- 工具命名使用主工具名：`navigate/find_element/click/input_text/highlight_and_capture/generate_manual/inspect_summary/inspect_detail/list_elements/get_run_context/close_session`。
- `run_id` 已在执行类工具中强制要求传入，元素缓存与步骤记录按 run 维度隔离。
- 运行审计字段包含：`status/errorCode/retryCount/latencyMs/pageUrlBefore/pageUrlAfter`。
- 禁止把 `steps_json` 设为空数组。若缺少 `steps_json` 或执行阶段未统一传递 `step`，`generate_manual` 应视为失败并重新编排，而不是直接输出错误手册。

## 表单校验自愈（Mandatory）

当提交动作的 `click` 返回 `VALIDATION_ERROR` 时，Skill 必须继续执行以下流程。若用户描述不完整，也必须在提交前先执行一次必填项预检。

1. 在提交前（或提交失败后）调用 `inspect_validation(run_id, max_issues?)`。
2. 读取 `missing_fields` 与 `issues`。
3. 逐项补齐缺失字段：
   - 优先使用 `issues[].element_id`；
   - 若没有可用 `element_id`，用字段短关键词调用 `find_element` 再补齐。
4. 若字段值缺失，按字段语义生成默认值补齐，禁止跳过必填项。
5. 每个补齐动作后调用 `highlight_and_capture`。
6. 重试原提交 `click`，最多 2 轮自愈。
7. 若仍失败，保留 `errorCode=VALIDATION_ERROR` 并按 PARTIAL/FAIL 输出。
8. 若 `click` 返回 `SELF_HEAL_LIMIT_REACHED`，必须立即停止自愈循环，不再执行补填、截图、重试提交。

新增工具：
- `inspect_validation(run_id, max_issues?)`
- `inspect_active_layer(run_id, max_layers?, compact?)`
- `inspect_form(run_id, max_fields?, include_optional?, compact?)`

## Form-Aware Orchestration Rules

When the user intent contains `新增 / 创建 / 添加 / 编辑 / 完善表单 / 保存 / 提交 / 确定`, the agent must treat the page as a form task first and must not fill fields blindly in the order of the user's prose.

Required workflow:

1. Detect whether the current page or popup is a form scene.
2. If a dialog / drawer / dropdown / popover may already be open, call `inspect_active_layer(run_id)` first to confirm the current valid foreground scope.
3. Before the first field fill or submit click, call `inspect_form(run_id, ...)` to collect the field plan and `inspect_validation(run_id, max_issues?)` to pre-check required fields.
4. Build a field execution plan: field name, control type, required flag, value source, execution action.
5. If `inspect_validation` returns `issues[].element_id`, or `inspect_form` returns field `element_id`, use those ids first.
6. Only when the field meaning or control type is still unclear, call `inspect_summary(run_id, query="表单 输入框 下拉框 必填 保存", compact=true, max_elements<=20)` and then `inspect_detail` if needed.
7. Execute by control type instead of treating everything as plain text:
   - text / textarea / numeric input: `input_text`
   - select / combobox: `click` to open, then locate and `click` the option
   - checkbox / radio / switch: `click`
   - date / time: prefer direct input; otherwise open the picker and `click` the target value
8. Once a dropdown is opened, the option search scope must be limited to the active dropdown layer returned by `inspect_active_layer`; if the option does not exist there, treat it as “option not found” instead of selecting same-text content behind the overlay.
9. If the user only says “完善表单” or “新增一个商品”, the agent must proactively fill all required fields before submit.
10. Every self-heal or required-field fill action is a key manual step and must be captured with `highlight_and_capture`.
