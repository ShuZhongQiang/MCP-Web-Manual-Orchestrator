import type { ManualDocument, StepRecord } from "../types.js";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderAudit = (item: StepRecord): string => {
  if (!item.status) {
    return "";
  }
  const parts = [`状态: ${escapeHtml(item.status)}`];
  if (item.errorCode) {
    parts.push(`错误: ${escapeHtml(item.errorCode)}`);
  }
  if (typeof item.retryCount === "number") {
    parts.push(`重试: ${item.retryCount}`);
  }
  if (typeof item.latencyMs === "number") {
    parts.push(`耗时: ${item.latencyMs}ms`);
  }
  return `<p class="step-audit">${parts.join(" | ")}</p>`;
};

const renderNotes = (item: StepRecord): string => {
  const details: string[] = [];
  if ((item.missingFields?.length ?? 0) > 0) {
    details.push(`提交前识别缺失字段: ${item.missingFields?.join("、")}`);
  }
  if ((item.filledFields?.length ?? 0) > 0) {
    details.push(`自动补齐字段: ${item.filledFields?.join("、")}`);
  }
  if ((item.selfHealRounds ?? 0) > 0) {
    details.push(`自愈重试轮次: ${item.selfHealRounds}`);
  }
  const notes = [...details, ...(item.notes ?? [])].filter((entry) => entry.trim().length > 0);
  if (notes.length === 0) {
    return "";
  }
  return `<ul class="step-notes">${notes.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`;
};

const renderUrl = (item: StepRecord): string => {
  if (!item.pageUrlBefore && !item.pageUrlAfter) {
    return "";
  }
  const parts: string[] = [];
  if (item.pageUrlBefore) {
    parts.push(`前 URL: ${escapeHtml(item.pageUrlBefore)}`);
  }
  if (item.pageUrlAfter) {
    parts.push(`后 URL: ${escapeHtml(item.pageUrlAfter)}`);
  }
  return `<p class="step-url">${parts.join(" | ")}</p>`;
};

const renderEvidence = (item: StepRecord): string => {
  const evidence = item.evidence ?? [];
  if (evidence.length === 0) {
    return "";
  }
  const cards = evidence
    .map((entry) => {
      const image = entry.image
        ? `<img class="evidence-image" src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.label)}">`
        : "";
      return `<figure class="evidence-card">${image}<figcaption>${escapeHtml(entry.label)}</figcaption></figure>`;
    })
    .join("");
  return `<div class="evidence-grid">${cards}</div>`;
};

const renderStep = (item: StepRecord): string => {
  const action = item.action ? `<p class="step-action">动作: ${escapeHtml(item.action)}</p>` : "";
  const image = item.image
    ? `<div class="screenshot"><img class="step-image" src="${escapeHtml(item.image)}" alt="步骤 ${item.step} 截图"></div>`
    : "";
  const module = item.module ? `<span class="step-module">${escapeHtml(item.module)}</span>` : "";
  return `
        <article class="step">
            <div class="step-head">
                <h3 class="step-title">步骤 ${item.step}</h3>
                ${module}
            </div>
            ${action}
            <p class="step-desc">${escapeHtml(item.desc)}</p>
            ${renderAudit(item)}
            ${renderNotes(item)}
            ${renderUrl(item)}
            ${image}
            ${renderEvidence(item)}
        </article>`;
};

const renderModuleOverview = (document: ManualDocument): string => {
  if (document.modules.length === 0) {
    return "";
  }
  const cards = document.modules
    .map((module, index) => {
      const stepText =
        module.steps.length === 1
          ? `包含步骤 ${module.steps[0]}`
          : `包含步骤 ${module.steps[0]}-${module.steps[module.steps.length - 1]}`;
      return `
            <article class="module-card">
                <p class="module-card-index">模块 ${index + 1}</p>
                <h3 class="module-card-title">${escapeHtml(module.title)}</h3>
                <p class="module-card-desc">${escapeHtml(module.description)}</p>
                <p class="module-card-steps">${escapeHtml(stepText)}</p>
            </article>`;
    })
    .join("");

  return `
        <section class="overview">
            <h2 class="section-title">功能模块</h2>
            <div class="module-grid">
${cards}
            </div>
        </section>`;
};

const renderModules = (document: ManualDocument): string => {
  const stepMap = new Map(document.steps.map((item) => [item.step, item]));
  return document.modules
    .map((module, index) => {
      const steps = module.steps
        .map((stepNumber) => stepMap.get(stepNumber))
        .filter((item): item is StepRecord => Boolean(item));
      if (steps.length === 0) {
        return "";
      }
      return `
        <section class="module-section">
            <div class="module-header">
                <p class="module-index">模块 ${index + 1}</p>
                <h2 class="module-title">${escapeHtml(module.title)}</h2>
            </div>
            <p class="module-desc">${escapeHtml(module.description)}</p>
${steps.map((item) => renderStep(item)).join("")}
        </section>`;
    })
    .join("");
};

export const buildManualHtml = (runId: string, generatedAt: string, document: ManualDocument): string => {
  const body = renderModules(document);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(document.title)} (Run: ${escapeHtml(runId)})</title>
    <style>
        :root {
            --bg: #eef3f8;
            --panel: #ffffff;
            --panel-soft: #f8fbff;
            --line: #d9e3ef;
            --text: #213547;
            --muted: #5f6f82;
            --brand: #0f6cbd;
            --brand-soft: #e8f2ff;
            --shadow: 0 18px 45px rgba(15, 45, 75, 0.08);
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 24px;
            font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
            color: var(--text);
            background:
                radial-gradient(circle at top right, rgba(15, 108, 189, 0.10), transparent 24%),
                linear-gradient(180deg, #f7fbff 0%, var(--bg) 100%);
        }
        .container {
            max-width: 1100px;
            margin: 0 auto;
            background: var(--panel);
            border: 1px solid rgba(15, 108, 189, 0.08);
            border-radius: 24px;
            padding: 40px;
            box-shadow: var(--shadow);
        }
        .hero {
            padding: 28px;
            border-radius: 20px;
            background: linear-gradient(135deg, rgba(15, 108, 189, 0.08), rgba(15, 108, 189, 0.02));
            border: 1px solid rgba(15, 108, 189, 0.12);
        }
        h1 {
            margin: 0;
            font-size: 34px;
            line-height: 1.25;
            color: var(--brand);
        }
        .summary {
            margin: 14px 0 0;
            color: var(--text);
            font-size: 16px;
            line-height: 1.8;
        }
        .meta {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            margin-top: 18px;
            color: var(--muted);
            font-size: 14px;
        }
        .meta-chip {
            display: inline-flex;
            align-items: center;
            padding: 6px 12px;
            border-radius: 999px;
            background: var(--brand-soft);
            color: var(--brand);
        }
        .overview,
        .module-section {
            margin-top: 28px;
        }
        .section-title,
        .module-title {
            margin: 0;
            font-size: 24px;
            color: var(--text);
        }
        .module-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }
        .module-card,
        .module-section {
            background: var(--panel-soft);
            border: 1px solid var(--line);
            border-radius: 18px;
        }
        .module-card {
            padding: 18px 20px;
        }
        .module-card-index,
        .module-index {
            margin: 0 0 8px;
            color: var(--brand);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .module-card-title {
            margin: 0;
            font-size: 20px;
        }
        .module-card-desc,
        .module-card-steps,
        .module-desc {
            color: var(--muted);
            line-height: 1.7;
        }
        .module-card-desc {
            margin: 10px 0 0;
            font-size: 14px;
        }
        .module-card-steps {
            margin: 12px 0 0;
            font-size: 13px;
        }
        .module-section {
            padding: 24px;
        }
        .module-header {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
        }
        .module-desc {
            margin: 10px 0 0;
            font-size: 15px;
        }
        .step {
            margin-top: 18px;
            padding: 20px;
            border-radius: 16px;
            border: 1px solid var(--line);
            background: var(--panel);
        }
        .step-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .step-title {
            margin: 0;
            font-size: 20px;
        }
        .step-module {
            padding: 4px 10px;
            border-radius: 999px;
            background: var(--brand-soft);
            color: var(--brand);
            font-size: 12px;
            font-weight: 700;
        }
        .step-action {
            margin: 10px 0 0;
            color: var(--muted);
            font-size: 13px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
        .step-desc {
            margin: 12px 0 0;
            font-size: 16px;
            line-height: 1.8;
        }
        .step-audit {
            margin: 12px 0 0;
            color: var(--text);
            font-size: 13px;
            line-height: 1.6;
        }
        .step-notes {
            margin: 12px 0 0;
            padding-left: 18px;
            color: var(--text);
            font-size: 14px;
            line-height: 1.7;
        }
        .step-notes li + li {
            margin-top: 6px;
        }
        .step-url {
            margin: 8px 0 0;
            color: var(--muted);
            font-size: 12px;
            line-height: 1.6;
            word-break: break-all;
        }
        .screenshot {
            margin-top: 18px;
        }
        .step-image {
            display: block;
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 12px;
            box-shadow: 0 10px 24px rgba(15, 45, 75, 0.08);
        }
        .evidence-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 12px;
            margin-top: 14px;
        }
        .evidence-card {
            margin: 0;
            padding: 12px;
            border: 1px solid var(--line);
            border-radius: 12px;
            background: var(--panel-soft);
        }
        .evidence-image {
            display: block;
            width: 100%;
            border-radius: 10px;
            border: 1px solid rgba(15, 108, 189, 0.12);
        }
        .evidence-card figcaption {
            margin-top: 8px;
            font-size: 13px;
            line-height: 1.6;
            color: var(--muted);
        }
        .footer {
            margin-top: 32px;
            text-align: center;
            color: var(--muted);
            font-size: 13px;
        }
        @media (max-width: 768px) {
            body { padding: 12px; }
            .container { padding: 20px; border-radius: 16px; }
            .hero { padding: 20px; }
            h1 { font-size: 28px; }
            .module-section { padding: 18px; }
            .step { padding: 16px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <section class="hero">
            <h1>${escapeHtml(document.title)}</h1>
            <p class="summary">${escapeHtml(document.summary)}</p>
            <div class="meta">
                <span>生成时间: ${escapeHtml(generatedAt)}</span>
                <span class="meta-chip">Run: ${escapeHtml(runId)}</span>
            </div>
        </section>
${renderModuleOverview(document)}
${body}
        <div class="footer">
            <p>Generated by TRAE Web Manual Agent</p>
        </div>
    </div>
</body>
</html>`;
};
