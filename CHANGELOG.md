# Change Log

本文件记录 "vscode-http" 扩展的 notable 变更，格式参考 [Keep a Changelog](http://keepachangelog.com/)。

## [Unreleased]

（暂无）

## [0.0.7]

### 优化

- **本地编辑器**：请求体和响应体编辑器从 Monaco CDN 切换为本地 JSONEditor，无需联网即可使用，响应体支持树形展开/折叠浏览 JSON。
- **请求自动保存**：发送请求前自动保存当前配置，切换页面不丢失编辑内容。
- **JSON 粘贴自动格式化**：编辑器粘贴 JSON 内容时自动格式化。

### 修复

- 修复 WebSocket 模块可选依赖（bufferutil/utf-8-validate）打包报错问题。

## [0.0.6]

### 新增

- **图片与二进制响应**：HTTP 响应为图片（PNG/JPEG/GIF/WebP 等）时在请求编辑器和实例预览中直接展示图片，并提供「下载图片」按钮；其他二进制响应显示字节数并提供「下载文件」按钮，支持从 `Content-Disposition` 解析建议文件名。
- **路径参数**：请求编辑器中支持为接口配置路径参数（如 `/users/:id`），在 URL 输入区下方显示路径参数输入框，发送前自动替换 URL 中的占位符。

### 变更

- 请求区域布局调整：名称、方法、URL 输入与操作按钮分两行展示，URL 输入框独占一行便于长路径编辑。
- 移除未使用的 Hello World 命令注册。
- 精简交互提示：删除集合/接口/实例、保存请求、保存实例、切换环境时的冗余信息提示，减少打扰。

## [0.0.5]

### 修复

- 修复发布后安装的扩展侧边栏图标不显示：将 Activity Bar 视图容器图标改为 PNG（`resources/icon.png`），避免部分环境下 SVG 因 MIME 类型或加载策略导致的显示问题。

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
