# Trae 配置说明

请在 Trae 的 MCP Server 配置中添加如下服务定义：

```json
{
  "mcpServers": {
    "mcp-web-manual-orchestrator": {
      "command": "node",
      "args": ["<项目绝对路径>/dist/index.js"]
    }
  }
}
```

可直接参考同目录下的 `mcp.config.example.json`。

Skill 约束文件位置：
- `skills/web-manual-generator/SKILL.md`

