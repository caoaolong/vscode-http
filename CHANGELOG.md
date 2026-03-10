# Change Log

本文件记录 "vscode-http" 扩展的 notable 变更，格式参考 [Keep a Changelog](http://keepachangelog.com/)。

## [Unreleased]

### 变更

- 在 `package.json` 中补充 `repository` 字段，指向 GitHub 仓库，消除 `vsce package` 时的缺失仓库警告。

## [0.0.4]

### 修复

- 修复安装后侧边栏（Activity Bar）图标不显示：将视图容器图标由不存在的 `./logo.svg` 改为 `./resources/icon.svg`。

## [0.0.2]

### 变更

- **打包体积**：Monaco Editor 改为从 CDN（jsDelivr）加载，不再打入 vsix，安装包由约 73MB 降至约 50KB 以内。
- 移除对 `monaco-editor` 的 npm 依赖，运行时完全通过 CDN 加载。

## [0.0.1]

### 新增

- 初始发布：HTTP 客户端基础能力。
- 项目 / 集合 / 接口管理，环境管理。
- 请求编辑器：支持 JSON、XML、Raw、GraphQL 等 Body 编辑（Monaco）。
- HTTP 请求发送与响应展示。
- WebSocket 与 SSE 支持。
- 授权、Query 参数、Form 等基础能力。
