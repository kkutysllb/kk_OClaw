---
name: ppt-generation
version: 3.0.0
description: 基于 Google Gemini AI 自动生成高质量 PPT 图片和视频演示文稿，支持渐变毛玻璃和矢量插画两种专业风格，含交互式 HTML 播放器和可选转场视频。触发词：生成PPT、创建演示文稿、做slides、make a presentation、create slides、presentation。
tags: ppt, presentation, slides, ai, gemini, image-generation, nano-banana, video
---

# PPT Generation - KKOCLAW Skill

> Based on [NanoBanana-PPT-Skills](https://github.com/op7418/NanoBanana-PPT-Skills) v2.0 by 歸藏

## 📋 概述

基于 Google Gemini AI 自动生成高质量 PPT 图片和视频演示文稿。支持渐变毛玻璃和矢量插画两种专业风格，自动生成交联式 HTML5 播放器，可选 AI 转场视频。

## ✨ 功能特性

### 核心功能
- 🤖 **智能文档分析** - 自动提取核心要点，规划 PPT 内容结构
- 🎨 **多风格支持** - 内置渐变毛玻璃、矢量插画两种专业风格
- 🖼️ **高质量图片** - 使用 Gemini 图生图模型生成 16:9 高清 PPT（支持 2K/4K）
- 🎬 **AI 转场视频** - 可灵 AI 生成流畅的页面过渡动画（可选）
- 🎮 **交互式播放器** - 视频+图片混合播放，支持键盘导航
- 🎥 **完整视频导出** - FFmpeg 合成包含所有转场的完整 PPT 视频（可选）
- 🔄 **自动重试** - 图片生成失败自动重试，提升成功率
- 🔌 **代理端点支持** - 支持 GEMINI_BASE_URL 自定义 API 代理端点

### 新功能 (v3.0)
- 🔄 **首页循环预览** - 自动生成吸引眼球的循环动画
- 🎞️ **智能转场** - 自动生成页面间的过渡视频
- 🔧 **参数统一** - 自动统一所有视频分辨率和帧率
- 🔌 **代理端点** - 支持 GEMINI_BASE_URL 配置自定义 API 端点

## 📦 系统要求

### 环境变量（必需）

- `GEMINI_API_KEY`: Google AI API 密钥

**可选配置：**
- `GEMINI_BASE_URL`: 自定义 Gemini API 代理端点 URL（如使用代理服务）

**配置方式**（任选其一）：
1. 在项目根目录 `.env` 文件中设置（推荐）
2. 设置系统环境变量 `export GEMINI_API_KEY='your-key'`

**视频功能（可选）：**
- `KLING_ACCESS_KEY`: 可灵 AI Access Key
- `KLING_SECRET_KEY`: 可灵 AI Secret Key

### Python 依赖

```bash
pip install google-genai pillow python-dotenv
```

### 视频功能依赖（可选）

```bash
pip install PyJWT requests
# macOS
brew install ffmpeg
```

## 🚀 触发条件

当用户请求以下内容时触发本技能：
- "生成 PPT"、"创建演示文稿"、"做一份 slides"
- "make a presentation"、"create slides"
- 基于某个文档/主题生成 PPT
- 包含 PPT/演示/幻灯片 相关关键词

## 📝 Skill 执行流程

**核心流程为三阶段：收集输入 → 生成 slides_plan.json → 调用 Python 脚本**

### 阶段 1: 收集用户输入

#### 1.1 获取文档内容

**方式 A: 文件路径**
- 用户提供了文件路径 → 使用 read_file 工具读取文件内容

**方式 B: 直接文本**
- 用户直接在消息中提供了内容

**方式 C: 主动询问**
- 如果用户未提供内容，询问用户："请提供文档路径或直接粘贴您想要做成 PPT 的内容"

#### 1.2 确认风格（如未指定）

技能内置两种风格：

| 风格 | 文件 | 适用场景 |
|------|------|---------|
| 渐变毛玻璃卡片风格 | `gradient-glass.md` | 科技产品、商务演示、数据报告 |
| 矢量插画风格 | `vector-illustration.md` | 教育培训、创意提案、温暖故事 |

如果用户未明确指定风格，根据内容主题自动推荐合适的风格，无需逐一询问。

#### 1.3 确认页数（如未指定）

根据文档长度推荐合理的页数范围。一般原则：
- 短文档（<500字）: 5-8 页
- 中等文档（500-2000字）: 8-15 页
- 长文档（>2000字）: 15-25 页

#### 1.4 确认分辨率

默认使用 2K (2752x1536)，除非用户明确要求 4K。2K 生成速度约 30 秒/页，4K 约 60 秒/页。

#### 1.5 是否生成视频（可选）

如果配置了可灵 AI 密钥（`KLING_ACCESS_KEY` 和 `KLING_SECRET_KEY`），询问用户是否需要转场视频。

### 阶段 2: 文档分析与内容规划

#### 2.1 分析文档并规划内容

**这是本技能最核心的步骤！** LLM 必须仔细阅读用户提供的文档内容，提取核心要点，并规划每一页 PPT 的内容。

**内容规划原则：**
- **封面页 (cover)**：标题 + 副标题/核心主题，文字精炼
- **内容页 (content)**：每页聚焦一个核心观点，使用要点列表或简短段落，避免大段文字
- **数据页 (data)**：用于展示关键数据、对比、统计信息
- **总结页 (content)**：核心结论或行动建议

**内容精炼原则（极其重要）：**
- 每页 PPT 上的文字控制在 30-60 个英文单词或 50-100 个中文字以内
- PPT 是视觉辅助，不是文档复制！将长段落提炼为关键词和短句
- 使用列表、数字编号组织信息
- 数据页用数字和百分比呈现，而非长篇描述

#### 2.2 生成 slides_plan.json

**重要：必须先完成这一步，再调用 Python 脚本！**

在用户工作目录下生成 `slides_plan.json` 文件：

```json
{
  "title": "演示文稿标题",
  "total_slides": 5,
  "slides": [
    {
      "slide_number": 1,
      "page_type": "cover",
      "content": "标题：XXX\n副标题：XXX"
    },
    {
      "slide_number": 2,
      "page_type": "content",
      "content": "要点标题\n- 要点1\n- 要点2\n- 要点3"
    },
    {
      "slide_number": 3,
      "page_type": "data",
      "content": "数据标题\n指标A：85%\n指标B：+27%\n指标C：1,200万"
    },
    {
      "slide_number": 4,
      "page_type": "content",
      "content": "核心发现\n1. 发现一\n2. 发现二\n3. 发现三"
    },
    {
      "slide_number": 5,
      "page_type": "content",
      "content": "总结与行动建议\n- 建议一\n- 建议二\n- 下一步"
    }
  ]
}
```

**重要规则：**
- `page_type` 只能是 `cover`、`content`、`data` 三种之一
- 第一页必须设为 `cover`
- 最后一页建议为总结（`content`），或设为 `data` 如果有重要数据
- `content` 字段使用 `\n` 表示换行
- 将此文件保存到用户的工作目录（如 `/mnt/user-data/workspace/slides_plan.json`）

### 阶段 3: 调用 Python 脚本生成 PPT

#### 3.1 确认环境就绪

在执行前，先确认：
1. Python 依赖已安装（`google-genai`、`pillow`、`python-dotenv`）
2. `GEMINI_API_KEY` 环境变量已设置（在项目根目录 `.env` 中配置）

如果依赖未安装，执行：
```bash
pip install google-genai pillow python-dotenv
```

#### 3.2 执行生成命令

```bash
cd /mnt/user-data/workspace && python /mnt/skills/public/ppt-generation/scripts/generate_ppt.py \
  --plan slides_plan.json \
  --style /mnt/skills/public/ppt-generation/scripts/gradient-glass.md \
  --resolution 2K \
  --template /mnt/skills/public/ppt-generation/scripts/viewer.html
```

**参数说明：**
- `--plan`: slides_plan.json 的路径（工作目录下的相对路径即可）
- `--style`: 风格模板绝对路径（`gradient-glass.md` 或 `vector-illustration.md`）
- `--resolution`: 分辨率（`2K` 或 `4K`，默认 `2K`）
- `--template`: HTML 播放器模板绝对路径
- `--output`: 输出目录路径（可选，默认为 `outputs/TIMESTAMP`）

> **路径说明**：脚本支持相对路径自动解析——如果传入的相对路径在当前目录找不到，会自动尝试在脚本所在目录（`/mnt/skills/public/ppt-generation/scripts/`）下查找。因此也可以使用简写：`--style gradient-glass.md`。

#### 3.3 监控生成进度

脚本会输出进度信息，每页约需 30 秒（2K）或 60 秒（4K）。如果某页生成失败会自动重试。

#### 3.4 收集并返回结果

生成完成后，脚本会在输出目录下创建：
```
outputs/TIMESTAMP/
├── images/
│   ├── slide-01.png    # 封面
│   ├── slide-02.png    # 内容页
│   └── ...
├── index.html          # 交互式 HTML 播放器
└── prompts.json        # 所有页面的提示词记录
```

**返回结果给用户：**
1. 告知用户生成完成，列出输出目录
2. 使用 `present_files` 展示所有生成的图片和 HTML 文件
3. 说明 HTML 播放器的使用方法

**播放器快捷键：**
- `← →` 键：切换页面
- `↑` 键：回到首页
- `↓` 键：跳到末页
- `空格`：暂停/继续自动播放
- `ESC`：全屏切换
- `H`：隐藏/显示控件

### 阶段 4: 生成转场视频（可选）

**仅在用户选择视频模式且配置了可灵 AI 密钥时执行。**

#### 4.1 生成转场提示词

分析生成的 PPT 图片，为每个转场生成精准的视频提示词。将提示词保存到：
```
outputs/TIMESTAMP/transition_prompts.json
```

#### 4.2 生成转场视频

```bash
python /mnt/skills/public/ppt-generation/scripts/generate_ppt_video.py \
  --slides-dir outputs/TIMESTAMP/images \
  --output-dir outputs/TIMESTAMP_video \
  --prompts-file outputs/TIMESTAMP/transition_prompts.json
```

### 阶段 5: 错误处理

**如果生成过程中出错：**
1. 检查 `GEMINI_API_KEY` 是否正确设置
2. 如使用代理端点，检查 `GEMINI_BASE_URL` 是否正确
3. 检查网络连接是否正常
4. 查看错误信息并告知用户
5. 如果是个别页面失败，可以修改 slides_plan.json 中该页的内容后单独重新运行

## ⚠️ 注意事项

1. **内容精炼**：PPT 上的文字必须精炼，每页控制在 100 中文字以内。不要把文档原文直接复制到 PPT 上
2. **API 密钥安全**：不要在对话中暴露 API 密钥
3. **生成时间**：每页约 30 秒（2K），请耐心等待
4. **风格一致性**：一个演示文稿内使用同一种风格
5. **英文内容**：如果原文是中文，PPT 中的文字建议保持中文；如果是英文文档则用英文
6. **代理端点**：如果 `GEMINI_BASE_URL` 已配置，脚本会自动使用代理端点调用 API

## 🎨 风格系统

### 渐变毛玻璃卡片风格 (`gradient-glass.md`)

**视觉特点：**
- Apple Keynote 极简主义
- 玻璃拟态效果
- 霓虹紫/电光蓝/珊瑚橙渐变
- 3D 玻璃物体 + 电影级光照

**适用场景：** 科技产品发布、商务演示、数据报告、企业品牌展示

### 矢量插画风格 (`vector-illustration.md`)

**视觉特点：**
- 扁平化矢量设计
- 统一黑色轮廓线
- 复古柔和配色
- 几何化简化

**适用场景：** 教育培训、创意提案、儿童内容、品牌展示

## 📁 技能文件结构

```
skills/public/ppt-generation/
├── SKILL.md                          # 本文件（技能定义）
├── scripts/
│   ├── generate_ppt.py               # 核心 PPT 生成脚本
│   ├── generate_ppt_video.py         # 视频生成脚本（可选）
│   ├── kling_api.py                  # 可灵 AI API 客户端（可选）
│   ├── video_composer.py             # FFmpeg 视频合成（可选）
│   ├── video_materials.py            # 视频素材生成（可选）
│   ├── gradient-glass.md             # 渐变毛玻璃风格模板
│   ├── vector-illustration.md        # 矢量插画风格模板
│   ├── viewer.html                   # HTML5 图片播放器模板
│   └── video_viewer.html             # HTML5 视频播放器模板（可选）
```

## 🔧 技术细节

### 图片生成 API

- **模型**: `gemini-3-pro-image-preview` (Google Gemini)
- **比例**: 16:9
- **响应模式**: IMAGE
- **分辨率**: 2K (2752x1536) / 4K (5504x3072)
- **重试**: 失败自动重试 2 次
- **代理支持**: 通过 `GEMINI_BASE_URL` 配置自定义端点

### 视频生成 API（可选）

- **模型**: kling-v2-6 (可灵 AI)
- **模式**: 专业模式（pro）
- **时长**: 5 秒
- **分辨率**: 1920x1080
- **帧率**: 24fps

### 风格模板解析

风格模板文件使用 Markdown 格式，脚本会提取 `## 基础提示词模板` 标记之后的所有内容作为基础提示词，然后根据页面类型（cover/content/data）追加不同的布局指令。

### 交互式播放器

**图片播放器** (`viewer.html`)：
- 键盘导航（方向键、空格、ESC、H）
- 触摸滑动（移动端）
- 自动播放模式（3 秒切换）
- 自动隐藏控件（3 秒无操作）
- 全屏模式

**视频播放器** (`video_viewer.html`)：
- 首页循环预览视频
- 转场视频自动播放
- 键盘导航（方向键、空格、ESC、H）
- 全屏模式

## 📄 许可证

MIT License - 原始项目 [NanoBanana-PPT-Skills](https://github.com/op7418/NanoBanana-PPT-Skills) by 歸藏
