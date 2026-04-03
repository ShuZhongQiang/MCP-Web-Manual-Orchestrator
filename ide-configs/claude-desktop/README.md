# Claude Desktop 配置说明

请在 Claude Desktop 的 MCP 配置文件中添加如下服务定义：

**配置文件位置**：
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**配置内容**：
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

**注意事项**：
- 请将 `<项目绝对路径>` 替换为实际的项目路径
- 配置后需要重启 Claude Desktop
