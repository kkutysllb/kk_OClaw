# Memory Retrieval Cache Design

## 背景

当前项目已经具备以下能力：

- 从近期用户/最终助手消息中提取 `current_context`
- 使用纯 Python TF-IDF 计算 `current_context` 与 `facts[]` 的相似度
- 按 `similarity` 与 `confidence` 的加权分数排序 facts
- 在 retrieval 关闭、上下文缺失或检索异常时回退到仅按 `confidence` 排序
- 通过 `MemoryMiddleware` 在运行时注入按上下文排序后的 facts

当前第二阶段的主要性能短板在于，每次模型调用前都会对整组 `facts[]` 重复执行以下工作：

- 文本规范化
- facts 分词
- 构造文档集合
- 计算 DF / IDF
- 构造 facts 的 TF-IDF 向量

在同一线程持续对话、而 memory facts 长时间不变的场景下，这些步骤会产生明显的重复计算。当前 `docs/MEMORY_IMPROVEMENTS.md` 也已明确：第一版尚未引入缓存。

## 目标

本次改造需要实现以下能力：

1. 为 retrieval 的 facts 侧预处理引入进程内缓存
2. 在 `facts[]` 不变时，复用：
   - 规范化事实文本
   - facts token 列表
   - DF / IDF 映射
   - facts TF-IDF 向量
3. 保持对外接口与当前调用方式兼容
4. 不改变现有排序公式、回退行为和 memory 注入格式
5. 为后续 tokenizer 增强保留扩展空间

## 非目标

本次改造不包含以下内容：

- 不引入磁盘缓存、跨进程缓存或外部缓存服务
- 不修改 memory 存储 schema
- 不修改 `facts[]` 的持久化格式
- 不同时做中文/技术词分词增强
- 不引入 BM25、embedding 检索或向量数据库

## 设计原则

- 缓存仅覆盖重复成本最高的 facts 侧预处理
- query / `current_context` 仍按次计算，保证行为直观且易于失效
- 缓存 key 必须由“参与检索的事实语料”稳定生成，避免误复用
- 对外接口保持不变，调用方无感知升级
- 失效规则尽量依赖“签名变化即失效”，避免手工清理逻辑

## 当前实现问题

当前 `rank_memory_facts()` 的工作流大致为：

1. 过滤有效 facts
2. 对 `current_context` 分词
3. 对每条 fact 文本分词
4. 用所有 facts token 和 query token 构造文档集合
5. 计算 DF / IDF
6. 构建 query 向量
7. 为每条 fact 构建 TF-IDF 向量
8. 逐条计算余弦相似度并排序

这里第 3、4、5、7 步在 facts 语料不变时理论上可以完全复用，但当前每次都会重新执行。

## 总体方案

采用“文档集签名缓存”的方式，为 facts 语料引入一层轻量预处理缓存。

设计要点：

- 对 facts 生成稳定签名 `facts_signature`
- 使用签名作为缓存 key
- 将 facts 侧预处理结果缓存为 `PreparedFactCorpus`
- query 侧仅复用缓存中的 `idf_map` 和 `fact_vectors`
- `rank_memory_facts()` 对外签名不变

## 缓存范围

本次缓存只覆盖 facts 侧，不缓存 query 侧结果。

### 缓存内容

缓存对象建议包含：

- `valid_facts`
- `fact_tokens`
- `idf_map`
- `fact_vectors`

可选附加字段：

- `document_count`
- `vocabulary_size`

### 不缓存内容

以下内容不进入缓存：

- `current_context`
- query tokens
- query TF-IDF 向量
- 最终排序结果

原因：

- `current_context` 每轮对话都可能变化
- 排序结果天然依赖 query，不适合做简单签名缓存
- 只缓存 facts 侧就已经能覆盖主要重复成本

## 签名设计

建议新增：

```python
def build_facts_signature(facts: list[dict[str, Any]]) -> tuple[tuple[str, float, str, str | None], ...]:
    ...
```

签名字段建议包含：

- `content`
- 归一化后的 `confidence`
- `category`
- `sourceError`

不建议纳入签名的字段：

- `id`
- `createdAt`
- `updatedAt`
- 其它与检索文本无关的元数据

原因：

- 这些字段变化未必影响 retrieval 结果
- 纳入过多字段会导致缓存频繁失效

## 数据结构

建议在 `retrieval.py` 内新增一个轻量数据结构，例如：

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class PreparedFactCorpus:
    valid_facts: tuple[dict[str, Any], ...]
    fact_tokens: tuple[tuple[str, ...], ...]
    idf_map: dict[str, float]
    fact_vectors: tuple[dict[str, float], ...]
```

这里使用不可变容器的原因是：

- 更适合作为缓存返回值
- 更容易保证缓存结果不被调用方原地修改

## 模块划分

建议继续在现有文件中实现，不新拆文件：

- `normalize_text()`：保留现有职责
- `tokenize_text()`：保留现有职责
- `build_facts_signature()`：新增，负责生成缓存 key
- `_prepare_fact_corpus_cached(...)`：新增，负责带缓存的 facts 预处理
- `rank_memory_facts()`：改为消费缓存结果

## 接口设计

建议保持当前对外接口不变：

```python
def rank_memory_facts(
    facts: list[dict[str, Any]],
    *,
    current_context: str | None,
    similarity_weight: float,
    confidence_weight: float,
    min_similarity: float = 0.0,
) -> list[dict[str, Any]]:
    ...
```

这样以下调用点都不需要改签名：

- `MemoryMiddleware`
- `lead_agent/prompt.py`
- 现有测试

## 内部实现建议

### 1. 事实过滤

保留当前对 facts 的有效性过滤逻辑，仅对有有效 `content` 的条目进入检索。

### 2. 构建签名

对 `valid_facts` 生成稳定签名。

### 3. 获取缓存结果

建议新增内部函数：

```python
@lru_cache(maxsize=64)
def _prepare_fact_corpus_cached(
    facts_signature: tuple[tuple[str, float, str, str | None], ...]
) -> PreparedFactCorpus:
    ...
```

实现要求：

- 使用签名作为唯一缓存 key
- 在函数内部根据签名还原 fact 文本用于分词和向量构建
- 返回完整的 `PreparedFactCorpus`

### 4. query 侧处理

每次调用 `rank_memory_facts()` 时：

- 仍然对 `current_context` 做分词
- 基于缓存中的 `idf_map` 生成 query 向量
- 使用缓存中的 `fact_vectors` 计算余弦相似度

### 5. 排序

排序公式与当前版本保持一致：

```text
final_score = (similarity * similarity_weight) + (confidence * confidence_weight)
```

保持当前 tie-break 语义不变。

## 失效规则

缓存不需要显式清理接口。

失效规则如下：

- `facts_signature` 不变：直接命中缓存
- `facts_signature` 变化：自动 miss，并重新构建

这意味着只要 facts 文本语料、confidence、category、sourceError 发生变化，对应缓存就会自然失效。

## 配置设计

第一版不新增用户可配置项。

原因：

- 这是 retrieval 内部优化
- 过早暴露 `cache_enabled`、`cache_maxsize` 这类配置会增加心智负担
- 当前最重要的是先验证缓存收益与行为稳定性

如后续确有必要，可在第三阶段再开放：

- `memory.retrieval.cache_enabled`
- `memory.retrieval.cache_maxsize`

## 测试设计

### 1. 行为兼容测试

保留并继续通过当前测试：

- 有 `current_context` 时按相似度与置信度排序
- 无 `current_context` 时回退到 confidence-only 排序

### 2. 缓存命中测试

新增测试，验证：

- 相同 facts 连续调用两次时，facts 预处理只执行一次
- query 改变但 facts 不变时，facts 预处理仍只执行一次

### 3. 缓存失效测试

新增测试，验证：

- 只要 facts 内容改变，缓存就会重新构建
- confidence 或 category 改变时，缓存也应失效

### 4. 稳定性测试

新增测试，验证：

- 空 facts 输入不抛异常
- 空 query 输入仍回退到 confidence-only 排序
- 缓存不改变当前排序结果

## 性能预期

在 facts 不变而 query 高频变化的场景下，预期收益主要来自：

- 避免重复对整组 facts 分词
- 避免重复计算 DF / IDF
- 避免重复构建 facts 向量

第一版不要求在代码中加入 benchmark，但建议后续在本地用真实 facts 规模做一次简单压测，以确认收益是否明显。

## 风险与缓解

### 风险 1：缓存 key 设计不正确导致误命中

缓解：

- 使用稳定且与排序相关的字段构建签名
- 添加 facts 变化触发缓存失效的测试

### 风险 2：缓存返回值被调用方修改

缓解：

- 使用不可变容器保存缓存结果
- 在对外返回排序结果时重新组装 list，而不是暴露缓存内部可变状态

### 风险 3：缓存收益不足

缓解：

- 保持实现轻量，不额外引入复杂基础设施
- 若后续数据规模仍小，最多只是一次低风险的内部优化

## 未来演进

本设计为后续优化保留了清晰扩展点：

- tokenizer 增强后仍可复用同一缓存结构
- 可演进为 `PreparedFactCorpus` 显式索引对象
- 后续可加入 corpus 级命中统计和调试日志
- 如果 facts 规模继续增长，可再评估更复杂的索引层或 BM25

## 最终结论

本次第二阶段建议采用“文档集签名缓存”方案：

- 不改外部接口
- 只缓存 facts 侧预处理
- query 侧继续按次计算
- 以 facts 语料签名作为自然失效机制
- 通过缓存命中/失效测试确保行为正确

这条路径能在保持当前 retrieval 语义稳定的前提下，显著减少重复计算，并为后续 tokenizer 增强留下合适接口。
