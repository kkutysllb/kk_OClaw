---
name: pdf-processing
description: Handle common PDF tasks — convert PDF to Markdown (preserving structure), extract text, extract tables, merge/split PDFs, create PDF from text, and read metadata. Trigger when the user uploads a PDF and wants to read it, convert it, split it, merge multiple PDFs, extract tables, or get page counts.
---

# PDF Processing Skill

## Overview

This skill handles everyday PDF operations using pymupdf (fitz), pymupdf4llm, and pdfplumber:

| 操作 | Action | 说明 |
|------|--------|------|
| **转为 Markdown** | `convert-to-markdown` | ⭐ **首选** 将 PDF 转为结构化 Markdown（保留标题、表格、格式）|
| 提取文本 | `extract-text` | 提取 PDF 中全部文字，保存为 .txt |
| 提取表格 | `extract-tables` | 检测并提取 PDF 中的表格，保存为 .csv/.json |
| 合并 PDF | `merge` | 将多个 PDF 按顺序合并为一个 |
| 拆分 PDF | `split` | 将 PDF 拆分为单独页面或指定页数一组 |
| 创建 PDF | `create` | 从纯文本文件生成 PDF |
| 查看信息 | `info` | 查看页数、标题、作者等元数据 |

## Dependencies

```bash
pip install pymupdf pymupdf4llm pdfplumber
```

> pymupdf is required for all operations. pymupdf4llm is needed for `convert-to-markdown`. pdfplumber is only needed for `extract-tables`.

## Workflow

### 推荐工作流：PDF → Markdown → 分析

当用户上传 PDF 想了解内容时，**应先转为 Markdown**，再用 `read_file` 等工具读取结构化内容进行分析。
直接从 PDF 提取纯文本会丢失文档结构（标题层级、表格、格式），导致后续分析效率低下。

```bash
# Step 1: 先转为 Markdown
python /mnt/skills/public/pdf-processing/scripts/generate.py convert-to-markdown \
  --input /mnt/user-data/uploads/document.pdf \
  --output /mnt/user-data/outputs/document.md

# Step 2: 用 read_file 工具读取 Markdown 进行分析
# 可以用 line 参数按需读取特定段落
# 可以用 grep 精确搜索关键词
```

### 操作速查表

| 用户说 | 对应操作 |
|--------|---------|
| "帮我看看这个 PDF 里写了什么" | `convert-to-markdown` → 然后 `read_file` 读取 .md |
| "分析这份 PDF 的内容" | `convert-to-markdown` → 然后 `read_file` 读取 .md |
| "把 PDF 里的表格导出来" | `extract-tables` |
| "把这 3 个 PDF 合成一个" | `merge` |
| "把 PDF 每一页拆成单独文件" | `split` |
| "把这个文本文件转成 PDF" | `create` |
| "这个 PDF 有多少页" | `info` |

### Step 2: Execute

Call the Python script with the appropriate subcommand.

## Commands

### convert-to-markdown — 转为 Markdown（⭐ 首选）

```bash
python /mnt/skills/public/pdf-processing/scripts/generate.py convert-to-markdown \
  --input /mnt/user-data/uploads/document.pdf \
  --output /mnt/user-data/outputs/document.md
```

转换后的 Markdown 保留：
- 标题层级（H1-H6）
- 表格（Markdown table 格式）
- 粗体/斜体格式
- 列表（有序/无序）
- 图片引用

转换完成后，用 `read_file` 工具读取 .md 文件进行分析。

### extract-text — 提取文本

```bash
python /mnt/skills/public/pdf-processing/scripts/generate.py extract-text \
  --input /mnt/user-data/uploads/document.pdf \
  --output /mnt/user-data/outputs/document.txt

# 只提取第 1-3 页和第 5 页
python /mnt/skills/public/pdf-processing/scripts/generate.py extract-text \
  --input /mnt/user-data/uploads/document.pdf \
  --output /mnt/user-data/outputs/document.txt \
  --pages "1-3,5"
```

### extract-tables — 提取表格

```bash
# 导出为 CSV
python /mnt/skills/public/pdf-processing/scripts/generate.py extract-tables \
  --input /mnt/user-data/uploads/report.pdf \
  --output /mnt/user-data/outputs/tables.csv

# 导出为 JSON
python /mnt/skills/public/pdf-processing/scripts/generate.py extract-tables \
  --input /mnt/user-data/uploads/report.pdf \
  --output /mnt/user-data/outputs/tables.json \
  --pages "2-5"
```

### merge — 合并 PDF

```bash
python /mnt/skills/public/pdf-processing/scripts/generate.py merge \
  --inputs /mnt/user-data/uploads/chapter1.pdf /mnt/user-data/uploads/chapter2.pdf /mnt/user-data/uploads/chapter3.pdf \
  --output /mnt/user-data/outputs/combined.pdf
```

### split — 拆分 PDF

```bash
# 每页一个文件
python /mnt/skills/public/pdf-processing/scripts/generate.py split \
  --input /mnt/user-data/uploads/document.pdf \
  --output-dir /mnt/user-data/outputs/split/

# 每 2 页一个文件
python /mnt/skills/public/pdf-processing/scripts/generate.py split \
  --input /mnt/user-data/uploads/document.pdf \
  --output-dir /mnt/user-data/outputs/split/ \
  --pages-per-file 2
```

### create — 创建 PDF

```bash
python /mnt/skills/public/pdf-processing/scripts/generate.py create \
  --input /mnt/user-data/workspace/content.txt \
  --output /mnt/user-data/outputs/document.pdf
```

### info — 查看信息

```bash
python /mnt/skills/public/pdf-processing/scripts/generate.py info \
  --input /mnt/user-data/uploads/document.pdf
```

## Parameters Reference

| 参数 | 适用操作 | 说明 |
|------|---------|------|
| `--input` | convert-to-markdown, extract-text, extract-tables, split, create, info | 源 PDF / 文本文件路径 |
| `--inputs` | merge | 多个 PDF 文件路径（空格分隔，合并时按顺序） |
| `--output` | convert-to-markdown, extract-text, extract-tables, merge, create | 输出文件路径 |
| `--output-dir` | split | 输出目录 |
| `--pages` | extract-text, extract-tables | 页码范围，如 `1-3,5` |
| `--pages-per-file` | split | 每个输出文件的页数（默认 1） |

> Do NOT read the Python file, just call it with the parameters.

## Examples

### 情景 1：用户上传了一份 PDF 合同，想了解内容

```bash
# 先查看基本信息
python /mnt/skills/public/pdf-processing/scripts/generate.py info \
  --input /mnt/user-data/uploads/contract.pdf

# ⭐ 转为 Markdown（保留结构）
python /mnt/skills/public/pdf-processing/scripts/generate.py convert-to-markdown \
  --input /mnt/user-data/uploads/contract.pdf \
  --output /mnt/user-data/outputs/contract.md
```

然后用 `read_file` 工具读取 contract.md，向用户总结合同要点。
Markdown 格式保留了标题层级和表格，便于精确定位关键条款。

### 情景 2：用户上传了一份含表格的 PDF 报告

```bash
# 提取表格到 CSV
python /mnt/skills/public/pdf-processing/scripts/generate.py extract-tables \
  --input /mnt/user-data/uploads/report.pdf \
  --output /mnt/user-data/outputs/report-tables.csv
```

如果需要进一步分析表格数据，可以用 `data-analysis` 技能加载导出的 CSV。

### 情景 3：用户想合并多个 PDF

```bash
python /mnt/skills/public/pdf-processing/scripts/generate.py merge \
  --inputs /mnt/user-data/uploads/part1.pdf /mnt/user-data/uploads/part2.pdf \
  --output /mnt/user-data/outputs/merged.pdf
```

## Output Handling

- 提取的文本/表格保存到 `/mnt/user-data/outputs/`
- 使用 `present_files` 工具向用户展示结果文件
- 对于大文件，先展示内容摘要，再提供文件下载
- 合并/拆分结果直接提供下载链接

## Notes

- **推荐工作流**: PDF → `convert-to-markdown` → 用 `read_file` 分析 .md 文件。Markdown 保留文档结构，比纯文本提取高效得多
- 加密/受保护的 PDF 可能无法读取，此时提示用户
- 扫描版 PDF（图片）转换后内容可能极少，此时 `pymupdf4llm` 会自动回退。若内容仍不足，建议提示用户使用 OCR
- 表格提取依赖 pdfplumber，安装后重启服务生效
- Markdown 文本转 PDF 建议配合 `code-documentation` 等技能先生成内容
- `pymupdf4llm` 转换大型 PDF 可能需要几秒到几十秒，请耐心等待
