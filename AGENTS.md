# 项目说明

## 基本信息

- 项目名：`mark-six-workbench`
- 类型：六合彩投注/OCR 识别/派奖计算工作台
- 技术栈：
  - 前端：React 19 + Vite 7 + lucide-react
  - Node 服务：Express 5，负责静态托管和 `/api/*` 转发
  - OCR 服务：FastAPI + RapidOCR + ONNX Runtime + OpenCV
- 主要用途：
  - 上传投注表格截图或聊天截图
  - OCR 识别投注内容
  - 按平码、连码、复式三种模式解析投注
  - 输入开奖号码后计算中奖名单和金额
  - 生成/复制汇报文本

## 目录结构

- `src/`
  - React 前端源码。
  - `App.jsx` 是页面核心，负责 OCR 请求、状态管理和 UI。
  - `main.jsx` 挂载 React 应用。
  - `styles.css` 是全局样式。
  - `lib/lottery.js` 是纯业务逻辑模块，包含投注解析、开奖结果计算、报表生成。
  - `lib/lottery.test.js` 覆盖 `parseBetGroups`、`calculateLotteryResult`、`buildReportText` 和 OCR 文本分类。
  - `lib/tableLayout.js` 保存前端侧表格金额格裁剪比例。
- `server/`
  - `index.js` 是 Express 服务。
  - 提供 `/api/health`、`/api/recognize-table`、`/api/recognize-chat`。
  - 生产环境同时托管 `dist/` 静态文件。
- `ocr_service/`
  - Python FastAPI OCR 服务。
  - `app.py` 定义 OCR HTTP 接口。
  - `ocr_engine.py` 初始化 RapidOCR 引擎。
  - `table_recognizer.py` 识别投注表格金额。
  - `table_layout.py` 读取表格截图布局比例配置。
  - `table_layout.json` 是默认表格截图布局比例配置。
  - `chat_recognizer.py` 识别聊天投注文本。
  - `image_utils.py` 处理 base64 图片、OpenCV 预处理和空白单元格判断。
- `scripts/`
  - `setup-ocr.ps1`：Windows 初始化 Python venv 和 OCR 依赖。
  - `setup-ocr.sh`：Linux/macOS 初始化 Python venv 和 OCR 依赖。
  - `warmup-ocr.py`：预热 OCR 模型。
- `dist/`
  - Vite 构建产物，不要手改。
- `node_modules/`
  - npm 依赖，不要手改。
- `.env.example`
  - 环境变量示例。
- `ecosystem.config.cjs`
  - PM2 部署配置，默认部署目录是 `/opt/mark-six`。

## 常用命令

```powershell
npm install
npm run ocr:setup
npm run start
npm run test
npm run build
npm run preview
```

- `npm run dev`：只启动 Vite 前端，监听 `0.0.0.0`。
- `npm run server`：只启动 Node/Express 服务，默认端口 `8787`。
- `npm run start`：用 `concurrently` 同时启动 Node 服务和 Vite。
- `npm run test`：使用 Node 内置 test runner 跑单元测试。
- `npm run build`：构建前端到 `dist/`。
- `npm run preview`：预览构建产物，监听 `127.0.0.1`。
- OCR 服务需要单独跑 FastAPI，例如：

```powershell
.\.venv\Scripts\python.exe -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8791
```

## 环境变量

`.env.example` 当前字段：

```ini
PORT=8787
OCR_PORT=8791
OCR_SERVICE_URL=http://127.0.0.1:8791
NODE_ENV=production
MAX_IMAGE_MB=12
OCR_TIMEOUT_MS=90000
TABLE_LAYOUT_CONFIG=ocr_service/table_layout.json
```

- `PORT`：Node 服务端口，默认 `8787`。
- `OCR_PORT`：OCR 服务端口，默认 `8791`。
- `OCR_SERVICE_URL`：Node 转发到的 OCR 服务地址。
- `MAX_IMAGE_MB`：Express JSON body 大小上限，默认 `12mb`。
- `OCR_TIMEOUT_MS`：Node 调 OCR 的超时时间，默认 `90000ms`。
- `TABLE_LAYOUT_CONFIG`：Python OCR 表格布局配置路径，可指向自定义 JSON。

## HTTP 接口

Node/Express：

- `GET /api/health`
  - 检查 Node API 和 OCR 服务。
  - 会请求 OCR 服务 `/health`。
- `POST /api/recognize-table`
  - 入参：`{ imageBase64, mimeType? }`
  - 转发到 OCR 服务 `/recognize/table`。
- `POST /api/recognize-chat`
  - 入参：`{ imageBase64, mimeType? }`
  - 转发到 OCR 服务 `/recognize/chat`。

OCR/FastAPI：

- `GET /health`
  - 初始化/检查 RapidOCR。
- `POST /recognize/table`
  - 返回结构包含 `ok`、`bets`、`text`、`confidence`、`lowConfidence`。
- `POST /recognize/chat`
  - 返回结构包含 `ok`、`text`、`rawText`。

## 前端关键逻辑

纯业务逻辑在 `src/lib/lottery.js`：

- 号码范围固定为 `01` 到 `49`。
- `zodiacNumberMap` 保存生肖到号码的映射。
- 支持三种投注模式：
  - `pingma`：平码
  - `lianma`：连码
  - `fushi`：复式
- 主要解析函数：
  - `parseBetNumbers`
  - `parseSlashBetGroups`
  - `parseChineseBetGroups`
  - `parseZodiacBetGroups`
  - `parseFushiBetGroups`
  - `parseFushiBetBlocks`
  - `parseManualComboBlocks`
  - `parseBetGroups`
- `src/App.jsx` 保留浏览器/页面相关逻辑：
  - `compressImageForRecognition` 会在前端压缩图片后再提交。
  - `postRecognitionRequest` 调 `/api/recognize-table` 或 `/api/recognize-chat`。
  - 调用 `classifyBetText` 把聊天 OCR 文本分类到平码/连码/复式。
- 计算与报表：
  - `calculateLotteryResult` 计算中奖结果。
  - `buildReportText` 生成复制用汇报文本。

## OCR 表格识别逻辑

`ocr_service/table_recognizer.py` 的处理方式：

- `MARK_SIX_NUMBERS` 固定为 `01` 到 `49`。
- `amount_cell_rect(image, number)` 按 `table_layout.json` 的布局比例估算每个号码对应的金额单元格。
- `_recognize_full_table` 先对整张图跑 OCR，用文本框中心点落在哪个金额单元格来归属金额。
- `recognize_table` 会对低置信度或漏识别的格子再裁剪单元格二次识别。
- `is_blank_cell` 用墨迹比例和暗像素比例跳过空白格。
- 低置信度阈值：
  - `FAST_CONFIDENCE_THRESHOLD = 0.95`
  - `VERIFY_MIN_CONFIDENCE = 0.55`
  - 低于 `0.85` 的识别项会进入 `lowConfidence`。

注意：表格识别非常依赖截图布局比例。默认参数在 `ocr_service/table_layout.json`，可以通过 `TABLE_LAYOUT_CONFIG` 指向另一份 JSON 来适配新截图模板。

## OCR 聊天识别逻辑

`ocr_service/chat_recognizer.py`：

- RapidOCR 输出按文本框 y/x 坐标排序，并把同一行附近文本合并。
- `clean_chat_text` 会去空格、统一部分标点，并只保留疑似投注内容的行。
- 关键词包含：号码、各下/各押/各买、平码/平马、连码、复试/复式、二中二、二中三、三中三、生肖等。

## 样式和界面

- 样式集中在 `src/styles.css`。
- 页面是工作台布局，不是营销页。
- 主要区域：
  - 顶部标题/版本
  - 模式 tab
  - 截图上传/OCR 操作
  - 文本输入
  - 开奖信息
  - 金额汇总
  - 中奖名单和复制汇报
- 样式偏紧凑工作台：白色面板、绿色主按钮、黄色 OCR 次按钮。
- 已做响应式：`1120px` 和 `760px` 断点。

## 编码/乱码注意

- 当前部分 JS/HTML/日志内容在 PowerShell 默认读取时会显示乱码。
- `rg` 和 Python 文件里能看到较多正常中文，说明不要轻易用非 UTF-8 工具重写文件。
- 改中文文案时优先确保保存为 UTF-8。
- `server/index.js` 里部分中文错误信息当前看起来已经是乱码，修复时要统一检查整文件编码和实际浏览器显示。

## 不要改的东西

- 不要手改 `dist/`，它是构建产物。
- 不要手改 `node_modules/`。
- 不要把 `.env`、日志、`.venv`、模型文件提交。
- `.gitignore` 已忽略：
  - `node_modules`
  - `dist`
  - `.venv`
  - `models`
  - `ocr_service/__pycache__`
  - `.vite`
  - `*.log`
  - `.env`

## 部署信息

`ecosystem.config.cjs` 使用 PM2：

- `mark-six-api`
  - 启动 `server/index.js`
  - `PORT=8787`
  - `OCR_SERVICE_URL=http://127.0.0.1:8791`
- `mark-six-ocr`
  - 启动 `.venv/bin/python -m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8791`
- 默认 `cwd` 是 `/opt/mark-six`，如果本地或服务器目录不同要改。

## 云服务器

- 服务器 IP：`36.213.128.58`
- SSH 用户名：`root`
- SSH 端口：`22`
- 登录方式：私钥
- 本机私钥路径：`C:\Users\May\.ssh\mark_six_deploy`（只记录路径，不要把私钥内容写入仓库）
- 服务器项目目录：`/opt/mark-six`
- PM2 应用名：
  - `mark-six-api`
  - `mark-six-ocr`

每次本地项目有代码、配置、文档或构建相关变动，都要同步到服务器 `/opt/mark-six`，然后按需执行：

```bash
npm install
npm run test
npm run build
pm2 restart mark-six-api mark-six-ocr
pm2 status
```

同步时不要上传 `.env`、`.venv`、`node_modules`、旧日志、`.git` 等本地私有或可再生成内容。

## 当前仓库状态

- 这是一个 Git 仓库，但当前大部分项目文件处于未跟踪状态。
- `AGENTS.md` 原本为空，本文件是根据当前目录通读后整理的项目说明。
- 当前验证方式：
  - `npm run test`
  - `npm run build`
  - 启动 OCR 服务后访问 `/api/health`
  - 用真实截图跑 `/api/recognize-table` 和 `/api/recognize-chat`
