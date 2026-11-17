# Bambu 接入技术验证

研究日期：2026-11-17。本文的“已确认”指公开文档或源码可核实；**没有使用用户账号、没有连接 A1 mini / X2D，没有验证任何云端接口当前对用户账号可用**。自动化测试夹具也不是实机捕获。

## 结论与实施路线

1. 可先完成可用产品：手动任务、包含切片统计的 3MF 导入、人工选择实体料卷、多卷事务扣减、撤销和更正。导入不修改库存。
2. 社区源码存在正常云端模式的设备列表、打印历史及材料克数读取实现。可以实现默认关闭的实验性只读适配器，但不能将其描述为官方稳定 API，更不能将接口存在等同于 A1 mini / X2D 已验收。
3. 本次未找到面向普通第三方应用、可直接注册使用并承诺历史任务与逐材料克数的官方公开 API 契约。官方 Bambu Connect 是切片软件接入途径，不能据此推断它提供历史耗材查询 API。长期路线是向官方申请合作接入。
4. LAN 只读状态可作为后续辅助，不能替代完整历史或逐材料克数。保持现有安全设置，不要求 LAN Only、开发者模式、降级固件或绕过认证。
5. 第一版以数据库事务和来源标记为可信边界；任何同步都只更新待核对数据。失败、取消、未知状态以及缺失材料明细必须由用户补全重量。

## 能力边界

| 能力                | 公开证据                                                | 当前结论                                           |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| 云端设备列表        | BatuhanYigit 的 `cloudDevices`                          | 可实现实验性读取；账号和机型兼容待验证             |
| 历史任务分页        | cgradl 的 `_http_get_all_tasks` 使用 `limit` / `offset` | 可按可访问窗口分页；没有无限历史或保留期保证       |
| 单材料 / 多材料克数 | 多个项目读取 `weight`、`amsDetailMapping`               | 字段级解析可实现；字段可能延迟、缺失，不是实测重量 |
| 材质与颜色          | `filamentType`、`sourceColor` 等                        | 能显示报告值；不能据此识别第三方品牌或实体料卷     |
| AMS 物理槽位        | cgradl 使用 `amsMapping2` 转换切片索引                  | 有明确映射时才显示物理位置；不能泛用 `index / 4`   |
| A1 mini 真实任务    | 官方支持 AMS lite；社区方案覆盖 A 系列                  | 本项目未实机验证                                   |
| X2D 双喷嘴硬件      | 官方说明主直驱和辅助挤出系统                            | 数据模型支持两个独立喷嘴；协议映射未验证           |
| X2D 每喷嘴耗材统计  | 本次没有用户设备数据或官方云 API 字段契约               | 不推断喷嘴 ID；返回未知，允许人工映射              |
| 3MF 切片统计        | 官方 BambuStudio 导出器写入 `slice_info.config`         | 可安全解析存在字段；普通模型 3MF 可能没有统计      |
| LAN 历史 / 完整克数 | 官方只说明状态推送；社区将 MQTT 与云 / 切片组合         | 不能承诺仅靠 MQTT 获取历史和逐材料重量             |

## 云端接口：源码证据，不是官方契约

在以下固定版本中核对了源码。这里记录地址仅用于可审查的适配器实现，不代表已启用。

| 用途                    | 社区源码中的请求 / 返回字段                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| API 域名                | Global `https://api.bambulab.com`；China `https://api.bambulab.cn`                                    |
| 鉴权                    | `Authorization: Bearer <token>`；本项目不收集密码、不伪装官方客户端、不自动登录                       |
| 设备列表                | `GET /v1/iot-service/api/user/bind` → `devices[]`，使用 `dev_id`、`name`、`online`                    |
| 历史任务                | `GET /v1/user-service/my/tasks?limit=50&offset=0` → `hits[]`、`total`；源码也使用 `deviceId` 筛选     |
| MQTT 任务与历史 ID 关联 | joalbukrek 使用 `GET /v1/iot-service/api/user/task/{task_id}` → `job_id`，再在历史 `hits[].id` 中查找 |

任务中已观察到的源码读取字段：`id`、`deviceId`、`deviceName`、`title` / `designTitle`、`startTime`、`endTime`、`costTime`、`status`、`cover`、`weight`、`amsDetailMapping`、`amsMapping2`。字段缺失应保留 `null`；不要随机生成来源 ID，也不要以名称与日期去重。时间可能是 ISO 字符串、秒或毫秒，解析失败不能默认当前时间。

`amsDetailMapping[]` 中读取 `ams`、`weight`、`filamentType` / `targetFilamentType`、`sourceColor` / `targetColor`。颜色常见 RGB/RGBA 十六进制；校验后提取 RGB。单项重量为克。总重与明细不一致时应提示不完整，不能按比例补出各材料用量。云端报告值统一标记“云端任务报告”，不是传感器实测。

`cgradl` 源码将状态 `4` 注释为完成、`5` 注释为失败。其他数值没有在本次研究中取得足够契约证据，应为未知，不能像部分社区实现一样将“不是失败”都当成功。

### 槽位、自动续料和喷嘴

`cgradl` 最新实时建议逻辑把 `amsDetailMapping[].ams` 当作切片材料索引，经 `amsMapping2[index]` 的 `amsId`、`slotId` 转成物理槽位；其历史导入逻辑仍有旧式索引转换，说明不能盲目照搬。外置料卷哨兵值 `254` / `255` 不能显示成 AMS 64。没有可靠映射时保留原始材料索引和“槽位未确认”。

`amsId`、`slotId` 本身不能证明是主喷嘴还是辅助喷嘴。不同 AMS 型号、固件及 Filament Track Switch 会影响路径。SpoolNest 的手动拓扑是用户记录的物理连接，不是声称已识别设备协议。

AMS 自动续料可能只留下合并重量或最后一个槽位。不得根据剩余库存、使用时长或颜色相似度自动分摊；核对时允许一个材料条目拆分到多卷，所有分配在同一事务提交。

### 分页、重试与幂等

- 源码采用 `limit=50`、`offset += hits.length`，直到空页或到达 `total`。实际最大页数和历史可访问范围仍待账号验证。
- 实现须有最大页数、超时、重复页检测、认证失败停止和部分成功记录；不能将半途失败显示成全部成功。
- 一页成功持久化后才能推进游标。增量刷新应重取最近窗口以补齐结束状态和延迟材料数据，再通过稳定 ID 去重。
- 来源命名空间应含平台与账号/区域隔离标识，加云任务 `id`；可额外保存打印机 ID。MQTT `task_id` 与历史 `id` 不保证相同，不得混用。
- 同一条任务重复同步只更新来源快照；已人工核对的分配、确认重量、流水与审计时间不能覆盖。
- cgradl 的测试与注释提示任务结束后材料明细可能延迟 15–60 秒。这只是社区观察，不是官方 SLA。缺失时保留待获取数据，后续刷新，不快速无限重试。

## 官方硬件与安全资料

X2D 官方说明其左侧主喷嘴是近端直驱，辅助喷嘴由远程挤出系统供料；因此模型应为 `Printer → Extruder → Filament source → Spool`，且任务材料保留独立喷嘴字段。硬件事实并不能确定云端字段和喷嘴 ID 的映射。[官方 X2D 挤出系统说明](https://blog.bambulab.com/two-extruders-one-purpose-what-is-x2d-direct-drive-extrusion-and-auxiliary-extrusion/)

A1 mini 官方快速指南描述 AMS lite 的装配和四个料卷架；第一版可提供一个主喷嘴、四个手动 AMS lite 槽位及外置料卷位置。[官方 A1 mini 快速指南](https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20A1%20mini%20Combo.pdf)

官方授权更新说明将打印控制等操作与状态推送区分，后者在当时说明中不受新增授权机制影响；它并未承诺所有未来固件的任意第三方 MQTT 历史访问。[官方授权机制说明](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/)

官方介绍 Bambu Connect、标准模式与可选开发者模式，并提供合作接入联系渠道。SpoolNest 不自动改变这些设置。[官方第三方接入说明](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/)

## 3MF：可先完成的离线通路

对照官方 BambuStudio `master` 的 `src/libslic3r/Format/bbs_3mf.cpp`（2026-11-17 读取），`_add_slice_info_config_file_to_archive` 只为有效切片 plate 写统计。[官方导出器源码](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp)

- ZIP 内路径：`Metadata/slice_info.config`。
- 根 `config` 下可能有多个 `plate`；不能把多个盘的统计混成一次打印，应逐盘选择或逐盘建任务。
- `plate/metadata` 的 `key` / `value` 包括 `index`、`prediction`、`weight`、`printer_model_id`、`nozzle_diameters`。
- `plate/filament` 的属性包括 `id`（切片编号从 1 开始）、`type`、`color`、`used_g`、`used_m`、`tray_info_idx`。
- `plate/object@name` 可提供模型名称。`tray_info_idx` 是材料配置标识，不是实体料卷 ID 或物理 AMS 槽号。
- 新版源码还写入 `filament_map`、`group_id` 等喷嘴分组信息；没有研究具体版本的语义与真实文件前，不将其映射为 X2D 主/辅助喷嘴。
- 文件导入统一标记“切片估算”；不知道实际打印结果时保持未知。失败任务不能默认全量扣减。
- 使用 SHA-256 文件摘要和 plate ID 标识一次文件导入，可避免误重复导入，但同一文件可能实际打印多次：用户必须能显式建立新的一次打印，不能将文件摘要当设备任务 ID。
- 限制上传大小、ZIP 项数和解压后 metadata 大小，禁用 DTD/外部实体，不解压到用户路径。缺失统计返回明确错误或待补全，不编造用量。

## 四个参考项目评估

| 项目与固定版本                                                                                                                                                | 有价值的实现                                                                                                         | 不应照搬的地方                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [cgradl/filament-manager](https://github.com/cgradl/filament-manager/tree/98595f6a7e8bdc56cc437069c45d1cf03f388983)，v0.41.3，2026-10-17                      | `bambu_cloud_client.py` 历史分页；`routers/bambu_cloud.py` 历史导入；`print_monitor.py` 起始快照、材料映射和延迟补齐 | 自动扣减、推测续料分摊和旧式槽位 fallback 与本项目原则不同；不直接采用                             |
| [BatuhanYigit/bambulab-filament-control](https://github.com/BatuhanYigit/bambulab-filament-control/tree/7f3214b3a6c93fbd7c925ab2e31e7abf76aa1a1c)，2026-06-14 | `src/main/cloud.ts` 明确 Global/China 域名、设备列表及任务字段                                                       | 随机任务 ID、缺重变 0、缺时变当前时间都不适合库存审计                                              |
| [joalbukrek/Bambulab-Filament-Tracker](https://github.com/joalbukrek/Bambulab-Filament-Tracker/tree/82101e0cdbfcba449a86c46d3c81ebd685d203c1)，2026-04-26     | `cloud.py` 展示 MQTT task ID → job ID → 历史详情关系；`parser.py` 展示切片材料与槽位分离                             | 大量猜测字段别名不等于协议契约；最近窗口搜索不等于完整历史                                         |
| [Niko11111/FilaManBambuUsage](https://github.com/Niko11111/FilaManBambuUsage/tree/dc420eeb6dea5f9fd77fcaeb8a0de9053634757c)，2026-11-15                       | `threemf.py` 对 3MF 元数据、大小限制、材料编号的处理；`service.py` 保存任务映射                                      | 自动记账、失败进度推算不是本项目人工实测；其 `tests/fixtures/slice_info.config` 明确为手写测试数据 |

以上研究未复制项目实现代码。测试夹具应重新构造并写明 synthetic；接口研究与真实连通性验收分开记录。

## 启用实验性云端前的用户步骤

这些步骤需要用户决定；当前开发不执行账户登录或设备设置变更。

1. 确认地区（中国/全球）、A1 mini 与 X2D 的固件版本、Bambu Studio 版本和 AMS/切换器布局。
2. 阅读实验性说明：非公开接口可能随时变更，Token 代表账号访问权限，调用可能受服务条款、限流和账号安全策略约束。优先取得官方授权途径。
3. 用户明确启用后，使用已合法获得的授权凭据；不在聊天、GitHub、日志或前端本地存储粘贴 Token。由本地受保护配置或进程环境注入；关闭集成时清除凭据，按提供方机制撤销授权。
4. 分别选一项 A1 mini 单材料任务、X2D 双喷嘴任务、失败任务和只含总重任务进行只读获取。保存去除 Token、序列号、私有 URL、账号信息后的最小字段样本。
5. 与 Bambu Handy/Studio 可见内容对比任务 ID、时间、材料、颜色、克数、喷嘴和槽位。缺失项继续显示未知；不得为了通过验收补造。
6. 验证重复同步、已核对后重同步、断线恢复和 Token 失效；用独立测试数据库验证 800g → 745g → 撤销 800g。完成后才将对应机型的“真实接入”标记为已验证。

在以上设备验收完成前，设置页与 README 应继续显示“实验性 / 未实机验证”。
