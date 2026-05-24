# Memory Context-Aware Retrieval Design

## 背景

当前项目的记忆注入路径已经支持：

- 使用 `tiktoken` 进行较准确的 token 计数
- 将 `user.*`、`history.*` 和 `facts[]` 注入系统提示词
- 对 `facts[]` 按 `confidence` 降序排序
- 在 `max_injection_tokens` 预算内尽可能追加 facts

当前缺口在于，facts 注入仍然只按置信度排序，无法根据本轮对话的真实需求动态挑选最相关的事实。`docs/MEMORY_IMPROVEMENTS.md` 中已经将以下能力标记为“已计划 / 尚未合并”：

- 基于 TF-IDF 相似度的事实检索
- 用于上下文感知评分的 `current_context`
- 可配置的 `similarity_weight` / `confidence_weight`
- 每次模型调用前进行上下文感知检索的运行时集成

本设计的目标是补齐这条能力链，同时保持当前 memory 存储结构、现有注入格式和 token 预算行为尽量不变。

## 目标

本次改造需要实现以下能力：

1. 在构建 lead agent 系统提示词时提取当前轮次可见的近期上下文，生成 `current_context`
2. 使用 TF-IDF 计算 `current_context` 与各 memory facts 的语义相关性
3. 按 `similarity` 与 `confidence` 加权后的分数排序 facts
4. 在没有 `current_context` 或检索异常时，回退为现有的 `confidence` 排序
5. 保持原有 `User Context`、`History`、`Facts` 三段输出结构和 token budget 语义

## 非目标

本次改造不包含以下内容：

- 不修改 memory 的持久化 schema
- 不修改 memory 提取、更新和写盘流程
- 不引入向量数据库、embedding 检索或外部搜索服务
- 不修改 summarization 行为
- 不将 `user.*` 和 `history.*` 纳入候选检索对象

## 设计原则

- 最小化对现有行为的破坏：默认配置缺失时，系统仍按当前逻辑工作
- 职责分层：检索与评分逻辑从渲染逻辑中拆出
- 可回退：任意异常或上下文缺失时，回退到现有 confidence-only 排序
- 可测试：对 current_context 提取、TF-IDF 排序、token budget 进行分层测试
- 轻依赖：第一版使用纯 Python 实现，不新增重量级依赖

## 当前调用链

当前 memory 注入调用链如下：

1. lead agent 构建提示词
2. 加载 memory 配置
3. 读取 memory 数据
4. 调用 `format_memory_for_injection(memory_data, max_tokens=...)`
5. 将格式化结果包裹在 `<memory>` 标签中注入系统提示词

现状问题是 `format_memory_for_injection()` 同时承担了：

- `User Context` / `History` / `Facts` 的渲染
- `Facts` 的排序
- token budget 裁剪

如果继续在该函数中直接堆叠 TF-IDF、上下文提取和加权排序，会让渲染层承担过多职责。因此本设计建议新增 retrieval 层，对检索和渲染做边界拆分。

## 总体方案

采用“检索与渲染分层”的实现方式：

- `lead_agent/prompt.py` 负责在注入 memory 前提取当前运行态的 `current_context`
- `agents/memory/retrieval.py` 负责：
  - 归一化文本
  - 构建 TF-IDF 表示
  - 计算余弦相似度
  - 按配置加权并排序 facts
- `agents/memory/prompt.py` 保留为渲染层，继续负责：
  - 渲染 `User Context`
  - 渲染 `History`
  - 在 token 预算内追加“已经排序好的 facts”

## 模块划分

### 1. Current Context 提取层

建议新增轻量函数，例如：

```python
def extract_current_context(messages: list[Any], *, max_turns: int, max_chars: int) -> str | None:
    ...
```

职责：

- 从当前轮次可见消息中提取近期上下文
- 尽量复用现有 message filtering 规则，避免工具调用、上传占位、噪音内容进入检索 query
- 输出纯文本字符串，供 TF-IDF 评分使用

提取策略建议：

- 使用最近 `3-6` 个“用户输入 + 最终助手回复”轮次
- 忽略带 `tool_calls` 的 AI 消息
- 剔除 `<uploaded_files>...</uploaded_files>` 标签块
- 对最终拼接结果施加 `max_chars` 限制

如果提取结果为空字符串，则返回 `None`

### 2. Fact Retrieval / Ranking 层

建议新增模块：

`backend/packages/harness/kkoclaw/agents/memory/retrieval.py`

建议包含以下函数：

```python
def normalize_text(text: str) -> str:
    ...

def tokenize_text(text: str) -> list[str]:
    ...

def build_tfidf_vectors(documents: list[str]) -> list[dict[str, float]]:
    ...

def cosine_similarity(vec_a: dict[str, float], vec_b: dict[str, float]) -> float:
    ...

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

职责划分如下：

- `normalize_text`：统一大小写、空白和基础符号
- `tokenize_text`：对中英文及技术 token 做轻量切词
- `build_tfidf_vectors`：根据 facts 和 query 构建稀疏 TF-IDF 向量
- `cosine_similarity`：计算 query 与 fact 的余弦相似度
- `rank_memory_facts`：计算最终分数并输出排序结果

### 3. Memory Prompt Rendering 层

`format_memory_for_injection()` 保持为渲染入口，但接口需略作扩展。

建议从：

```python
def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
```

调整为：

```python
def format_memory_for_injection(
    memory_data: dict[str, Any],
    max_tokens: int = 2000,
    ranked_facts: list[dict[str, Any]] | None = None,
) -> str:
```

行为约束：

- 若 `ranked_facts` 传入，则优先使用它渲染 `Facts`
- 若未传入，则沿用当前内部的 confidence-only 排序逻辑
- 保持 `Facts:` 标题、行格式、budget 裁剪逻辑不变

## 运行时数据流

完整数据流如下：

1. lead agent 开始构建系统提示词
2. 读取 memory 配置与 memory 数据
3. 从当前可见消息中提取 `current_context`
4. 如果上下文感知检索启用：
   - 调用 `rank_memory_facts(...)`
   - 得到已排序 facts
5. 将排序后的 facts 传给 `format_memory_for_injection(...)`
6. 在 token 预算内构造 memory 注入文本
7. 将结果包裹进 `<memory>...</memory>` 注入系统提示词

回退路径：

- 若检索配置未启用，直接按旧逻辑渲染
- 若 `current_context` 不存在，按 confidence 排序
- 若检索层异常，记录日志并回退到 confidence-only 排序

## 评分模型

### similarity

- 由 `current_context` 与单条 fact 的 TF-IDF 余弦相似度得到
- 数值范围归一化为 `[0.0, 1.0]`
- 若 fact 文本为空、无有效词项、或 query 无法构造，则记为 `0.0`

### confidence

- 直接复用现有 confidence 字段
- 使用现有 `_coerce_confidence()` 做清洗与边界处理

### final_score

第一版采用文档中已给出的公式：

```text
final_score = (similarity * similarity_weight) + (confidence * confidence_weight)
```

默认参数建议：

- `similarity_weight = 0.6`
- `confidence_weight = 0.4`

若两者和不为 `1.0`，运行时自动归一化，而不是报错。

### tie-break 规则

当多个 facts 的 `final_score` 相同时，按以下优先级排序：

1. `final_score` 降序
2. `confidence` 降序
3. 原始输入顺序

这样可以减少输出抖动，避免在分数接近时排序结果频繁变化。

## TF-IDF 细节

### 文档集合

- 候选文档：所有可注入 fact 的 `content`
- 查询文本：`current_context`

### 分词策略

第一版不引入外部分词依赖，采用轻量 tokenizer：

- 英文：按单词边界切词
- 中文：保留连续中文片段
- 技术标识：尽量保留形如 `LangGraph`、`DeepSeek`、`Qwen3-Coder`、`PostgreSQL`、`gpt-4o-mini` 的 token

切词目标不是做完美中文 NLP，而是保证技术对话场景下的可用性和稳定性。

### TF / IDF

- `TF`：第一版使用原始词频
- `IDF`：使用平滑公式避免除零

```text
idf = log((1 + N) / (1 + df)) + 1
```

### 向量结构

使用稀疏 `dict[str, float]` 即可，不依赖 `numpy`

## 配置设计

建议在现有 `memory:` 配置下新增子块：

```yaml
memory:
  enabled: true
  injection_enabled: true
  max_injection_tokens: 2000
  retrieval:
    enabled: true
    strategy: tfidf
    context_max_turns: 4
    context_max_chars: 4000
    similarity_weight: 0.6
    confidence_weight: 0.4
    min_similarity: 0.0
```

字段说明：

- `retrieval.enabled`：是否开启上下文感知检索
- `strategy`：第一版仅支持 `tfidf`
- `context_max_turns`：用于生成 query 的最近轮次数
- `context_max_chars`：query 文本最大字符数
- `similarity_weight`：相似度权重
- `confidence_weight`：置信度权重
- `min_similarity`：相似度下界，可用于未来筛除明显不相关事实

兼容策略：

- 若 `retrieval` 块不存在，则默认 `enabled = false`
- 旧配置文件无需修改也能继续运行

## 配置模型变更

建议在 memory 配置模型中新增：

```python
class MemoryRetrievalConfig(BaseModel):
    enabled: bool = False
    strategy: Literal["tfidf"] = "tfidf"
    context_max_turns: int = 4
    context_max_chars: int = 4000
    similarity_weight: float = 0.6
    confidence_weight: float = 0.4
    min_similarity: float = 0.0
```

并挂载到现有 `MemoryConfig`：

```python
retrieval: MemoryRetrievalConfig = Field(default_factory=MemoryRetrievalConfig)
```

## 错误处理

需要明确以下回退规则：

- `memory_data` 为空：返回空字符串
- `facts` 为空：继续仅注入 `User Context` / `History`
- `current_context` 为空：跳过 TF-IDF，按 confidence-only 排序
- `similarity_weight` / `confidence_weight` 非法：运行时归一化或回退默认值
- TF-IDF 计算异常：记录日志并回退 confidence-only
- token 预算不足：沿用当前追加式裁剪逻辑

## 性能考虑

本设计第一版不引入预计算和缓存，原因如下：

- 默认 `max_facts` 规模是百级，纯 Python TF-IDF 足以支撑
- 当前 memory 注入发生在提示词构造阶段，规模较小，可接受一次性计算成本
- 先保证行为正确与接口清晰，再根据真实数据量决定是否引入缓存

后续若 facts 数量显著增长，可在 retrieval 层增加：

- 规范化文本缓存
- tokenized result 缓存
- 基于 memory 文件更新时间的 TF-IDF 预计算缓存

## 测试设计

### 1. Retrieval 层单测

新增测试文件建议：

`backend/tests/test_memory_retrieval.py`

覆盖以下场景：

- `current_context` 与某条 fact 高相关时，该 fact 排在前面
- 无 `current_context` 时回退为按 confidence 排序
- 高 confidence 但低相关事实，不应总是压过中高 confidence 且强相关事实
- 中英文混合和技术词场景下，排序结果基本符合预期
- 非法权重值或空文本输入时，不抛异常并能稳定回退

### 2. Prompt 注入单测

扩展现有：

`backend/tests/test_memory_prompt_injection.py`

新增覆盖：

- `ranked_facts` 传入后，渲染顺序按外部排序结果输出
- 旧接口调用方式仍能工作
- token budget 仍然正确裁剪 facts
- correction facts 的 `sourceError` 渲染不受影响

### 3. Lead Agent 集成单测

建议新增或扩展测试，验证：

- `lead_agent/prompt.py` 能在启用 retrieval 时正确传入 `current_context`
- retrieval 禁用时不改变现有行为
- retrieval 抛异常时 prompt 构造仍成功，只是回退到旧逻辑

## 代码改造顺序

建议按以下顺序实施：

1. 新增 memory retrieval 配置模型及加载逻辑
2. 新增 `agents/memory/retrieval.py`
3. 为 `format_memory_for_injection()` 增加 `ranked_facts` 参数，保持向后兼容
4. 在 lead agent prompt 构造中提取 `current_context` 并调用 retrieval 层
5. 补测试
6. 更新 `docs/MEMORY_IMPROVEMENTS.md` 与示例配置

## 风险与缓解

### 风险 1：中文和技术术语切词效果不稳定

缓解：

- 第一版只追求“足够好”而非 NLP 最优
- 为技术词和中英文混合补测试用例
- tokenizer 设计为独立函数，后续可替换

### 风险 2：检索行为影响已有 prompt 稳定性

缓解：

- 保持 `User Context` / `History` 不参与检索，只对 facts 做排序
- 无上下文或异常时严格回退到旧逻辑
- 使用特性开关控制启用

### 风险 3：`format_memory_for_injection()` 职责继续膨胀

缓解：

- 将排序逻辑全部放到 retrieval 层
- prompt 层只负责组装输入和调用
- rendering 层只负责渲染与 budget 控制

## 未来演进

本设计为后续能力演进预留了接口：

- `strategy` 可从 `tfidf` 扩展到 `bm25` 或 embedding
- retrieval 层可增加缓存
- 未来可引入“事实类别权重”或“近期使用衰减因子”
- 如后续验证有效，可考虑把 `topOfMind` 也做轻量上下文感知增强，但不建议在本期纳入

## 最终结论

本次推荐采用“检索与渲染分层”的实现方式：

- 新增 `current_context` 提取
- 新增纯 Python TF-IDF retrieval 层
- 在运行时按 `similarity * 0.6 + confidence * 0.4` 排序 facts
- 保持原有 memory schema 和渲染格式不变
- 无上下文或异常时回退到当前 confidence-only 行为

这条路径能在控制改动面的前提下，补齐 `MEMORY_IMPROVEMENTS.md` 中计划但尚未合并的核心能力，并为后续检索优化留下清晰扩展点。
