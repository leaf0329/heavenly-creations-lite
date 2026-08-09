# HCLite

HCLite 是一个独立的内部团队文案工作台。项目仅保留文案 Agent、六类文案创作、视频转文字、Skill、Profile 和团队/私有信息库；不包含计费、套餐、金豆、生图、视觉分析、封面或视频生成。

## 账户与隐私

- 系统只有一个主账户，可创建、查看、启停、重置密码和删除子用户。
- 主账户和子用户拥有相同创作能力；只有主账户能看到用户管理和 API 配置。
- 对话、文案任务、转写、私有 Skill/Profile 和私有信息库均按用户隔离，主账户也不能读取成员私有内容。
- 视频链接使用 TikHub 当前接口逐平台适配，支持抖音、小红书、快手、B站、西瓜/头条、微信视频号和微博；B站优先只下载 DASH 音轨，视频号媒体使用随响应返回的密钥在本地解密前 128KB。
- 团队信息库对所有成员共享；文案、脚本、选题不设业务数量上限。
- 系统 Skill、系统 Profile、每个用户的私有 Skill 和私有 Profile 各限 10 条。

## 本地启动

前置条件：Node.js 20.19+、PostgreSQL 17 二进制（默认路径 `C:\Program Files\PostgreSQL\17`）和项目内 `.local-tools/ffmpeg.exe`。

```powershell
npm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-portable-postgres.ps1 -ConfirmCreate
$env:OWNER_USERNAME='owner'
$env:OWNER_DISPLAY_NAME='主账户'
$env:OWNER_PASSWORD='至少十二个字符的安全密码'
npm run db:init-owner
npm run dev
```

当前工作区已经完成项目专属 PostgreSQL 初始化，地址为 `127.0.0.1:55433`。电脑重启后先运行 `npm run db:start`；需要停止时运行 `npm run db:stop`。

## 验证

```powershell
npm run check
npm audit --omit=dev
```

所有密钥、数据库数据、临时媒体、日志和本地工具都在 `.gitignore` 中。视频上传、下载、音频分段无论成功或失败都会清理，只保留源链接或原文件名、元数据和转写结果。

更完整的架构、权限和运维说明见 [docs/HANDOVER.md](docs/HANDOVER.md)。
