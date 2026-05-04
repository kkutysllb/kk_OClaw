---
name: xlsx-creator
description: Create and manipulate Excel (.xlsx) files — build workbooks from CSV/JSON data, add charts (bar/line/pie/scatter), apply cell formatting (fonts, colors, borders), and inspect workbook structure. Trigger when the user asks to create an Excel file, export data to Excel, add charts to a spreadsheet, or format a workbook.
---

# XLSX Creator Skill

## Overview

This skill creates and manipulates Excel workbooks using openpyxl:

| 操作 | Action | 说明 |
|------|--------|------|
| 创建工作簿 | `create` | 从 CSV 或 JSON 数据生成 .xlsx 文件（自动格式化表头） |
| 添加图表 | `add-chart` | 在工作表中插入柱状图/折线图/饼图/散点图 |
| 应用格式 | `format` | 按 JSON 配置设置字体、颜色、边框、对齐、冻结窗格 |
| 查看结构 | `info` | 查看工作表名、列名、数据行数 |

## Dependencies

```bash
pip install openpyxl
```

## Workflow

### Step 1: Understand the User's Need

| 用户说 | 对应操作 |
|--------|---------|
| "把这些数据导出成 Excel" | `create` |
| "给这个表格加个图表" | `add-chart` |
| "把表头加粗、加背景色" | `format` |
| "看看这个 Excel 里有哪些 sheet" | `info` |

### Step 2: Execute

Call the Python script with the appropriate subcommand.

## Commands

### create — 创建 Excel

```bash
# 从 CSV 创建
python /mnt/skills/public/xlsx-creator/scripts/generate.py create \
  --source /mnt/user-data/outputs/data.csv \
  --output /mnt/user-data/outputs/report.xlsx \
  --sheet-name "销售数据"

# 从 JSON 创建（数组形式）
python /mnt/skills/public/xlsx-creator/scripts/generate.py create \
  --source /mnt/user-data/outputs/data.json \
  --output /mnt/user-data/outputs/report.xlsx
```

**数据格式支持：**

CSV（第一行为表头）：
```csv
姓名,部门,销售额
张三,销售部,15000
李四,市场部,12000
```

JSON 数组（每个对象一行）：
```json
[
  {"姓名": "张三", "部门": "销售部", "销售额": 15000},
  {"姓名": "李四", "部门": "市场部", "销售额": 12000}
]
```

JSON 对象（headers + rows）：
```json
{
  "headers": ["姓名", "部门", "销售额"],
  "rows": [
    ["张三", "销售部", 15000],
    ["李四", "市场部", 12000]
  ]
}
```

### add-chart — 添加图表

```bash
# 柱状图
python /mnt/skills/public/xlsx-creator/scripts/generate.py add-chart \
  --workbook /mnt/user-data/outputs/report.xlsx \
  --sheet "销售数据" \
  --type bar \
  --data-start A1 \
  --data-end C3 \
  --categories-col 1 \
  --title "各部门销售额" \
  --x-axis "部门" \
  --y-axis "金额（元）"

# 饼图
python /mnt/skills/public/xlsx-creator/scripts/generate.py add-chart \
  --workbook /mnt/user-data/outputs/report.xlsx \
  --sheet "Sheet1" \
  --type pie \
  --data-start A1 \
  --data-end B5 \
  --title "市场份额分布"

# 折线图
python /mnt/skills/public/xlsx-creator/scripts/generate.py add-chart \
  --workbook /mnt/user-data/outputs/report.xlsx \
  --sheet "Sheet1" \
  --type line \
  --data-start A1 \
  --data-end D13
```

### format — 格式化

先创建一个 JSON 配置文件描述格式规则：

```json
{
  "cells": {
    "A1:C1": {
      "bold": true,
      "color": "FFFFFF",
      "fill": "4472C4",
      "align": "center"
    },
    "B2:C10": {
      "number_format": "#,##0.00"
    }
  },
  "auto_width": true,
  "freeze": "A2"
}
```

然后执行：
```bash
python /mnt/skills/public/xlsx-creator/scripts/generate.py format \
  --workbook /mnt/user-data/outputs/report.xlsx \
  --sheet "销售数据" \
  --config /mnt/user-data/workspace/format-config.json
```

### info — 查看结构

```bash
python /mnt/skills/public/xlsx-creator/scripts/generate.py info \
  --workbook /mnt/user-data/uploads/data.xlsx
```

## Parameters Reference

| 参数 | 适用操作 | 说明 |
|------|---------|------|
| `--source` | create | CSV 或 JSON 数据文件 |
| `--workbook` | add-chart, format, info | .xlsx 文件路径 |
| `--sheet` / `--sheet-name` | add-chart, format / create | 工作表名称 |
| `--type` | add-chart | 图表类型：`bar`, `line`, `pie`, `scatter` |
| `--data-start` | add-chart | 数据范围左上角（如 A1） |
| `--data-end` | add-chart | 数据范围右下角（如 D10） |
| `--categories-col` | add-chart | 分类标签列号（1-based，默认 1） |
| `--title` | add-chart | 图表标题 |
| `--x-axis` / `--y-axis` | add-chart | 坐标轴标签 |
| `--config` | format | JSON 格式配置文件 |
| `--output` | create, add-chart, format | 输出路径（add-chart/format 默认覆盖原文件） |

> Do NOT read the Python file, just call it with the parameters.

## Examples

### 情景 1：数据分析后导出 Excel

```bash
# 先用 data-analysis 查询数据并导出 CSV
python /mnt/skills/public/data-analysis/scripts/analyze.py \
  --files /mnt/user-data/uploads/sales.xlsx \
  --action query \
  --sql "SELECT department, SUM(amount) as total FROM Sales GROUP BY department" \
  --output-file /mnt/user-data/outputs/department-summary.csv

# 再转为格式化的 Excel
python /mnt/skills/public/xlsx-creator/scripts/generate.py create \
  --source /mnt/user-data/outputs/department-summary.csv \
  --output /mnt/user-data/outputs/department-report.xlsx \
  --sheet-name "部门汇总"
```

### 情景 2：创建带图表的报告

```bash
# 1. 生成数据
python /mnt/skills/public/xlsx-creator/scripts/generate.py create \
  --source /mnt/user-data/outputs/monthly-data.json \
  --output /mnt/user-data/outputs/report.xlsx

# 2. 添加柱状图
python /mnt/skills/public/xlsx-creator/scripts/generate.py add-chart \
  --workbook /mnt/user-data/outputs/report.xlsx \
  --sheet "Sheet1" \
  --type bar \
  --data-start A1 --data-end C13 \
  --title "月度销售趋势"

# 3. 格式化表头
python /mnt/skills/public/xlsx-creator/scripts/generate.py format \
  --workbook /mnt/user-data/outputs/report.xlsx \
  --sheet "Sheet1" \
  --config /mnt/user-data/workspace/header-style.json
```

### 情景 3：批量生成格式化 Excel

```bash
# 如果用户说"把结果做成一个漂亮的 Excel"
# 先用 data-analysis 导出 CSV，再用 xlsx-creator 创建并格式化

# Step 1: 导出数据
python /mnt/skills/public/data-analysis/scripts/analyze.py \
  --files /mnt/user-data/uploads/data.xlsx \
  --action query \
  --sql "SELECT * FROM Sheet1" \
  --output-file /mnt/user-data/outputs/export.csv

# Step 2: 创建 Excel
python /mnt/skills/public/xlsx-creator/scripts/generate.py create \
  --source /mnt/user-data/outputs/export.csv \
  --output /mnt/user-data/outputs/formatted-report.xlsx
```

> 创建 Excel 后，脚本会自动加粗表头并设置蓝色背景，无需额外调用 `format`。

## Output Handling

- 生成的 Excel 文件保存到 `/mnt/user-data/outputs/`
- 使用 `present_files` 工具向用户展示下载链接
- 如果添加了图表，告知用户图表在工作表中的位置

## Notes

- `create` 会自动将数字字符串转为数值类型
- `create` 默认会加粗表头、设置蓝色背景、自动列宽（可用 `--no-auto-width` `--no-header-style` 关闭）
- 图表数据范围必须包含表头行（标题行）以正确显示图例
- JSON 格式配置支持单元格范围（如 `A1:C10`）和单个单元格（如 `A1`）
- 配合 `data-analysis` 技能可实现「分析 → 导出 → 美化」的完整数据管道
