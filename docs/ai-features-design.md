# NexSQL AI 能力设计文档

## 1. 文档目的

本文档用于沉淀 NexSQL 新增 AI 能力的设计与实现说明，覆盖以下三类功能：

- 智能 SQL 优化与诊断
- AI 辅助数据库设计与文档生成
- 自动构建数据库语义索引
- E-R 关系画布与 AI 自动关系建模

文档面向开发、测试与后续迭代，重点说明架构分层、接口约定、关键流程、风险与后续演进方向。

## 2. 设计目标

### 2.1 智能 SQL 优化与诊断

- 用户可在编辑器中选中 SQL，点击 AI 优化触发诊断。
- 系统先执行 EXPLAIN（只读计划，不执行 ANALYZE），再结合 schema 上下文交给 AI 输出建议。
- 输出内容应可直接帮助开发者落地优化，包括索引建议、写法改造建议、风险说明。

### 2.2 AI 辅助数据库设计与文档生成

- 设计场景：输入业务描述，生成可执行建表 SQL。
- 文档场景：根据表结构、字段和索引信息生成 Markdown 数据字典。
- 文档支持应用内预览与复制，便于同步到外部知识库。

### 2.3 自动语义索引

- 连接成功后自动后台构建语义索引。
- 首版索引数据源仅包含 schema/DDL 与表列注释。
- 支持在 AI 工作台查看索引状态并手动重建，为后续语义召回和上下文裁剪打基础。
- 语义索引会参与 AI 请求上下文拼装，对 SQL 生成、优化和设计任务提供补充语义摘要。
- 语义索引已从 settings JSON 迁移为内部 SQLite 表存储，支持增量更新与旧数据迁移。

### 2.4 E-R 关系画布与 AI 自动关系建模

- 提供数据库结构可视化画布，展示表与字段（支持缩放、拖拽、搜索定位）。
- 用户可主动连线表字段，显式表达主外键、1:1、1:N、N:M 等关系语义。
- 支持关系标签与注释（例如业务含义、约束说明、是否软约束）。
- 支持 AI 自动分析并建议连线，用户可逐条确认后落库。
- 关系结果可反向参与 AI 上下文，提升 SQL 生成、优化与文档生成的准确性。

## 3. 架构概览

### 3.0 交互形态

- 查询区保留 NL2SQL 与 SQL 优化按钮。
- 编辑器顶部保留语句感知条，展示当前 SQL 识别到的表、别名与语义索引命中情况。
- 设计与文档功能迁移到独立 AI 工作台视图（Sidebar 的 AI 标签）。
- 语义索引在 AI 工作台中提供状态列表、刷新和重建操作。
- 语义索引在 AI 工作台中支持查看索引摘要详情和手工维护人工备注。
- AI 工作台增加 E-R 关系画布页签，可查看结构图、手工连线、AI 自动补线和差异确认。
- AI store 增加执行日志能力，用户可在工作台看到任务步骤与结果。

### 3.1 分层

- Shared Types：定义跨进程请求/响应协议。
- Main Process：执行数据库操作、组装上下文、调用 AI Provider。
- Preload：向渲染进程暴露类型安全 API。
- Renderer：触发动作、展示结果、管理前端状态。

### 3.2 AI Provider 结构

- Provider 实现：OpenAIProvider 与 OllamaProvider。
- 能力接口：
  - generateSQL
  - optimizeSQL
  - generateDesignSQL
  - generateSchemaDoc
  - inferSchemaRelations

通过统一接口保持上层调用一致，减少业务层分支逻辑。

## 4. 关键数据结构

新增于 shared AI 类型中的核心结构：

- SQLOptimizeRequest / SQLOptimizeResponse
- AIDesignRequest / AIDesignResponse
- AIDocRequest / AIDocResponse
- SemanticIndexBuildRequest / SemanticIndexBuildResponse
- SemanticIndexItem
- ERGraphLoadRequest / ERGraphLoadResponse
- ERGraphSaveRequest / ERGraphSaveResponse
- ERGraphInferRequest / ERGraphInferResponse
- ERGraphNode / ERGraphEdge

这些结构用于约束主进程与渲染进程之间的 IPC 输入输出，避免隐式字段和协议漂移。

内部持久化结构：

- semantic_index_items
  - connection_id
  - database_name
  - table_name
  - schema_hash
  - summary_text
  - manual_notes
  - status
  - error_message
  - updated_at

- er_diagram_nodes
  - connection_id
  - database_name
  - table_name
  - x
  - y
  - collapsed
  - updated_at

- er_diagram_edges
  - connection_id
  - database_name
  - source_table
  - source_column
  - target_table
  - target_column
  - relation_type（1:1 / 1:N / N:M / unknown）
  - confidence（0~1，AI 推断置信度）
  - source_type（manual / inferred / metadata）
  - note
  - status（confirmed / pending / rejected）
  - updated_at

## 5. 核心流程设计

### 5.1 SQL 优化诊断流程

1. 用户在编辑器点击 AI 优化。
2. 前端取编辑器选区 SQL，若无选区则使用当前 SQL。
3. 通过 ai:optimizeSQL 发送请求。
4. 主进程根据连接类型构造 EXPLAIN 语句。
5. 调用数据库执行计划查询并生成计划摘要。
6. 读取 schema 上下文，并按当前 SQL 命中语义索引条目，拼装增强上下文。
7. 调用对应 AI Provider 的 optimizeSQL。
8. 返回结构化诊断结果给前端，并附带命中的语义索引项。
9. 在结果面板消息区展示建议、EXPLAIN 信息与语义索引命中。
10. 同步记录任务日志，执行中可见步骤提示。

### 5.2 AI 数据库设计流程

1. 用户在 AI 输入区输入需求并点击设计。
2. 前端调用 ai:generateDesignSQL。
3. 主进程按配置决定是否注入当前库 schema。
4. AI 返回设计说明与建表 SQL。
5. 前端回填 SQL 到编辑器。

### 5.3 文档生成流程

1. 用户点击生成文档。
2. 前端根据当前 SQL 解析涉及表，组装目标表列表。
3. 调用 ai:generateSchemaDoc。
4. 主进程读取每个目标表的列、索引、DDL 作为上下文。
5. AI 生成 Markdown 数据字典。
6. 前端在结果区展示并支持一键复制。

### 5.4 语义索引构建流程

1. 数据库连接成功后，前端后台调用 ai:buildSemanticIndex。
2. 主进程遍历数据库表，采集列信息、索引信息与 DDL。
3. 构建 summaryText，其中包含列语义摘要、关系提示和 indexed columns 等结构信息。
4. 计算 schemaHash，与既有条目比较；未变化且状态正常的条目直接跳过。
5. 将新增或变更条目写入 semantic_index_items，并清理全量重建时的陈旧条目。
6. 用户可在 AI 工作台查看索引详情，并通过 manual_notes 手工补充业务语义、真实关系和特殊约定。
7. AI 请求到达时，按表名/关键词从索引中召回相关摘要，并将人工备注一并拼装到上下文。
8. 支持 ai:getSemanticIndexStatus 查询状态。

### 5.5 E-R 关系画布流程

#### 5.5.1 手工建模流程

1. 用户打开 E-R 关系画布。
2. 前端调用 ai:getERGraph，读取当前数据库的表与字段元数据，并加载既有节点布局与关系线。
3. 用户拖拽布局、选择字段并连线，指定关系类型（1:1、1:N、N:M 或自定义标签）。
4. 前端调用 ai:saveERGraph 增量保存节点位置与关系边。
5. 保存成功后更新画布与关系侧栏，状态标记为 confirmed（人工确认）。

#### 5.5.2 AI 自动补线流程

1. 用户点击“AI 自动分析关系”。
2. 主进程收集 schema 元数据、真实外键（若可取）、索引信息、命名模式与语义索引摘要。
3. 调用 inferSchemaRelations，返回候选关系边（含 relationType、reason、confidence）。
4. 前端将候选关系以 pending 状态渲染（虚线/高亮），并展示逐条确认面板。
5. 用户可执行“全部接受 / 全部拒绝 / 按条确认”。
6. 仅已确认关系写入 er_diagram_edges，并作为高优先级关系上下文参与后续 AI 请求。

## 6. 方言与安全策略

### 6.1 EXPLAIN 策略

- MySQL：EXPLAIN + 原 SQL
- PostgreSQL：EXPLAIN (FORMAT JSON) + 原 SQL
- SQLite：EXPLAIN QUERY PLAN + 原 SQL
- 统一默认：只读计划，不执行 ANALYZE

### 6.2 安全策略

- 遵循全局 AI Provider 配置。
- 优化诊断阶段不执行会引入副作用的语句变体。
- 语义索引首版仅使用结构元数据，不引入历史查询和外部文档。
- E-R AI 自动补线仅基于元数据与可配置语义上下文，不读取业务行数据。
- AI 推断关系默认不直接覆盖人工关系，必须经过用户确认。

## 7. 当前实现落地清单

已落地能力：

- SQL 优化诊断主链路（前后端打通）
- AI 工作台独立视图（设计、文档、语义索引、执行日志）
- AI 设计 SQL 生成入口与回填（在工作台执行）
- 表文档生成与 Markdown 展示复制（在工作台执行）
- 连接后自动语义索引构建 + 工作台手动重建与状态查看
- 语义索引已接入 AI 上下文增强，优化结果可展示索引命中
- 语义索引已迁移到内部 SQLite 表，并支持增量更新、旧数据迁移和关系摘要
- 语义索引结果已可展示详情，并支持手工维护人工备注供 AI 使用
- 编辑器语句感知条已恢复，显示表识别、别名和语义索引覆盖
- 编辑器感知区会直接显示命中的索引项和人工备注状态
- 新增 IPC API 与全局类型补齐
- TypeScript 编译检查通过

## 8. 已知限制

- 文档生成入口首版在 AI 工作台按数据库选择表，不是 SchemaTree 多选。
- 语义索引首版为摘要索引，不包含向量检索能力。
- 语义索引暂未提供统计图（覆盖率趋势、耗时曲线）。
- 当前关系摘要为启发式推断，尚未结合真实外键元数据与历史 SQL 共现关系。
- 人工备注当前为表级，尚未细化到列级或关系级编辑。
- E-R 关系画布与 AI 自动补线尚未在当前版本落地，属于设计阶段。

## 9. 后续迭代建议

### 9.1 文档能力

- 在 SchemaTree 增加多选表生成文档。
- 增加文档模板选项（简版、详细版、审计版）。

### 9.2 诊断能力

- 增加结构化建议渲染（问题点、建议、风险卡片化）。
- 增加计划缓存与前后版本对比。

### 9.3 语义索引能力

- 增量更新与重建策略可视化。
- 引入向量检索层，支持 SQL 生成前语义召回。
- 可配置纳入历史查询与业务文档。

### 9.4 E-R 关系能力

- 关系画布支持分层视图（按 schema/业务域折叠）。
- AI 推断支持多来源融合：真实外键、命名规则、索引覆盖、SQL 共现。
- 增加关系置信度阈值与批量审核模式，降低误判成本。
- 支持关系版本快照与差异回放，便于团队协作评审。
- 将关系图输出到文档生成能力（自动生成关系章节与关键链路说明）。

## 10. 相关代码位置

- apps/desktop/src/main/ipc/aiHandlers.ts
- apps/desktop/src/main/ai/AIProvider.ts
- apps/desktop/src/main/ai/OpenAIProvider.ts
- apps/desktop/src/main/ai/OllamaProvider.ts
- apps/desktop/src/preload/index.ts
- apps/desktop/src/renderer/src/stores/aiStore.ts
- apps/desktop/src/renderer/src/components/editor/QueryEditor.tsx
- apps/desktop/src/renderer/src/components/results/ResultsPanel.tsx
- apps/desktop/src/renderer/src/components/ai/AIInputBar.tsx
- apps/desktop/src/renderer/src/stores/connectionStore.ts
- packages/shared/src/types/ai.ts
