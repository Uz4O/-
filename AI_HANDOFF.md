# mark-six-workbench AI 交接说明

这份文档是给新设备上的 AI 和开发者看的项目接手入口。当前目标是把项目迁移到 Mac mini 后继续开发网站和本地服务，同时保留云服务器部署背景。

## 1. 项目定位

- 项目名：`mark-six-workbench`
- 类型：六合彩投注 OCR 识别、AI 辅助解析、派奖计算工作台。
- 主要用户：负责汇总截图、识别投注、填写开奖结果、生成中奖名单和汇报文本的计算者。
- 技术栈：
  - 前端：React 19 + Vite 7 + lucide-react。
  - Node 服务：Express 5，负责静态托管、卡密授权、请求限流、开奖同步、AI/OCR API 转发。
  - OCR 服务：FastAPI + PaddleOCR + PaddlePaddle + OpenCV，负责本地表格和聊天截图识别。
- 核心原则：最终金额必须由本地确定性规则计算，AI 只能辅助标准化和候选解释，不能直接决定最终金额。

## 2. 当前功能全貌

- 卡密授权：
  - 普通用户进入工作台前需要在前端激活卡密。
  - 浏览器会保存 `markSixLicenseCardId` 和 `markSixLicenseBrowserId`。
  - Node 后端用 `server/license.js` 校验卡密、绑定浏览器、记录过期时间。
- 卡密后台：
  - 路径：`/admin/cards`。
  - 功能：管理员登录、生成卡密、复制明文卡密、禁用、解绑、删除。
  - 管理密码来自 `ADMIN_PASSWORD`。
- OCR 识别：
  - 表格截图走 `/api/recognize-table`，Node 转发到 Python `/recognize/table`。
  - 聊天截图本地 OCR 走 `/api/recognize-chat`，Node 转发到 Python `/recognize/chat`。
  - 聊天截图 Qwen 视觉 OCR 走 `/api/recognize-chat-qwen`，Node 直接调用 Qwen 兼容 OpenAI API。
  - OCR 请求受卡密校验、可选 `OCR_ACCESS_TOKEN`、IP 限流保护。
- 投注解析：
  - 纯业务逻辑在 `src/lib/lottery.js`。
  - 支持 `pingma`、`lianma`、`numberFushi`、`zodiacFushi` 等模式。
  - `App.jsx` 负责页面状态、截图上传、OCR 请求、AI 异常确认和结果页。
- DeepSeek 辅助解析：
  - 后端模块：`server/deepseekBetAssistant.js`。
  - 接口：`POST /api/assist-bet-parsing`。
  - Flash 先处理，必要时 fallback 到 Pro。
  - DeepSeek 返回的候选必须再经过 `validateAiBetCandidate` 和本地解析器校验。
- 人工修正样本库：
  - 后端模块：`server/parsingSamples.js`。
  - 接口：`POST /api/parsing-samples`。
  - 存储默认路径：`server/data/parsing-samples.json`。
  - 用于把第三页人工修正样本注入后续 DeepSeek prompt。
- 开奖同步：
  - Node 启动后后台同步最新开奖。
  - 接口：`GET /api/latest-lottery-result`。
  - 缓存默认路径：`server/data/latest-lottery-result.json`。

## 3. 目录速览

- `src/`：React 前端源码。
  - `App.jsx`：页面核心，包含卡密门禁、后台页、工作台流程、OCR/AI 请求和 UI。
  - `lib/lottery.js`：投注解析、开奖结果计算、报表生成等纯业务逻辑。
  - `lib/licenseClient.js`：前端卡密请求头和浏览器 ID 工具。
  - `styles.css`：全局样式，偏紧凑工作台布局。
- `server/`：Express 服务。
  - `index.js`：HTTP API、静态托管、开奖同步、限流、授权中间件。
  - `license.js`：卡密生成、激活、绑定、过期和加密存储。
  - `deepseekBetAssistant.js`：DeepSeek 投注文本标准化候选。
  - `qwenChatOcr.js`：Qwen 视觉 OCR。
  - `parsingSamples.js`：人工修正样本库。
- `ocr_service/`：Python FastAPI OCR 服务。
  - `app.py`：`/health`、`/recognize/table`、`/recognize/chat`。
  - `ocr_engine.py`：PaddleOCR 初始化。
  - `table_recognizer.py`：投注表格金额识别。
  - `chat_recognizer.py`：聊天截图文本识别和清洗。
  - `table_layout.json`：表格截图布局比例配置。
- `scripts/`：OCR 初始化和预热脚本。
- `docs/`：设计说明和历史计划。
- `dist/`、`node_modules/`、`.venv/`：生成物或依赖，不要手改。

## 4. Mac mini 新设备接手步骤

1. 准备运行环境：
   - 安装 Node.js 20+。
   - 安装 Python 3.10、3.11 或 3.12。
   - 确认可以使用 `npm`、`python3`、`bash`。
2. 获取项目：
   - 从旧设备复制项目或从 Git 仓库拉取。
   - 不要复制 `.env` 到公开仓库；如果是私下迁移，可以单独安全转移 `.env`。
   - 不需要复制 `node_modules/`、`dist/`、`.venv/`、日志和缓存。
3. 安装 Node 依赖：

   ```bash
   npm install
   ```

4. 初始化 Python OCR 环境：

   ```bash
   bash scripts/setup-ocr.sh
   ```

   如果脚本因架构、Python 版本或 PaddlePaddle 依赖失败，就手动执行：

   ```bash
   python3 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   .venv/bin/python -m pip install -r ocr_service/requirements.txt
   .venv/bin/python scripts/warmup-ocr.py
   ```

5. 配置环境变量：
   - 复制 `.env.example` 为 `.env`。
   - 设置至少这些本地开发值：

   ```ini
   PORT=8787
   OCR_SERVICE_URL=http://127.0.0.1:8791
   NODE_ENV=development
   ADMIN_PASSWORD=change-this-admin-password
   LICENSE_SECRET=change-this-long-random-secret
   ```

   - 如果要用 DeepSeek 辅助解析，配置 `DEEPSEEK_API_KEY`。
   - 如果要用 Qwen AI 识别聊天截图，配置 `QWEN_API_KEY`。
   - 如果要限制 OCR 调用，配置 `OCR_ACCESS_TOKEN`，前端 URL 可带 `?ocrToken=...`。

6. 启动 OCR 服务：

   ```bash
   .venv/bin/python -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8791
   ```

7. 启动 Node 和 Vite：

   ```bash
   npm run start
   ```

   - Vite 前端默认监听 `0.0.0.0`。
   - Node/Express 默认监听 `8787`。
   - 生产静态托管依赖 `npm run build` 生成的 `dist/`。

8. 首次进入工作台：
   - 先访问 `http://127.0.0.1:8787/admin/cards`。
   - 用 `ADMIN_PASSWORD` 登录并生成卡密。
   - 回到工作台激活卡密后再测试 OCR、AI 辅助解析和开奖同步。

## 5. 常用命令

```bash
npm install
npm run start
npm run test
npm run build
npm run preview
```

- `npm run dev`：只启动 Vite 前端，监听 `0.0.0.0`。
- `npm run server`：只启动 Node/Express 服务，默认端口 `8787`。
- `npm run start`：用 `concurrently` 同时启动 Node 服务和 Vite。
- `npm run test`：使用 Node 内置 test runner 跑 JS 单元测试。
- `npm run build`：构建前端到 `dist/`。
- `npm run preview`：预览构建产物，监听 `127.0.0.1`。
- `npm run ocr:setup`：当前 package 脚本是 Windows PowerShell 版本；Mac 上优先用 `bash scripts/setup-ocr.sh`。

Python OCR 测试可按需运行：

```bash
.venv/bin/python -m unittest discover ocr_service
```

## 6. 环境变量说明

当前 `.env.example` 包含：

- `PORT`：Node 服务端口，默认 `8787`。
- `OCR_PORT`：OCR 服务端口，默认 `8791`。
- `OCR_SERVICE_URL`：Node 转发到 Python OCR 的地址。
- `NODE_ENV`：运行环境。
- `MAX_IMAGE_MB`：Express JSON body 大小上限。
- `OCR_TIMEOUT_MS`：Node 调 OCR 的超时时间。
- `OCR_RATE_LIMIT_WINDOW_MS`、`OCR_RATE_LIMIT_MAX`：OCR/AI 请求限流窗口和次数。
- `LOTTERY_SOURCE_API`、`LOTTERY_SOURCE_GROUP`：最新开奖数据源和分组。
- `LOTTERY_SYNC_INTERVAL_MS`、`LOTTERY_SYNC_TIMEOUT_MS`：开奖同步间隔和超时。
- `LOTTERY_SYNC_DISABLED`：测试或离线开发可设为 `1` 禁用开奖后台同步。
- `ADMIN_PASSWORD`：`/admin/cards` 管理后台密码。
- `LICENSE_SECRET`：卡密哈希、浏览器绑定、明文卡密加密的密钥，生产环境必须设置为长随机值。
- `LICENSE_DATA_FILE`：卡密数据文件，默认 `server/data/license-cards.json`。
- `OCR_ACCESS_TOKEN`：可选 OCR 访问令牌，设置后客户端必须带 `x-ocr-token` 或 `?ocrToken=...`。
- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_FLASH_MODEL`、`DEEPSEEK_PRO_MODEL`：DeepSeek 辅助解析配置。
- `QWEN_API_KEY`、`QWEN_BASE_URL`、`QWEN_OCR_MODEL`、`QWEN_OCR_TIMEOUT_MS`：Qwen 视觉 OCR 配置。
- `PARSING_SAMPLES_FILE`：人工修正样本库路径，未设置时使用 `server/data/parsing-samples.json`。
- `TABLE_LAYOUT_CONFIG`：Python OCR 表格布局配置路径，可指向自定义 JSON。

不要把真实 `.env`、API Key、生产卡密数据或私钥内容提交到仓库。

## 7. HTTP 接口

前端只调用 Node 的 `/api/*`。Node 负责授权、限流、转发、外部模型和开奖源调用。

Node/Express：

- `POST /api/admin/login`：管理员登录，写入 `adminSession` cookie。
- `GET /api/admin/cards`：卡密列表。
- `POST /api/admin/cards/generate`：生成卡密。
- `POST /api/admin/cards/:id/disable`：禁用卡密。
- `POST /api/admin/cards/:id/reset-binding`：解绑浏览器。
- `POST /api/admin/cards/:id/delete`：删除卡密。
- `POST /api/license/activate`：激活卡密并绑定浏览器。
- `GET /api/license/session`：检查卡密会话。
- `GET /api/health`：检查 Node API 和 Python OCR 服务。
- `GET /api/latest-lottery-result`：获取最新开奖，可带 `?refresh=1` 手动刷新。
- `POST /api/recognize-table`：识别投注表格截图。
- `POST /api/recognize-chat`：本地 OCR 识别聊天截图。
- `POST /api/recognize-chat-qwen`：Qwen 视觉 OCR 识别聊天截图。
- `POST /api/assist-bet-parsing`：DeepSeek 辅助解析异常投注文本。
- `POST /api/parsing-samples`：保存人工修正样本。

Python/FastAPI：

- `GET /health`：初始化并检查 PaddleOCR。
- `POST /recognize/table`：识别表格截图金额。
- `POST /recognize/chat`：识别聊天截图投注文本。

## 8. 运行数据和不要提交的内容

`.gitignore` 已忽略：

- `node_modules/`
- `dist/`
- `.venv/`、`venv/`
- `models/`
- `ocr_service/**/__pycache__/`
- `.env`、`.env.*`，但保留 `.env.example`
- `*.log`
- `server/data/*.json`

运行数据示例：

- `server/data/license-cards.json`：卡密数据。
- `server/data/parsing-samples.json`：人工修正样本。
- `server/data/latest-lottery-result.json`：开奖缓存。

这些文件可能包含用户业务数据或生产状态。同步服务器或换设备时要谨慎处理，不能随便覆盖生产服务器上的数据文件。

## 9. 开发注意事项

- 不要直接改 `dist/`，它是构建产物。
- 不要手改 `node_modules/`、`.venv/`、OCR 模型文件和日志。
- 中文内容请保持 UTF-8。Windows PowerShell 默认输出可能显示乱码，但文件本身可能是正常 UTF-8，改文案前要用 UTF-8 方式读取。
- 业务计算优先改 `src/lib/lottery.js` 并补 `src/lib/lottery.test.js`。
- 页面流程和 UI 状态主要在 `src/App.jsx`，改动时注意卡密门禁、输入页、异常确认页、结果页之间的状态流。
- AI 候选不能绕过本地校验。任何自动计入金额的路径都应最终经过本地解析和计算。
- OCR 表格识别强依赖 `ocr_service/table_layout.json` 的截图比例；换模板时优先调布局配置。
- Qwen OCR 和 DeepSeek 都是可选能力；没有 API Key 时应有清晰错误，不应影响基础本地解析能力。

## 10. 验证流程

文档或配置说明变动：

```bash
# 读回确认中文正常
python3 - <<'PY'
from pathlib import Path
print(Path('AI_HANDOFF.md').read_text(encoding='utf-8')[:500])
PY
```

JS/前端/Node 变动：

```bash
npm run test
npm run build
```

Python OCR 变动：

```bash
.venv/bin/python -m unittest discover ocr_service
.venv/bin/python -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8791
```

联调检查：

```bash
curl -sS http://127.0.0.1:8787/api/health
```

真实功能还需要用截图验证：

- 表格截图：`/api/recognize-table`
- 聊天截图本地 OCR：`/api/recognize-chat`
- 聊天截图 Qwen OCR：`/api/recognize-chat-qwen`
- 异常投注文本：`/api/assist-bet-parsing`

## 11. 云服务器部署背景

- 服务器 IP：`36.213.128.58`
- SSH 用户名：`root`
- SSH 端口：`22`
- 服务器项目目录：`/opt/mark-six`
- PM2 应用名：
  - `mark-six-api`
  - `mark-six-ocr`

旧 Windows 本机私钥路径记录为：

```text
C:\Users\May\.ssh\mark_six_deploy
```

这个路径只适用于旧设备。迁移到 Mac mini 后，需要在 Mac 上单独配置 SSH key，例如 `~/.ssh/mark_six_deploy`，并设置权限：

```bash
chmod 600 ~/.ssh/mark_six_deploy
```

同步到服务器时不要上传：

- `.env`
- `.venv/`
- `node_modules/`
- `dist/` 以外的旧构建缓存
- `.git/`
- 日志
- 本地或生产 `server/data/*.json`，除非明确是在做数据迁移

服务器常用验证命令：

```bash
cd /opt/mark-six
npm install
npm run test
npm run build
pm2 restart mark-six-api mark-six-ocr --update-env
pm2 status
curl -sS http://127.0.0.1:8787/api/health
```

## 12. 新 AI 接手时优先阅读

1. 先读本文件，确认项目边界和当前能力。
2. 再读 `AGENTS.md`，其中有更细的历史项目说明，但部分内容可能落后于当前代码。
3. 看 `package.json` 确认命令。
4. 看 `.env.example` 确认最新环境变量。
5. 改业务逻辑前读 `src/lib/lottery.js` 和相关测试。
6. 改服务接口前读 `server/index.js` 和 `server/api.test.js`。
7. 改 OCR 前读 `ocr_service/app.py`、`ocr_service/ocr_engine.py`、`ocr_service/table_recognizer.py`、`ocr_service/chat_recognizer.py`。

一句话提醒：这个项目最重要的是保持“本地规则算金额、AI 只做辅助、运行数据不进仓库、中文保持 UTF-8”。
