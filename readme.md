# 🌐 MCP Web Manual Orchestrator

**MCP 网页操作手册编排引擎** (MCP Web Manual Orchestrator) 是一个专为大语言模型（LLM）设计的生产级 Web 自动化与操作手册生成系统。基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 标准，结合 Playwright 的浏览器控制能力，实现了高成功率、低 Token 消耗的网页交互与自动文档生成。

## 🎯 项目定位 (Positioning)

本项目采用“三层协同”架构，定位不是单一 Agent 或单一 Skill，而是以 MCP 为底座的可产品化 Agent Infra：

- **MCP（核心底座）**
  - 以 FastMCP Server 形式对外提供标准工具能力（导航、查找、点击、输入、洞察、手册生成）。
  - 负责能力暴露、会话隔离、审计数据输出与稳定执行。
- **Agent（决策编排层）**
  - 通过系统级 Prompt 约束执行边界与 SOP，负责“任务拆解 -> 调度工具 -> 状态判定 -> 结果汇总”。
  - 强调低 Token 决策与失败回退，不直接承载底层自动化实现。
- **Skill（IDE 适配层）**
  - 面向 Trae/Cursor 等使用场景提供触发条件、调用约束与策略模板。
  - 用于让上层模型更稳定地消费 MCP 能力，而非替代 MCP 服务本身。

一句话描述：**这是一个 MCP Server 主导、Agent 负责编排、Skill 负责调用约束的复合型工程。**

## ✨ 核心特性 (Core Features)

该项目经过真实的工程化重构，直击 AI Web Automation 领域的痛点，具备高度的稳定性和极高的可观测性：

- **🛡️ 强隔离沙箱 (Run Session Isolation)**
  - 基于 `run_id` 的状态与内存完全隔离。
  - 支持多个并发的 Agent 任务，彻底解决“状态污染”、“ID 碰撞”与历史交互残留。
- **📉 渐进式页面洞察 (Summary/Detail Layering)**
  - 创新的 `inspect_summary` 与 `inspect_detail` 分层架构，极大降低 Token 消耗。
  - 剔除冗余 DOM 信息，仅返回轻量级概览树，帮助 LLM 快速建立页面空间认知，并支持按需查询深层属性。
- **🪂 降级与容错链路 (Resilient Fallback)**
  - 面对现代前端框架的动态渲染，提供“Playwright 强语义匹配 -> 底层 DOM 属性遍历 -> 动态轮询等待”的多重保险策略。
  - 大幅提升点击与查找的成功率，避免偶发性交互失败。
- **📊 深度可观测性 (Deep Observability)**
  - 完备的审计字段（如 `status`, `errorCode`, `retryCount`, `latencyMs`, `pageUrlBefore/After`）。
  - 赋予大模型精准的\*\*自我纠错（Self-Correction）\*\*能力，Agent 可以明确知道上一步点击是否成功、是否引起了预期内的页面跳转。
- **📸 自动化手册生成**
  - 在后台零干预记录每一步交互（含截图与高亮），任务完成后一键生成精美、结构化的 HTML Web 操作手册。

## 🏆 独特优势与对比 (Differentiators)

### 1) Token 经济学优化（核心亮点）

- 典型方案常直接返回大体量 DOM，容易造成 Token 激增。
- 本项目默认优先盲狙 `find_element`，仅在失败、歧义高或状态异常时才触发 `inspect_summary`，再按需 `inspect_detail`。
- 这种 `inspect_summary / inspect_detail` 分层设计能显著降低上下文开销，在常见流程中可实现大幅 Token 节省。

### 2) 生产级状态隔离

- 典型方案使用全局单例上下文，多个任务并发时容易互相污染。
- 本项目基于 `run_id` 进行会话级隔离，元素缓存由 `elementStore.ts` 按 run 管理。
- 结果是并发场景下更稳定，降低元素 ID 冲突和历史状态串扰风险。

### 3) 智能容错链路

- 不是“失败即报错”的单层点击封装，而是多级回退策略：
- Playwright 语义匹配 → DOM 属性遍历 → 动态轮询等待。
- 同时记录 `retryCount`、`errorCode` 等审计字段，便于后续诊断与策略调整。

### 4) 可驱动自我纠错的审计输出

- 不是仅返回 `success: true/false`，而是返回结构化执行证据，例如：

```json
{
  "status": "success",
  "pageUrlBefore": "https://example.com/login",
  "pageUrlAfter": "https://example.com/dashboard",
  "latencyMs": 1234,
  "retryCount": 2,
  "errorCode": null
}
```

- LLM 可据此判断点击是否生效、页面是否按预期跳转、是否需要重试或切换策略。

### 5) 从工具到解决方案：自动手册生成

- 市面上典型的 Playwright MCP 方案只提供浏览器控制接口，不沉淀可交付结果。
- 本项目通过 `stepRecorder.ts` 持续记录步骤，结合高亮截图，最终一键生成结构化 HTML 操作手册。
- 这使系统从“执行工具”升级为“可交付解决方案”。

## 📊 对比总结 (Quick Comparison)

| 维度       | 典型 Playwright MCP | 本项目         |
| -------- | ----------------- | ----------- |
| 定位       | 工具封装              | 生产级解决方案     |
| Token 消耗 | 高（常见全量结构返回）       | 低（按需分层加载）   |
| 并发支持     | 易状态冲突             | `run_id` 隔离 |
| 容错能力     | 基础重试              | 多级降级链路      |
| 可观测性     | 成功/失败为主           | 完整审计字段      |
| 附加价值     | 无                 | 自动生成操作手册    |

## 🎓 核心竞争力 (Value Proposition)

本项目不是“Playwright 的 MCP 版本”，而是**为 LLM 深度优化的 Web 自动化编排引擎**，重点解决真实落地痛点：

- Token 成本失控
- 动态页面导致交互成功率波动
- 缺乏审计信息导致模型难以自我纠错
- 缺少可交付、可复用的操作文档

## 📂 目录结构 (Architecture)

```text
MCP_Web_Manual_Orchestrator/
├── docs/
│   └── prompts/
│       └── system-prompt.md    # 系统级 Agent Prompt（原 web_manual_agent.md）
├── ide-configs/
│   ├── README.md               # 多 IDE 配置索引
│   ├── trae/
│   │   ├── README.md
│   │   ├── mcp.config.example.json
│   │   └── skills/
│   │       └── web-manual-generator/
│   │           └── SKILL.md    # Trae Skill 约束定义
│   └── cursor/
│       ├── README.md
│       └── mcp.config.example.json
├── src/
│   ├── core/
│   │   ├── browser.ts          # BrowserManager: 封装 Playwright 实例
│   │   ├── elementStore.ts     # 元素缓存池: 按 run_id 隔离存储定位器与快照
│   │   ├── stepRecorder.ts     # 步骤记录器: 记录带审计信息的执行日志
│   │
│   ├── tools/
│   │   ├── navigate.ts         # 导航与 URL 工具
│   │   ├── find.ts             # 智能查找元素工具 (带重试与降级)
│   │   ├── click.ts            # 点击工具 (捕获跳转状态)
│   │   ├── input.ts            # 表单输入工具
│   │   ├── screenshot.ts       # 截图工具
│   │   ├── insight.ts          # 页面结构分析工具 (inspect_summary/detail)
│   │   ├── generateManual.ts   # 操作手册生成工具
│   │
│   ├── utils/
│   │   ├── highlight.ts        # 图像/DOM 元素高亮逻辑（内部用）
│   │   ├── file.ts             # 路径与资源管理
│   │   ├── html.ts             # 生成最终的 HTML 手册内容
│   ├── index.ts                # MCP Server 主入口
│   ├── config.ts               # 全局配置 (Browser / 超时时间等)
│   ├── types.ts                # 核心类型定义 (Snapshot, StepRecord 等)
│
├── package.json
├── tsconfig.json
```

## 🧠 Agent 与 Skill 设定 (Prompt & Skills)

本项目不仅提供了底层的 Node.js MCP Server，还配套了高度优化的 Agent Prompt 设定文件，这两份文档是让大模型变“聪明”的关键：

### 1. `docs/prompts/system-prompt.md` (系统级 Prompt)

这是整个 Agent 系统的**宪法与行动指南**。它严格界定了 LLM 在处理 Web 自动化任务时的行为边界：

- **禁止自行编写代码**：所有操作必须且只能通过 MCP Skills 完成，防止模型“自作主张”去写不稳定的爬虫脚本。
- **固化执行编排流**：默认遵循“解析操作 -> 定位元素 -> 执行动作 -> 高亮截图 -> 生成报告”；对会导致元素消失的 `click`，允许“先高亮截图再点击”并在失败时回退到点击前截图。
- **强制沙箱与审计**：要求所有操作传入 `run_id` 并在失败时捕获完整的审计字段。

### 2. `docs/prompts/default-system-prompt.md` (默认系统提示)

这是一个轻量级的默认系统提示，**即使没有完整的 Agent 描述也能确保 AI 正确调用 MCP 工具**。它的核心特点是：

- **在开头就强烈禁止自行编写代码**：用最醒目的方式强调必须使用 MCP 工具
- **明确列出可用工具**：让 AI 知道可以调用哪些工具
- **提供基础工作流程**：指导 AI 如何按顺序使用工具

### 3. `ide-configs/trae/skills/web-manual-generator/SKILL.md` (低 Token 决策约束)

这是针对 Trae 这一类 AI IDE 设计的专用 Skill 配置，其核心价值在于**Token 节流与智能降级**：

- **在开头添加最强约束**：第一句就明确禁止自行编写代码，必须使用 MCP 工具
- **结构探测懒加载**：默认禁止一开始就拉取全量页面 DOM（极度消耗 Token），而是优先盲狙（`find_element`）。只有在盲狙失败、歧义过高或状态异常时，才触发 `inspect_summary` 扫视页面。
- **回退链路（Fallback）**：定义了 `稳定选择器 -> 语义匹配 -> 页面摘要` 的标准降级搜索顺序。
- **关键词截断**：指导模型在查找元素时主动裁剪无用介词，提取“业务词+控件词”的短组合，大幅提高命中率。

---

## ⚠️ 关键配置：确保 AI 不自行写脚本

为了避免 AI 在缺少 Agent 描述时自己写脚本而不调用 MCP，请确保以下配置：

### 必须配置项：

1. **SKILL 定义中的 description 字段必须包含关键约束**
   - 在 `.trae/skills/web-manual-generator/SKILL.md` 的 description 中添加：`"MUST USE MCP TOOLS ONLY - DO NOT WRITE ANY CODE OR SCRIPTS YOURSELF"`

2. **SKILL 内容开头必须有最优先规则**
   - 在 SKILL.md 的最顶部添加醒目的禁止自行写代码的规则
   - 用加粗、感叹号等方式强调这是最高优先级

3. **提供默认系统提示作为后备**
   - 使用 `docs/prompts/default-system-prompt.md` 作为默认系统提示
   - 这样即使没有完整的 Agent 描述，AI 也有基础约束

### 推荐使用方式：

- **最佳实践**：同时配置完整的 Agent 描述 + SKILL + 默认系统提示
- **最小配置**：至少配置 SKILL（已包含最强约束）

## 🛠️ 提供的 MCP 工具列表 (Tools)

大模型可通过以下标准 MCP 工具控制浏览器：

- **🔍 洞察与查找 (Insight & Find)**
  - `browser.inspect_summary`: 获取当前页面的精简可交互元素树（低 Token 消耗）。
  - `browser.inspect_detail`: 获取指定 `element_id` 的完整深层属性。
  - `browser.find`: 智能查找元素并返回唯一的 `element_id`，支持多重回退策略。
- **🖱️ 交互操作 (Action)**
  - `browser.click`: 点击指定元素，自带动态重试、等待以及跳转状态检测。
  - `browser.input`: 在指定的输入框中键入文本内容。
  - `browser.navigate`: 导航到目标 URL。
- **📜 记录与输出 (Record & Output)**
  - `browser.screenshot`: 捕获当前页面的截图。
  - `browser.get_run_context`: 获取当前会话 `run_id` 的操作步骤上下文，方便 LLM 了解已执行进度。
  - `generate_manual`: 根据历史操作步骤，将记录编译为 HTML 格式的操作手册。

## 🚀 快速开始 (Getting Started)

### 1. 安装依赖

```bash
npm install
# 安装 Playwright 所需浏览器二进制文件
npx playwright install chromium
```

### 2. 构建项目

```bash
npm run build
```

### 3. 作为 MCP Server 运行

配置您的 AI IDE（如 Cursor / Trae 等），将该 Server 添加到 MCP 配置中。启动命令：

```bash
node dist/index.js
```

### 4. IDE 配置示例

- Trae：`ide-configs/trae/`
- Cursor：`ide-configs/cursor/`
- 多 IDE 配置总览：`ide-configs/README.md`

## 表单校验自愈（Form Validation Self-Healing）

项目已支持提交失败后的结构化校验诊断与自愈流程：

- `click` 在校验失败时返回结构化 `VALIDATION_ERROR`，包含 `missing_fields` 与问题摘要。
- 新增 `inspect_validation(run_id, max_issues?)`，可返回缺失字段与可复用 `element_id` 线索。
- 推荐编排：识别校验失败 -> 补齐必填字段 -> 截图留痕 -> 重试提交（最多 2 轮）。
- 当达到 2 轮上限时，`click` 将返回 `SELF_HEAL_LIMIT_REACHED`，编排层必须停止自愈循环。
