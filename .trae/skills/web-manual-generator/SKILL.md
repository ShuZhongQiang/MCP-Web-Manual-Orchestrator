---
name: "web-manual-generator"
description: "Executes web steps and generates highlighted HTML manuals. Invoke when user asks to create a web operation manual from natural-language instructions."
---

# Web Manual Generator Skill

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
返回标准 JSON：
- `runId`: `YYYYMMDD_HHMMSSfff`
- `status`: `PASS | PARTIAL | FAIL`
- `manualPath`: 最终 HTML 绝对路径
- `steps`: 每步执行结果数组（动作、说明、截图路径、warning/error）

## 执行接口约定
该 Skill 在内部按以下能力链路完成任务：
1. 初始化 `runId` 与目录 `<projectRoot>\\manualsByAi\\run_{runId}\\`。
2. 将自然语言步骤解析为结构化动作。
3. 循环执行：
   - `click` 且可能触发跳转/弹窗/DOM 刷新：`find_element` -> `highlight_and_capture` -> `click` -> （如需）`highlight_and_capture` 回退确认。
   - 其他动作：`find_element` -> `navigate/input_text/click` -> `highlight_and_capture` -> 记录步骤。
4. 调用 `generate_manual` 生成 HTML。
5. 调用 `close_session` 回收浏览器内存。
6. 汇总并返回标准 JSON 结果。

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
- `navigate(run_id, url)`：打开指定网页 URL 并记录审计字段。
- `find_element(run_id, target, return_candidates?, max_candidates?, retry_count?)`：传入自然语言或选择器，返回 `element_id`。
- `click(element_id, run_id, text?, retry_count?)`：点击元素并记录状态、错误码、重试次数、耗时、URL 前后值。
- `input_text(element_id, value, run_id, text?, retry_count?)`：输入内容并记录状态、错误码、重试次数、耗时、URL 前后值。
- `highlight_and_capture(element_id, step?, action, text, run_id)`：高亮元素并截图，返回截图绝对路径。
- `generate_manual(run_id, steps_json="[]", clear_after_generate=false)`：生成最终 HTML 操作手册。
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
- `steps_json` 可为空数组；为空时优先使用运行期自动记录步骤生成手册。



