# 🌐 Node Fast MCP Web Manual Agent

一个专为大语言模型（LLM）设计的**生产级 Web 自动化与操作手册生成系统**。基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io) 标准，结合 Playwright 的强大浏览器控制能力，实现了**高成功率**、**低 Token 消耗**的网页交互与自动文档生成。

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
  - 赋予大模型精准的**自我纠错（Self-Correction）**能力，Agent 可以明确知道上一步点击是否成功、是否引起了预期内的页面跳转。
- **📸 自动化手册生成**
  - 在后台零干预记录每一步交互（含截图与高亮），任务完成后一键生成精美、结构化的 HTML Web 操作手册。

## 📂 目录结构 (Architecture)

```text
Node_Fast_Mcp_Web_Manual_Agent/
├── .trae/
│   └── skills/
│       └── web-manual-agent/
│           └── SKILL.md        # Trae 编辑器专属 Skill 定义，约束了低 Token 决策树与调用准则
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
├── web_manual_agent.md         # 核心 Agent System Prompt：定义了 Agent 的身份边界、容错处理与编排流
```

## 🧠 Agent 大脑设定 (Prompt & Skills)

本项目不仅提供了底层的 Node.js MCP Server，还配套了高度优化的 Agent Prompt 设定文件，这两份文档是让大模型变“聪明”的关键：

### 1. `web_manual_agent.md` (系统级 Prompt)
这是整个 Agent 系统的**宪法与行动指南**。它严格界定了 LLM 在处理 Web 自动化任务时的行为边界：
- **禁止自行编写代码**：所有操作必须且只能通过 MCP Skills 完成，防止模型“自作主张”去写不稳定的爬虫脚本。
- **固化执行编排流**：强制约定了“解析操作 -> 定位元素 -> 执行动作 -> 高亮截图 -> 生成报告”的标准 SOP。
- **强制沙箱与审计**：要求所有操作传入 `run_id` 并在失败时捕获完整的审计字段。

### 2. `.trae/skills/web-manual-agent/SKILL.md` (低 Token 决策约束)
这是针对 Trae 这一类 AI IDE 设计的专用 Skill 配置，其核心价值在于**Token 节流与智能降级**：
- **结构探测懒加载**：默认禁止一开始就拉取全量页面 DOM（极度消耗 Token），而是优先盲狙（`find_element`）。只有在盲狙失败、歧义过高或状态异常时，才触发 `inspect_summary` 扫视页面。
- **回退链路（Fallback）**：定义了 `稳定选择器 -> 语义匹配 -> 页面摘要` 的标准降级搜索顺序。
- **关键词截断**：指导模型在查找元素时主动裁剪无用介词，提取“业务词+控件词”的短组合，大幅提高命中率。

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
