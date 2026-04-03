# Cursor 配置说明

请在 Cursor 的 MCP 配置中添加如下服务定义：

```json
{
  "mcpServers": {
    "mcp-web-manual-orchestrator": {
      "command": "node",
      "args": ["<项目绝对路径>/dist/index.js"],
      "cwd": "<项目绝对路径>"
    }
  }
}
```

可直接参考同目录下的 `mcp.config.example.json`。
