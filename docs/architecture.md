# 架构与核心约束

Vue 3 / TypeScript / Vite / Vue Router / Pinia；Fastify / Zod；Node.js 24 自带 SQLite。采用原生 SQLite 而非 Prisma，减少 Apple Silicon/Docker 的引擎依赖，事务边界更明确。SQL migration 纳入版本管理，仓储层集中封装 SQL；所有外部输入使用共享 Zod schema。Node 24 的 SQLite API 仍可能输出实验性提示，版本锁定在 Node 24。

- `apps/web`：中文响应式界面、R​​eka UI 无障碍 Dialog/Drawer、CSS design tokens。
- `apps/server`：API、安全边界、事务服务和迁移。
- `packages/shared`：请求校验、领域类型、中文枚举与重量格式。
- `packages/printer-adapters`：禁用默认的实验云端适配器、3MF 元数据解析；不实现控制打印机。

数据库重量统一为整数 mg，界面统一 g；价格用整数分。产品规格与实体料卷分离。每个重量变更写流水；流水只能追加。核对是独立于打印结果的状态机。

核对事务：BEGIN IMMEDIATE → 检查请求幂等键和内容摘要 → 验证任务版本/状态 → 检查所有材料有明确分配 → 更正时恢复上次分配 → 合并同料卷消耗检查余额 → 写新分配和流水 → 标记已核对、版本 +1 → COMMIT。任何错误 ROLLBACK。撤销同样事务恢复并追加流水。SQLite 单写者和版本条件杜绝丢失更新，重复请求不会二次扣减。

不自动选择料卷。建议列表优先历史槽位快照、材质、颜色和库存；用户必须选择具体 ID。同材料可拆分到多卷。失败/取消/打印中/未知任务输入默认为空，必须填写并明确确认。仅有总重量时保留空材料行供人工拆分，不制造比例。

同步唯一键 `(source, external_device_id, external_id)`。已存在核对历史的任务不重写材料/人工结果。3MF 文件摘要 + plate index 去重，只代表同一个切片文件导入；重复打印应另建手动任务。同步任务与导入均不写库存流水。

默认不创建示例数据。测试仅使用临时 SQLite；正式数据库、备份、凭据不进 Git。服务默认仅 127.0.0.1；非 loopback 必须设置强 ADMIN_TOKEN。拒绝跨源写入、校验 Host，管理 Token 仅存浏览器会话内存。云 Token 仅从环境变量读取，不返回给浏览器、不写日志或数据库。不能承诺未授权、未实机验证的设备能力。
