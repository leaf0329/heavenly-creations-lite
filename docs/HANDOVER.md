# HCLite 交接说明

## 1. 边界

HCLite 位于 `C:\Users\Enys10021\Desktop\work1\HCLite`，是独立 Git 仓库。它不依赖 HeavenlyCreations 的数据库或部署目录。2026-08-13 已部署到服务器，并通过 `https://a.private.meikaai.cn` 对内使用；旧版继续独立运行在 `https://meikaai.cn`。

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

- 浏览器先向应用申请 10 分钟有效的 OSS V4 签名地址，再直接 PUT 到私有 Bucket；应用只接收对象元数据，不中转整段视频。
- 后台通过深圳 OSS 内网 Endpoint 下载视频到任务专属临时目录，任务终态自动删除 OSS 对象和本地临时文件。
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

### 6.1 环境变量与认证

生产环境必须使用独立的 `/etc/hclite.env`，所有者为 `root:root`、权限为 `600`。当前代码读取以下配置：

| 变量 | 生产要求 |
|---|---|
| `DATABASE_URL` | 必填；只连接 HCLite 独立数据库，应用用户不得是 PostgreSQL 超级用户 |
| `SESSION_SECRET` | 必填；至少 32 个字符的独立随机值，不能复用旧版密钥 |
| `CONFIG_ENCRYPTION_KEY` | API Key 入库前加密所需；生产必填，丢失或更换后旧密文不可解密 |
| `APP_ORIGIN` | `https://a.private.meikaai.cn` |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true`，前提是应用端口只监听回环地址并仅由受信任 Nginx 访问 |
| `PG_SSL` | 数据库同机走回环地址时为 `false` |
| `PG_POOL_MAX` | 单实例建议 `5`，与旧版连接数合计不能超过 PostgreSQL 上限 |
| `AUTH_LOGIN_WINDOW_MS` | 默认 900000（15 分钟） |
| `AUTH_LOGIN_MAX_ATTEMPTS` | 默认 8 |
| `AUTH_LOGIN_BLOCK_MS` | 默认 900000（15 分钟） |
| `SESSION_TTL_SECONDS` | 默认 604800（7 天） |
| `STT_MAX_UPLOAD_BYTES` | 默认 524288000（500 MiB），同时受 Nginx 上传限制约束 |
| `STT_MAX_CONCURRENT_PER_USER` | 当前建议 `1` |
| `TEXT_MAX_CONCURRENT_PER_USER` | 当前建议 `2` |
| `TEXT_JOB_CONCURRENCY` | 全局文字任务并发；部署前需明确设置并验证 |
| `VIDEO_PARSER_ALLOWLIST` | 可选；只允许经代码确认的 TikHub API 域名 |
| `VIDEO_PARSER_MEDIA_ALLOWLIST` | 可选；只允许经代码确认的国内平台媒体 CDN 域名 |
| `FFMPEG_PATH` | Linux 使用服务器实际绝对路径，预计 `/usr/bin/ffmpeg` |

登录会话存储在 PostgreSQL，Cookie 名为 `hc_session`，属性为 `HttpOnly`、`SameSite=Lax`；生产环境通过 `COOKIE_SECURE=true` 增加 `Secure`。登录限流状态也存储在 PostgreSQL，不依赖单进程内存。

主账户生产密码不得写入本文档、Git、部署包或命令输出。`Administrator`/`Administrator` 只适合已隔离的本地开发，不能直接用于公网生产环境。

### 6.2 API 配置与数据迁移边界

四类共享配置为 `text`、`agent`、`audio`、`video_parser`，只有主账户可查看、修改和测试。API Key 使用 `CONFIG_ENCRYPTION_KEY` 加密后存入 HCLite 数据库。

部署前必须明确是“生产空配置，登录后重新录入”还是“迁移本地配置”。如果迁移加密配置，必须同时安全迁移匹配的 `CONFIG_ENCRYPTION_KEY`；只复制数据库密文而不复制原密钥会导致 API Key 永久不可解密。不得复制或复用旧版 HeavenlyCreations 数据库表。

视频解析配置只允许 provider `tikhub`；语音转写通过 `audio` 服务配置调用兼容 `/audio/transcriptions` 的外部接口，服务器本地只负责下载、解密、FFmpeg 提取和分段，不运行本地 Whisper 模型。

### 6.3 队列与故障恢复

文字和转写任务共用 PostgreSQL 队列，使用处理令牌、租约、心跳和过期任务恢复避免重复写入。任务创建后会启动进程内轮询器，每 2 秒扫描一次待处理任务。

应用通过根目录 `instrumentation.ts` 在 Node.js 运行时启动时完成数据库初始化并启动队列轮询器；重启后无需等待新请求即可扫描 pending/过期 processing 任务。

## 7. 线上部署（已实施）

目标是在现有阿里云服务器 `120.25.199.231` 上与旧版 HeavenlyCreations 并行运行：

| 项目 | 域名 | 本机监听 | 数据库 | 发布目录 |
|---|---|---:|---|---|
| 旧版 HeavenlyCreations | `https://meikaai.cn` | `127.0.0.1:3000` | 现有旧版数据库 | `/opt/heavenly-creations` |
| HCLite | `https://a.private.meikaai.cn` | `127.0.0.1:3001` | `hclite` / `hclite_app` | `/opt/hclite` |

两套应用必须使用独立的环境变量文件、Systemd 服务、数据库、发布目录、日志和回滚目录。HCLite 的部署、重启或回滚不得影响旧版服务。

服务器已核查为 4 核 CPU、约 7.1 GiB 内存、约 99 GB 磁盘；在 HCLite 不超过 5 人使用的前提下，资源足够并行运行。视频处理应把本地 FFmpeg 并发限制为 2 个任务，其余任务排队。

当前生产事实：

- 生产环境文件为 `/etc/hclite.env`，`root:root:600`；不与旧版环境文件混用。
- systemd 单元为 `hclite.service`，内存上限 2 GiB；数据库备份由 `hclite-db-backup.timer` 每日执行。
- Linux FFmpeg 固定使用 `/usr/bin/ffmpeg`。
- `a.private.meikaai.cn` A 记录指向 `120.25.199.231`，Nginx 按 Host 转发到 3001。
- 独立 Let's Encrypt 证书名为 `a.private.meikaai.cn`，当前有效期至 2026-11-11，自动续期由现有 `certbot.timer` 管理。
- 当前发布目录 `/opt/hclite-builds/e67448833799b2fbfd4ef3e78d952dca90be98a3`；上一版本保留为唯一应用回滚版本。
- 数据库日常备份位于 `/opt/hclite-backups/daily`，自定义格式、带 SHA-256，滚动保留 7 天。
- 应用日志使用 systemd journal，不另写应用日志文件；由主机 journald 的统一保留策略管理。

## 8. HCLite OSS 配置（已完成控制台配置）

HCLite 使用独立的私有 Bucket，不与旧版的模板或用户素材 Bucket 混用：

| 配置项 | 当前值 |
|---|---|
| Bucket | `meika-hclite-user-sz-01` |
| 地域 | 华南1（深圳） |
| 存储类型 | 标准存储 |
| 存储冗余 | 本地冗余 LRS |
| 读写权限 | 私有 |
| 阻止公共访问 | 已开启 |
| 版本控制 | 未开启 |
| 传输加速 | 未开启 |
| 公网 Endpoint | `https://oss-cn-shenzhen.aliyuncs.com` |
| ECS 内网 Endpoint | `https://oss-cn-shenzhen-internal.aliyuncs.com` |

存储职责：

- 视频、提取音频和转写过程中的大文件放入 OSS。
- Skill、门店档案、信息库 MD 内容、文案和最终转写文字继续保存在 PostgreSQL。
- 浏览器使用短时有效的公网签名 URL 上传或下载。
- 服务器后台访问、读取和删除 OSS 对象时使用深圳内网 Endpoint。
- Bucket 保持私有，严禁在前端代码中保存 AccessKey，也不得改为公共读或公共读写。

生命周期规则 `hclite-media-expire-7d` 已创建并处于启用状态，作用于整个 Bucket：

- 完整文件在最后一次修改满 7 天后自动删除。
- 未完成的分片上传碎片在生成满 1 天后自动删除。
- 删除不可恢复；最终文字结果不受影响，仍保存在 PostgreSQL。

CORS 当前只允许以下来源：

```text
https://a.private.meikaai.cn
```

允许的方法为 `GET`、`PUT`、`HEAD`；允许请求头为 `Content-Type`、`Content-Length`、`x-oss-*`；暴露响应头为 `ETag`、`Content-Length`；缓存时间为 600 秒，并启用了 `Vary: Origin`。

已完成外部验收：目标域名的 OPTIONS 预检返回 200；`https://meikaai.cn`、旧域名和公网 IP 来源均不获得跨域授权；匿名访问 Bucket 返回 403。Bucket Policy 仅允许实例角色 `meika-prod-ecs-role` 的会话对 `uploads/*` 执行 `PutObject`、`GetObject` 和 `DeleteObject`，且“阻止公共访问”保持开启。

部署时使用的非敏感配置如下，具体变量名应在完成 HCLite OSS 代码适配后以代码定义为准，不得直接猜测：

```env
OSS_BUCKET=meika-hclite-user-sz-01
OSS_REGION=oss-cn-shenzhen
OSS_INTERNAL_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com
OSS_PUBLIC_ENDPOINT=https://oss-cn-shenzhen.aliyuncs.com
```

AccessKey ID、AccessKey Secret、数据库密码、主账户密码、Cookie 和临时签名 URL 不得写入本文档或 Git。生产凭据应放入服务器权限受限的环境变量文件，并将 OSS 权限限制到 `meika-hclite-user-sz-01`。

## 9. 上线结果与后续验收

已完成：独立数据库与四项迁移、主/子账户初始化、四类公司 API 配置重新加密迁移、启动队列引导、生产 readiness、DNS/HTTPS/Nginx、systemd、每日备份、OSS 签名上传/后台内网读取/终态清理，以及真实文字模型最小调用。登录 Cookie、四类配置本地解密校验、上传创建任务和旧版 3000 健康状态均通过。

仍建议在实际业务使用前完成：

1. 用一条真实的国内热门平台视频链接分别验收 TikHub 解析、下载、音频提取和转写；测试素材不得含敏感个人信息。
2. 用一段真实但可删除的视频完成 iPhone Safari 的大文件直传、进度显示、转写和删除验收。
3. 在下一次证书维护窗口执行 `certbot renew --dry-run`，并持续检查两个证书的自动续期。
4. 将 HCLite 数据库备份加密复制到独立私有存储，并做一次恢复演练；当前备份仍与数据库同机。

## 10. Git 与发布来源

- 独立远程仓库：`https://github.com/leaf0329/heavenly-creations-lite.git`。
- 发布分支：`main`。
- 当前生产代码提交：`e67448833799b2fbfd4ef3e78d952dca90be98a3`。
- 当前生产归档 SHA-256：`1D014173D128D254381318F587940BCC58DEBE429BC09CE24961C21D89D4C6F2`。
- 生产初始化账户为 `MeikaAdmin` 与 `MeikaUser`（数据库规范化为小写且登录不区分大小写）；随机密码只保存在本地忽略文件 `password.txt`，不在 Git、服务器环境文件或交接文档中保存。
- 生产发布包只能从已确认并推送的 Git 提交创建，不能直接打包含 `.env.local`、`.local-postgres`、`.local-tools`、`.next`、`node_modules`、日志或本地数据库的工作目录。
- 每次发布记录完整提交号、归档 SHA-256、Next.js Build ID、迁移清单、数据库备份路径和回滚目录。
- 服务器访问 npm 较慢时，可以在本机准备 Linux x64 依赖缓存后上传，但严禁把 Windows `node_modules` 直接复制到 Linux。
