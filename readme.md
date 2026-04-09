# MCP Web Manual Orchestrator

**简体中文** | [English](./README.en.md)

面向 AI Agent 的浏览器自动化 MCP Server，用于把自然语言网页流程转换成带高亮截图的 HTML 操作手册。

项目基于 FastMCP + Playwright解决以下问题：

- 如何让 Agent 始终通过 MCP 工具执行，而不是临时写脚本
- 如何在多轮操作中保持 `run_id` 级隔离，避免上下文串扰
- 如何在低 Token 成本下完成元素定位和页面探测
- 如何把执行过程沉淀成可审计、可交付的操作手册

## 项目定位

这不是一个单纯的 Playwright 封装，也不是一个生成执行代码的 Agent。

它更适合作为一层可复用的 Agent Infra：

- MCP Server 负责暴露标准工具能力
- Agent Prompt 负责约束编排流程和失败策略
- IDE Skill 负责在 Trae、Cursor、Claude Desktop 等环境中稳定触发这些能力

如果你的目标是“让 AI 自动操作网页并顺手生成培训手册 / SOP / 交付文档”，这个项目比只提供点击与输入接口的 MCP Server 更完整。

## 核心特性

- `run_id` 级会话隔离
  - 每次运行都有独立浏览器上下文、元素缓存、步骤记录和截图目录。
- 高亮截图优先
  - 关键步骤通过 `highlight_and_capture` 生成高亮截图，点击类操作支持点击前预截图回退。
- 低 Token 页面探测
  - 默认优先使用 `find_element`，仅在必要时才回退到 `inspect_summary` / `inspect_detail`。
- 表单校验自愈
  - 提交前预检必填项，提交后若出现校验错误，会尝试自动补齐并重试。
- 表单感知编排
  - Agent 在新增/编辑/提交类任务中需要先识别当前前景层和表单字段摘要，再通过 `compile_form_plan` 编译成待执行队列，最后才允许驱动填写或提交。
- 审计字段完整
  - 步骤记录包含 `status`、`errorCode`、`retryCount`、`latencyMs`、`pageUrlBefore`、`pageUrlAfter`。
- HTML 手册直接产出
  - 运行结束后可输出结构化 `manual.html`，适合培训、交付、复盘和归档。

## 适用场景

- 为后台系统、运营平台、CRM、ERP 生成操作手册
- 将自然语言业务流程沉淀为带截图的 SOP
- 在 AI IDE 中把浏览器自动化和文档产出串成一次执行
- 为演示环境、测试环境快速生成“可交付结果”

## 架构概览

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

## 工具列表

当前代码实际导出的 MCP 工具如下：

| Tool | 说明 |
| --- | --- |
| `navigate` | 打开目标 URL，并记录步骤审计信息 |
| `find_element` | 根据语义、文本、placeholder、role 或 CSS 定位元素 |
| `click` | 执行点击，支持重试、跳转检测、提交类校验自愈 |
| `input_text` | 向输入控件写入内容并记录审计字段 |
| `highlight_and_capture` | 对目标元素高亮后截图，点击类步骤支持预截图回退 |
| `inspect_summary` | 返回当前页面的轻量交互元素摘要 |
| `inspect_detail` | 查看指定 `element_id` 的详细快照 |
| `inspect_active_layer` | 识别当前前景层，判断是否存在弹窗、抽屉、下拉或 popover，并给出当前有效作用域 |
| `inspect_form` | 识别当前表单字段、控件类型、是否必填、当前值摘要与可复用 `element_id` |
| `compile_form_plan` | 把表单字段摘要、校验线索和用户意图编译成结构化待执行队列 |
| `inspect_validation` | 识别页面校验错误和缺失必填项 |
| `list_elements` | 查看当前 run 最近缓存的元素摘要 |
| `get_run_context` | 查看当前 run 的步骤上下文 |
| `begin_step` | 由 runtime 分配并激活当前逻辑步骤 step_id |
| `generate_manual` | 以 execution records 为主生成最终 HTML 手册，`steps_json` 仅作补充信息 |
| `close_session` | 关闭当前 run 的浏览器会话并清理内存 |

## 目录结构

```text
.
|- src/
|  |- core/                # 浏览器上下文、元素缓存、步骤记录、自愈状态
|  |- tools/               # MCP 工具定义
|  |- utils/               # 高亮、HTML 生成、文件与校验辅助
|  |- config.ts
|  |- index.ts             # FastMCP server 入口
|  `- types.ts
|- prompts/
|  |- system-prompt.md
|  `- default-system-prompt.md
|- ide-configs/
|  |- claude-desktop/
|  |- cursor/
|  `- trae/
|     `- skills/web-manual-generator/SKILL.md
|- manualsByAi/            # 运行产物输出目录
|- dist/
|- AGENTS.md
|- package.json
`- readme.md
```

## 快速开始

### 1. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 2. 构建项目

```bash
npm run build
```

### 3. 启动 MCP Server

```bash
node dist/index.js
```

服务通过 `stdio` 方式启动，适合直接接入支持 MCP 的客户端或 AI IDE。

### 4. 本地开发命令

```bash
npm run dev
npm run typecheck
```

## 输出目录约定

默认情况下，所有运行产物都会写入：

```text
<projectRoot>/manualsByAi/run_<runId>/
```

其中通常包含：

```text
run_20260407_153012123/
|- 1_navigate.png
|- 2_click.png
|- 3_input.png
`- manual.html
```

你也可以通过环境变量覆盖输出根目录：

```bash
MANUALS_DIR=D:\custom-manuals
```

如果传入相对路径，会基于项目根目录解析。

## 默认字段值策略配置

表单自动补值的默认策略已经统一收口到 [src/utils/defaultFieldPolicy.ts](/d:/AI-agent/Node_Fast_Mcp_Web_Manual_Agent/src/utils/defaultFieldPolicy.ts)。这套策略会同时被表单规划阶段和运行时自愈补填复用，后续维护默认值时不需要再分别修改多个工具文件。

仓库内提供了一个可直接参考的示例文件：[examples/default-field-policy.example.json](/d:/AI-agent/Node_Fast_Mcp_Web_Manual_Agent/examples/default-field-policy.example.json)。

通过外部 JSON 文件加载策略：

```bash
FIELD_DEFAULT_VALUE_POLICY_FILE=examples/default-field-policy.example.json
```

也可以直接通过环境变量传入 JSON：

```bash
FIELD_DEFAULT_VALUE_POLICY_JSON={"rules":[{"id":"brand","pattern":"品牌|brand","value":"示例品牌","priority":120}]}
```

Windows PowerShell 示例：

```powershell
$env:FIELD_DEFAULT_VALUE_POLICY_FILE="examples/default-field-policy.example.json"
npm run dev
```

策略 JSON 结构如下：

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

字段说明：

- `option_placeholder_patterns`：扩展下拉框占位项识别规则，帮助系统跳过“请选择”这类无效选项。
- `rules`：按正则匹配字段名、标签、placeholder 或 `name` 等信息。
- `value`：固定默认值；`generator`：调用内置动态生成器，目前内置 `current_date`。
- `priority`：优先级越高越先命中；若优先级相同，后加载的规则优先生效，因此外部配置可以覆盖内置规则。

## 编排约束

如果你要在 Agent 或 Skill 层接入本项目，以下约束很重要：

- 所有网页操作都应通过 MCP 工具完成，不要额外生成 Playwright / JS 脚本。
- 对同一个逻辑步骤，`navigate` / `click` / `input_text` / `highlight_and_capture` 应传入相同的 `step`。
- 每个逻辑步骤开始前优先调用 `begin_step`，由 runtime 分配并锁定当前逻辑 `step_id`。
- `generate_manual` 优先使用 execution records；`steps_json` 可以为空，若传入则只作为标题/摘要/模块/步骤补充信息。
- 若 `steps_json` 缺少已执行步骤，系统会在生成前自动补齐；若 `steps_json` 多出没有 execution records 的步骤，系统会阻断生成。
- 对可能触发跳转、弹窗、DOM 刷新的点击，优先先截图再点击。

这几条直接决定最后 `manual.html` 是否能稳定生成、是否能与执行步骤正确对齐。

## 推荐接入方式

仓库已提供多种 IDE 的示例配置：

- `ide-configs/trae/`
- `ide-configs/cursor/`
- `ide-configs/claude-desktop/`
- `ide-configs/README.md`

对于 Trae，额外提供了 Skill 约束文件：

- `ide-configs/trae/skills/web-manual-generator/SKILL.md`

推荐同时使用：

- MCP Server
- 系统 Prompt：`prompts/system-prompt.md`
- 默认兜底 Prompt：`prompts/default-system-prompt.md`
- IDE Skill：`ide-configs/trae/skills/web-manual-generator/SKILL.md`

这样可以最大限度避免模型绕开工具、直接写自动化脚本。

## 示例任务

下面是一个适合直接交给 Agent 的自然语言流程：

```text
请生成“咖啡后台管理系统”的商品管理操作手册：

1. 访问 http://localhost:5174/login 并点击登录
2. 进入商品管理页面 http://localhost:5174/products
3. 点击“添加商品”
4. 在弹窗中填写：
   - 名称：冰美式
   - 价格：9.9
   - 分类：咖啡
   - 库存：20
5. 点击“确定”保存
```

预期结果：

- 浏览器执行完整流程
- 每个关键步骤有高亮截图
- 最终输出 `manual.html`

## 这个项目和普通 Playwright MCP 的差异

| 维度 | 普通 Playwright MCP | 本项目 |
| --- | --- | --- |
| 定位目标 | 暴露浏览器控制接口 | 面向“执行 + 文档交付” |
| Token 策略 | 常见为整页结构拉取 | 默认最小探测，按需展开 |
| 会话隔离 | 依赖调用方自行管理 | 内建 `run_id` 隔离 |
| 截图策略 | 通常只做普通截图 | 强调高亮截图和点击回退 |
| 表单处理 | 常规失败即报错 | 支持提交前预检和校验自愈 |
| 产出物 | 执行结果为主 | 可直接交付的 HTML 手册 |

## 开发说明

技术栈：

- TypeScript
- FastMCP
- Playwright
- Zod

主要脚本：

```json
{
  "dev": "tsx src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "typecheck": "tsc --noEmit -p tsconfig.json"
}
```

如果你要扩展工具，建议优先遵守现有设计原则：

- 保持 `run_id` 级状态隔离
- 审计字段要完整
- 高风险点击优先考虑截图回退
- 尽量避免大体量页面结构返回
- 手册生成以 execution records 为主，`steps_json` 只作为可选补充，不再把模型临时拼装结果当作唯一事实来源

## 许可证

MIT
## 表单感知编排建议

如果你在 Trae / Cursor / Claude Desktop 中把这个项目当作“浏览器自动化 + 手册生成”的基础设施使用，建议把下面这套流程写进 Agent 提示词：

1. 先把用户自然语言解析成结构化步骤，不要直接执行原始长句。
2. 当任务包含“新增 / 创建 / 添加 / 编辑 / 完善表单 / 保存 / 提交 / 确定”等语义时，先判断当前页面是否进入表单场景。
3. 若当前可能已经打开弹窗、下拉、抽屉或 popover，先调用 `inspect_active_layer(run_id)` 确认当前前景层与有效作用域。
4. 一旦进入表单场景，固定先调用 `inspect_active_layer(run_id)`，再调用 `inspect_form(run_id, ...)`。
5. 拿到 `inspect_form` 结果后，必须调用 `compile_form_plan(run_id, user_intent, ...)`，把字段摘要编译成结构化执行计划；后续执行只能从 `pending_queue` 驱动。
6. 在首次填写字段或首次提交前，再调用 `inspect_validation(run_id, max_issues?)` 获取必填项；若 `compile_form_plan` 已汇总缺失字段，优先复用该队列。
7. 若 `inspect_validation` 已返回 `issues[].element_id`，或 `compile_form_plan` / `inspect_form` 已返回字段 `element_id`，优先直接据此操作；仅在字段语义或控件类型仍不清晰时，再调用 `inspect_summary` / `inspect_detail`。
8. Agent 必须根据控件类型决定动作：
   - 输入框 / 文本域 / 数字框：`input_text`
   - 下拉框 / 组合框：先 `click` 打开，再定位选项并 `click`
   - 单选 / 复选 / 开关：`click`
   - 日期时间控件：优先直接输入；不能输入时再打开控件选择
9. 下拉框打开后，目标选项的搜索作用域必须限定在 `inspect_active_layer` 返回的当前下拉层；找不到就应判定“选项不存在”，不能回退点击页面其他同名文本。
10. 当用户只模糊描述“完善表单”“新增一个商品”时，必须主动补齐全部必填项；至少所有必填项都要进入 `pending_queue`，而不是只填写用户提到的少数字段。
11. 所有补齐动作都属于关键步骤，必须截图，并在最终手册中保留说明或审计字段。
