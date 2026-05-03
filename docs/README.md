# 文档目录

本文档目录包含 KKOCLAW 后端的详细文档。

## 快速链接

| 文档 | 描述 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统架构概览 |
| [API.md](API.md) | 完整 API 参考 |
| [CONFIGURATION.md](CONFIGURATION.md) | 配置选项 |
| [SETUP.md](SETUP.md) | 快速安装指南 |

## 功能文档

| 文档 | 描述 |
|------|------|
| [STREAMING.md](STREAMING.md) | Token 级流式输出设计：Gateway 与 KKOCLAWClient 路径、`stream_mode` 语义、按 ID 去重 |
| [FILE_UPLOAD.md](FILE_UPLOAD.md) | 文件上传功能 |
| [PATH_EXAMPLES.md](PATH_EXAMPLES.md) | 路径类型与使用示例 |
| [summarization.md](summarization.md) | 上下文摘要功能 |
| [plan_mode_usage.md](plan_mode_usage.md) | Plan 模式与 TodoList |
| [AUTO_TITLE_GENERATION.md](AUTO_TITLE_GENERATION.md) | 自动标题生成 |

## 开发

| 文档 | 描述 |
|------|------|
| [TODO.md](TODO.md) | 计划功能与已知问题 |

## 快速入门

1. **KKOCLAW 新手？** 从 [SETUP.md](SETUP.md) 开始快速安装
2. **配置系统？** 查看 [CONFIGURATION.md](CONFIGURATION.md)
3. **了解架构？** 阅读 [ARCHITECTURE.md](ARCHITECTURE.md)
4. **构建集成？** 查阅 [API.md](API.md) API 参考

## 文档组织

```
docs/
├── README.md                  # 本文件
├── ARCHITECTURE.md            # 系统架构
├── API.md                     # API 参考
├── CONFIGURATION.md           # 配置指南
├── SETUP.md                   # 安装说明
├── FILE_UPLOAD.md             # 文件上传功能
├── PATH_EXAMPLES.md           # 路径使用示例
├── summarization.md           # 摘要功能
├── plan_mode_usage.md         # Plan 模式功能
├── STREAMING.md               # Token 级流式输出设计
├── AUTO_TITLE_GENERATION.md   # 标题生成
├── TITLE_GENERATION_IMPLEMENTATION.md  # 标题实现细节
└── TODO.md                    # 路线图与问题
```
