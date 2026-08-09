# HCLite 交接说明

## 1. 边界

HCLite 位于 `C:\Users\Enys10021\Desktop\work1\HCLite`，是独立 Git 仓库。它不依赖 HeavenlyCreations 的数据库、部署目录或服务器。本阶段仅本地运行，不含线上部署配置。

保留功能：单主账户与子用户、纯文案 Agent、六类文案、视频上传/链接转写、任务历史与重试、Skill、门店档案、团队/私有信息库、四类共享 API 配置。

明确删除：注册邀请、计费套餐、积分额度、图片/封面/视频生成、视觉分析、素材生成库、旧域名与旧部署逻辑。

## 2. 运行结构

- Web：Next.js 15，桌面侧栏与移动端底部导航。
- 数据库：项目专属 PostgreSQL 17，默认 `127.0.0.1:55433/hc_lite`。
- 数据目录：`.local-postgres/`，不进入 Git。
- 临时转写目录：`data/stt-temp/`，不进入 Git，任务终态自动清理。
- FFmpeg：`.local-tools/ffmpeg.exe`。
- 环境配置：`.env.local`，由建库脚本生成，不进入 Git。

迁移顺序：

1. `001_initial.sql`：用户、会话和登录限流。
2. `002_catalog_config.sql`：四类 API 配置、Skill、门店档案（内部表名仍为 `profiles`）、信息库。
3. `003_jobs.sql`：文案与转写任务队列。
4. `004_agent.sql`：私有 Agent 对话、消息和已确认资产。

已应用迁移带 SHA-256 校验，禁止直接改写；后续结构变更必须新增迁移文件。

## 3. 权限矩阵

| 能力 | 主账户 | 子用户 |
|---|---:|---:|
| 六类文案、Agent、转写 | 是 | 是 |
| 系统 Skill/门店档案管理 | 是 | 否 |
| 私有 Skill/门店档案 | 仅自己 | 仅自己 |
| 团队信息库 | 读取全部；管理自己或任意团队条目 | 读取全部；管理自己创建的团队条目 |
| 私有信息库 | 仅自己 | 仅自己 |
| 用户与 API 配置 | 是 | 否 |
| 查看他人任务、对话和私有资料 | 否 | 否 |

权限均在服务端 SQL 中带 `user_id`/可见范围条件；前端隐藏菜单不是安全边界。

## 4. Agent 资产选择

当前对话没有已确认选择且没有默认门店档案时，服务端返回 `409 requiresAssetSelection`，前端展示 Skill/门店档案/信息库选择。确认后同一对话复用，不重复弹窗，并展示：

> 本对话不再弹出选择，直接使用当前已选择资产

Agent 只创建六类文案任务，默认输出纯文本，不自动追加镜头、字幕、时长、字数或其他格式要求。联网搜索默认关闭；只有主账户开启全局选项并注入安全 provider 后才可用。

## 5. 转写安全

- 上传使用流式 multipart，不把整段视频读入内存。
- 视频链接固定通过 TikHub 解析，支持抖音、小红书、快手、B站、西瓜/头条、微信视频号和微博；不支持 TikTok、YouTube 等国外平台。
- TikHub 使用逐平台字段提取，抖音 Web 无有效媒体时回退 App V3；B站先取分 P 的 CID，再取播放地址并优先下载独立音轨。
- 视频号使用 `raw=false` 同时取得媒体 URL 与匹配的 `decode_key`；下载后通过 `vendor/wechat-channels-decrypt` 中附带 MIT 许可证的微信官方 WASM 本地解密前 131072 字节，不依赖浏览器或外部解密服务。发布构建时必须一并保留该 vendor 目录。
- 解析与下载继续阻止私网、保留地址、DNS 重绑定和无限重定向。
- FFmpeg 使用参数数组启动，不经过 shell，并有超时和进程终止。
- 临时路径必须位于 `data/stt-temp`；客户端不能提交服务器路径。
- 本地上传源清理后不可原地重试，API 返回 `reupload_required`；链接任务可重新解析。

## 6. 常用命令

```powershell
npm run db:start
npm run db:stop
npm run db:migrate
npm run db:init-owner
npm run dev
npm run check
npm audit --omit=dev
```

主账户只能初始化一次。子用户统一从“用户管理”页面创建，不提供公开注册入口。
