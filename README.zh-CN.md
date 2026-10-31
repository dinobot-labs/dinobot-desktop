<p align="center">
  <img src=".github/assets/logo.svg" alt="Dinobot 标志" width="160">
</p>

# Dinobot Desktop

**Dinobot 的桌面界面。**

在基于 Electron 和 React 的应用中继续对话、回答智能体的问题，并查看生成的文件。Desktop 是客户端；智能体由兼容的 Dinobot 守护进程运行。

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)

源码依据 [PolyForm Noncommercial 1.0.0](LICENSE) 公开，但不属于 OSI 定义的开源软件。商业使用须另行取得相关权利人的许可。

## 演示

https://github.com/user-attachments/assets/1955b0cb-3f0f-4266-b968-35b7844964b7

## 选择界面

- **Desktop — 本仓库。** 图形客户端、Electron 集成及共享 React UI 组件。
- **Core + 终端用户界面（TUI）。** 智能体守护进程与终端界面，在独立仓库中维护。

Dinobot core 与 TUI
https://github.com/dinobot-labs/dinobot

## 界面提供的功能

| 场景 | 客户端功能 |
| --- | --- |
| 对话 | 发送文字、图片和文件，回答智能体的问题，并停止正在运行的回合。文件附件要求守护进程运行在同一台计算机上。 |
| 生成的文件 | 在对话旁查看受支持的本地产物，包括图片和 HTML 预览。 |
| 设置与用量 | 访问账号、模型、插件和守护进程设置。上下文用量仅在模型提供方返回 token 数时显示，不估算各类内容的用量分布。 |

功能是否可用取决于连接的守护进程和运行环境。共享 UI 另有用于组件开发的样式指南。

## 从源码开始

**本仓库目前支持源码构建，尚不提供公开安装程序。** 历史固定守护进程版本 `0.7.15-local.browser.1` 不是可公开下载的发行版。仅构建源码并不会生成可安装的应用。

所需工具：**Bun 1.4.3**、**Node.js 22 或更新版本**、**Git**。在仓库根目录执行：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check:public
bun run typecheck
bun run test
bun run build
```

构建生成渲染器、样式指南以及 Electron main/preload 文件包。它不会下载守护进程、构建安装程序或发布发行版，也不需要访问私有仓库。依赖的生命周期脚本被有意禁用；源码构建和使用合成数据的单元测试不需要模型凭据。

开发界面时，可根据需要在仓库根目录运行以下命令：

```sh
bun run dev
bun run dev:styleguide
```

渲染器需要兼容的本地守护进程。本地运行 Electron 还需要单独执行 Electron 上游提供的运行时安装程序；该下载不属于仅针对源码的验证范围。项目结构和运行条件见[开发指南](docs/wiki/Development.md)。

`apps/desktop` 中的 `dist`、`dist:win`、`dist:mac` 和 `stage:daemon` 命令为未来的打包工作保留，并非受支持的公开安装程序构建指引。尝试打包前，请阅读[发布范围](docs/wiki/Release.md)。

## 运行环境与隐私边界

- 不包含模型凭据或付费服务。本地界面不代表所有操作都离线进行；是否发起外部请求取决于连接的守护进程和配置的服务提供方。
- 本源码仓库不包含生产环境的问题报告服务或私有部署系统。问题报告界面需要 core 提供 `dinobot report consent|agree|send --json`；合成数据测试不能验证生产报告服务。
- 提交问题时，请提供最小化的合成复现案例，不要上传会话导出、令牌或个人截图。漏洞请按[安全说明](SECURITY.md)私下报告。

## 文档与贡献

- [开发指南](docs/wiki/Development.md) · [Wiki 源文件](docs/wiki/Home.md) · [发布范围](docs/wiki/Release.md)
- [贡献指南](CONTRIBUTING.md) · [行为准则](CODE_OF_CONDUCT.md) · [安全](SECURITY.md)
- [许可说明](docs/wiki/Licensing.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

`main` 是持续维护的源码，而非冻结的导出副本。[公开源码溯源](PUBLIC_SNAPSHOT.md)和[来源数据](SOURCE_PROVENANCE.json)区分当前源码增量、历史导出和未更改的打包版本字段。[源码哈希](SOURCE_HASHES.json)记录 Git blob 的原始字节：`bun scripts/source-hashes.ts --check` 检查暂存区索引，也可传入修订版本以检查对应的树。

## 许可证

在 [PolyForm Noncommercial 1.0.0](LICENSE) 许可的用途范围内可免费使用。商业使用须另行取得相关权利人的许可。依赖和字体分别遵循各自的许可证，详见[第三方声明](THIRD_PARTY_NOTICES.md)。

许可与安全联系邮箱：dev0jsh@gmail.com。
