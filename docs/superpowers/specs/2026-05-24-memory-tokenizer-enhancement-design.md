# Memory Tokenizer Enhancement Design

## 背景

当前项目已经完成以下 retrieval 能力：

- 从近期用户/最终助手消息中提取 `current_context`
- 使用纯 Python TF-IDF 计算 `current_context` 与 `facts[]` 的相关性
- 按 `similarity` 与 `confidence` 的加权分数排序 facts
- 引入 facts 侧文档集签名缓存，复用分词、IDF 和 facts 向量预处理

当前 `tokenize_text()` 的实现仍然较为轻量：

- 英文 / 数字 / 技术字符通过单条正则提取为整段 token
- 中文按连续汉字段整体保留
- 未显式处理：
  - 中文短语的局部子串匹配
  - 驼峰技术词拆分
  - 连字符 / 下划线 / 路径型技术词的多视角展开
  - 模型名、版本号、API 路径、包名等技术语料

这会导致两个明显问题：

1. 中文查询与事实之间若只共享局部短语，匹配能力不足
2. 技术词若查询写法和 fact 写法不完全一致，召回和排序可能偏弱

本次设计目标是增强 `tokenize_text()`，让 retrieval 更适合技术对话场景，同时保持“无额外依赖”和“与现有缓存兼容”。

## 目标

本次改造需要实现以下能力：

1. 增强 `tokenize_text()` 对中文短语的局部匹配能力
2. 增强对技术词、驼峰词、连字符词、模型名、版本号和路径片段的切分能力
3. 保持 `rank_memory_facts()` 的外部接口不变
4. 不引入第三方中文分词依赖
5. 控制 token 数量，避免分词增强导致 token 爆炸

## 非目标

本次改造不包含以下内容：

- 不引入 `jieba` 等中文分词库
- 不修改 TF-IDF 公式
- 不修改 retrieval 缓存架构
- 不引入 BM25、embedding 或向量数据库
- 不修改 memory 存储 schema

## 设计原则

- 面向技术检索，而不是通用 NLP
- 保留原词，同时补充可提高召回率的展开词
- 规则必须可解释、可测试、可控
- 去重且尽量保持 token 顺序稳定
- 与现有 facts 侧缓存兼容，不改变缓存边界

## 当前实现问题

当前 `tokenize_text()` 大致为：

```python
def tokenize_text(text: str) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []
    return _TOKEN_RE.findall(normalized)
```

当前正则对以下场景不够友好：

- 中文：`上下文感知排序` 只能得到整体 token，无法匹配查询中的 `感知`、`排序`
- 驼峰：`DeepSeekCoder` 只能得到整体 token，无法拆出 `deepseek`、`coder`
- 连字符：`langgraph-sdk` 不能自然得到 `langgraph`、`sdk`
- 模型名：`gpt-4o-mini` 不能同时兼顾完整词与局部词
- 路径：`/api/v1/chat/completions` 缺少结构化拆分

## 总体方案

采用“纯规则增强”的 tokenizer 方案：

- 保留现有 `normalize_text()` 和主正则提取思路
- 对主正则匹配出的每个片段做二次展开
- 使用“原词 + 展开词”并存的策略提升召回率
- 在输出阶段统一去重，保持顺序稳定

## 模块划分

建议继续在 `retrieval.py` 内实现，不新拆文件。

建议新增以下内部辅助函数：

```python
def _is_chinese_token(token: str) -> bool:
    ...

def _generate_chinese_ngrams(token: str) -> list[str]:
    ...

def _split_camel_case_token(token: str) -> list[str]:
    ...

def _split_technical_token(token: str) -> list[str]:
    ...

def _dedupe_preserve_order(tokens: list[str]) -> list[str]:
    ...
```

`tokenize_text()` 仍作为对外入口，不改签名。

## 分词策略

### 1. 基础片段提取

保留当前主正则，先提取基础 token 片段：

- 英文 / 数字 / 技术字符片段
- 连续中文片段

这一步的作用是维持现有行为兼容性，后续增强只在片段层面做扩展。

### 2. 中文片段增强

对连续中文片段：

- 始终保留原 token
- 当长度 `>= 2` 时补充中文 n-gram

建议规则：

- 只生成 `2-gram` 和 `3-gram`
- 不生成 `1-gram`
- 对长度很短的片段不做额外扩展

示例：

`上下文感知排序`

输出包含：

- `上下文感知排序`
- `上下`
- `下文`
- `文感`
- `感知`
- `知排`
- `排序`
- `上下文`
- `下文感`
- `文感知`
- `感知排`
- `知排序`

这样可以支持：

- 查询更长、fact 更短
- 查询更短、fact 更长
- 中文局部短语的交叉命中

### 3. 技术词原词保留

对于技术词，始终保留完整原词。

示例：

- `langgraph-sdk`
- `gpt-4o-mini`
- `qwen3-coder`
- `/api/v1/chat`

保留原词的原因是：

- 很多技术词本身就是高价值完整实体
- 查询常常直接使用完整模型名、包名或路径

### 4. 技术词分隔符拆分

对包含以下分隔符的技术词进行二次拆分：

- `-`
- `_`
- `.`
- `/`
- `:`
- `+`

拆分后：

- 保留长度足够的子词
- 过滤过短噪音子词

示例：

`langgraph-sdk/v1`

输出包含：

- `langgraph-sdk/v1`
- `langgraph`
- `sdk`
- `v1`

### 5. 驼峰拆分

对英文字母类 token 进行驼峰切分：

- `DeepSeekCoder` -> `deepseekcoder`、`deepseek`、`coder`
- `MemoryRetrievalCache` -> `memoryretrievalcache`、`memory`、`retrieval`、`cache`

规则要求：

- 保留原 token
- 补充驼峰拆分结果
- 不对过短子词做保留

### 6. 字母数字混合词

对模型名、版本号等常见技术 token 做轻量边界拆分：

- `qwen3coder` 可补出 `qwen3`、`coder`
- `claude4sonnet` 可补出 `claude4`、`sonnet`

第一版不需要做复杂模式识别，只需在英文/数字边界上补一些高价值子词。

### 7. 路径和 API 片段

对于路径 / API / URL 风格 token：

- 保留完整原词
- 按分隔符提取结构化片段
- 过滤无意义的极短片段

示例：

`/api/v1/chat/completions`

输出可包含：

- `/api/v1/chat/completions`
- `api`
- `v1`
- `chat`
- `completions`

## 去重与裁剪

需要在最终输出阶段统一去重。

建议规则：

- 保持先出现的 token 顺序
- 相同 token 只保留一次
- 英文子词最小长度建议为 `2`
- 中文只生成 `2-gram` 和 `3-gram`
- 如果一个 token 扩展后过多，仍然以轻量为优先，不增加更复杂切分

## 接口设计

保持外部接口不变：

```python
def tokenize_text(text: str) -> list[str]:
    ...
```

保持以下调用方完全无感知：

- `rank_memory_facts()`
- `_prepare_fact_corpus()`
- `_prepare_fact_corpus_cached()`
- 现有 middleware 调用链

## 与缓存的关系

本次增强不会改变缓存架构。

原因：

- facts 侧缓存建立在 `content` 签名之上
- tokenizer 增强只改变“如何从同一文本生成 token”
- 只要 facts 内容没变，缓存边界仍成立

实现层面需要注意：

- tokenizer 行为变化后，缓存命中后的结果会自然变为“新 tokenizer 下的结果”
- 不需要单独引入 tokenizer 版本号到 cache key
- 因为缓存仅存在于当前进程生命周期内

## 测试设计

### 1. 中文局部匹配测试

新增测试验证：

- 中文短语整体 + 局部短语能共同工作
- query 与 fact 只共享局部中文短语时，仍能提升相关 fact 排名

### 2. 技术词拆分测试

新增测试验证：

- `langgraph-sdk` 能匹配 `langgraph`
- `gpt-4o-mini` 能匹配 `gpt`、`mini`
- `DeepSeekCoder` 能匹配 `deepseek` 或 `coder`

### 3. 路径/API 片段测试

新增测试验证：

- `/api/v1/chat/completions` 能被 `chat`、`completions` 类查询命中

### 4. 去重与稳定性测试

新增测试验证：

- `tokenize_text()` 不输出重复 token
- 相同输入多次调用输出顺序一致
- 增强后的 tokenizer 不破坏现有 retrieval 测试

## 风险与缓解

### 风险 1：token 数量膨胀

缓解：

- 中文只做 2-gram / 3-gram
- 英文子词设置最小长度限制
- 不做过深层的递归拆分

### 风险 2：噪音召回增多

缓解：

- 保留原词优先，不依赖子词单独支撑排序
- 子词长度做约束
- 通过排序测试验证“更相关的 fact 是否排前”

### 风险 3：技术词拆分过度

缓解：

- 先做轻量规则，不做复杂词典
- 优先支持驼峰、连字符、路径型场景
- 若某类 token 拆分噪音明显，再定向收敛规则

## 未来演进

本设计为后续优化保留扩展空间：

- 后续可加入自定义技术词表
- 后续可引入可选的中文分词依赖作为增强模式
- 后续可将 tokenizer 逻辑拆成独立模块，但本期不需要

## 最终结论

本次建议采用“纯规则增强”的 tokenizer 方案：

- 保留原词
- 对中文补充 2/3-gram
- 对技术词补充分隔符拆分和驼峰拆分
- 控制 token 数量与噪音
- 保持无外部依赖和当前缓存架构兼容

这条路径能在不扩大系统复杂度的前提下，提高 retrieval 对中文短语和技术语料的匹配能力，最适合作为当前阶段的下一步优化。
