# 解析失败样本库优化方案

## 1. 背景

当前系统已经具备四级投注处理流程：

```text
卡密登录
→ 投注输入 / OCR 识别
→ 异常确认
→ 结果汇总
```

现有策略是：本地规则优先解析；本地无法解析、未分类或多解释冲突时，自动调用 DeepSeek 辅助格式化；AI 候选必须再次通过本地 `parseBetGroups` / `validateAiBetCandidate` 校验，才能出现在第三页让用户确认计入。

这个设计保证了金额可信，但真实投注文本格式非常多。即使使用 `deepseek-v4-flash` 和 `deepseek-v4-pro`，仍会遇到大量无法识别或格式化后本地校验失败的文本。

因此，需要新增“解析失败样本库”：

- 用户在第三页看到无法解析项时，可以手动修正。
- 修正后的文本必须通过本地解析器校验，才能计入金额。
- 成功修正的原文和规范文本会保存为样本。
- 后续 DeepSeek prompt 自动带上最近或最相似的样本。
- 高频格式逐步沉淀为本地规则和测试用例。

一句话：**DeepSeek 适合兜底，但高频投注格式一定要沉淀成本地规则和真实样本示例。**

## 2. 目标

### 2.1 功能目标

1. 第三页无法解析项旁边新增“手动修正”按钮。
2. 用户可以为无法解析项选择投注模式：
   - 平码：`pingma`
   - 连码：`lianma`
   - 数字复式：`numberFushi`
   - 生肖复式：`zodiacFushi`
3. 用户填写规范文本，例如：

   ```text
   虎兔龙蛇复四三各50
   ```

4. 系统用本地 `validateAiBetCandidate` 校验该规范文本。
5. 校验通过后：
   - 追加到对应模式输入框。
   - 计入金额预览和最终结果。
   - 将“原文 → 模式 → 规范文本 → 公式预览”保存为失败样本。
6. 后端 DeepSeek prompt 自动注入最近样本和相似样本，提高后续识别率。
7. 把真实失败样本加入 `src/lib/lottery.test.js`，确保以后本地解析能力不会退化。

### 2.2 非目标

V1 不做复杂的在线规则训练，不做向量数据库，不自动把所有样本升级为规则。

V1 也不允许 AI 直接给最终金额。最终金额仍然必须来自本地计算器。

## 3. 核心原则

### 3.1 用户修正也必须本地校验

用户手动填写的规范文本不能直接计入金额，必须走和 AI 候选相同的校验链路：

```text
用户填写 normalizedText
→ validateAiBetCandidate
→ parseBetGroups
→ 生成投注组和公式预览
→ 用户确认
→ 追加到 modeTexts
→ 本地计算金额
```

这样可以避免用户误填格式导致金额污染。

### 3.2 样本只提升识别，不替代规则

失败样本库的作用是：

- 给 DeepSeek 提供真实示例。
- 给开发者提供高频格式证据。
- 为本地规则测试提供样本。

样本本身不应绕过 `parseBetGroups`。即使命中历史样本，也应该输出规范文本，再交给本地解析器计算。

### 3.3 高频样本最终要沉淀为代码规则

如果某类格式反复出现，例如：

```text
虎兔龙蛇复四三各五十
平码05号16号27号一个号各下40
二中二出60
三中三每组40
```

应优先增强 `src/lib/lottery.js` 的规则解析能力，并在 `src/lib/lottery.test.js` 中补测试。这样后续无需再调用 AI，速度更快、成本更低、结果更稳定。

## 4. 用户流程

### 4.1 OCR 或手动输入

用户在第二页上传聊天截图、识别文字，或手动粘贴投注信息。

系统先本地自动分类：

```text
原文
→ classifyBetText / createAutoParseDraft
→ 可解析内容进入 modeTexts
→ 不可解析内容进入 AI 辅助
```

### 4.2 AI 辅助失败

如果 Flash 和 Pro 都无法给出可通过本地校验的候选，第三页显示：

```text
无法解析
原文：虎免龙蛇复四三各五十
原因：AI 候选未通过本地规则校验
[手动修正] [忽略，不计入金额]
```

### 4.3 用户手动修正

点击“手动修正”后，显示一个小表单：

```text
原文：
虎免龙蛇复四三各五十

选择模式：
[平码] [连码] [数字复式] [生肖复式]

规范文本：
虎兔龙蛇复四三各50

[校验] [确认计入]
```

### 4.4 本地校验通过

系统校验后展示：

```text
校验通过
模式：生肖复式
公式：C(4,3) × 50 = 200
规范文本：虎兔龙蛇复四三各50
```

用户确认后：

```text
appendAiCandidateToModeTexts(...)
→ 更新 modeTexts.zodiacFushi
→ 标记该异常项 resolved
→ 保存样本
```

### 4.5 本地校验失败

如果规范文本仍然无法解析：

```text
校验失败：该文本无法被生肖复式解析，请检查玩法、号码和金额。
```

此时不能确认计入，只能继续修改或忽略。

## 5. 前端设计

### 5.1 新增状态

在 `src/App.jsx` 中新增状态：

```js
const [manualFixIssueId, setManualFixIssueId] = useState('');
const [manualFixMode, setManualFixMode] = useState('pingma');
const [manualFixText, setManualFixText] = useState('');
const [manualFixPreview, setManualFixPreview] = useState(null);
const [manualFixError, setManualFixError] = useState('');
const [isSavingParsingSample, setIsSavingParsingSample] = useState(false);
```

### 5.2 第三页异常项操作

对 `status === 'unresolved'` 的异常项新增按钮：

```text
[手动修正]
```

点击后展开修正面板。面板可以内嵌在当前异常卡片中，避免手机端跳转复杂。

### 5.3 修正面板字段

字段：

- 原文：只读。
- 模式：四个按钮或下拉选择。
- 规范文本：textarea。
- 校验结果：公式、金额、解析模式。
- 操作按钮：
  - 校验
  - 确认计入
  - 取消

### 5.4 前端本地校验

调用已有函数：

```js
validateAiBetCandidate({
  mode: manualFixMode,
  normalizedText: manualFixText,
  reason: '用户手动修正',
  modelUsed: 'manual',
  warnings: [],
});
```

校验结果：

- `status === 'needs_confirm'`：允许确认计入。
- 其他状态：显示错误，不允许确认。

### 5.5 确认计入

确认后复用已有追加逻辑：

```js
handleConfirmAiCandidate(issue.id, manualCandidate);
```

然后调用后端保存样本：

```http
POST /api/parsing-samples
```

入参：

```json
{
  "sourceText": "虎免龙蛇复四三各五十",
  "mode": "zodiacFushi",
  "normalizedText": "虎兔龙蛇复四三各50",
  "formula": "C(4,3) × 50 = 200",
  "createdFrom": "manual_fix"
}
```

## 6. 后端设计

### 6.1 新增样本存储模块

新增文件：

```text
server/parsingSamples.js
```

职责：

- 读取样本文件。
- 追加新样本。
- 去重。
- 按时间取最近样本。
- 按文本相似度取相似样本。

### 6.2 样本文件位置

建议使用：

```text
server/data/parsing-samples.json
```

注意：

- `server/data/*.json` 已在 `.gitignore` 中，不会提交真实业务数据。
- 服务器部署时会保留该文件，不应被同步包覆盖删除。

### 6.3 样本结构

```json
{
  "version": 1,
  "samples": [
    {
      "id": "sample_20260518_001",
      "sourceText": "虎免龙蛇复四三各五十",
      "mode": "zodiacFushi",
      "normalizedText": "虎兔龙蛇复四三各50",
      "formula": "C(4,3) × 50 = 200",
      "createdFrom": "manual_fix",
      "createdAt": "2026-05-18T04:00:00.000Z",
      "usageCount": 0,
      "lastUsedAt": null
    }
  ]
}
```

### 6.4 去重策略

保存前计算 key：

```text
mode + normalizedText + sourceText
```

如果完全相同：

- 不重复插入。
- 更新 `lastUsedAt`。
- `usageCount += 1`。

### 6.5 相似度策略 V1

V1 不引入向量数据库，使用轻量文本相似度：

1. 统一文本：
   - 去空格。
   - 中文数字转阿拉伯数字。
   - 常见 OCR 错字归一，例如 `免 → 兔`、`侯 → 猴`、`复试 → 复式`。
2. 提取 token：
   - 数字号码。
   - 生肖。
   - 玩法关键词。
   - 金额。
3. 计算 Jaccard 相似度。

伪代码：

```js
function similarity(a, b) {
  const aTokens = tokenizeSampleText(a);
  const bTokens = tokenizeSampleText(b);
  return intersection(aTokens, bTokens).size / union(aTokens, bTokens).size;
}
```

选择：

- 最近样本：最多 8 条。
- 相似样本：最多 5 条。
- 最终 prompt 注入总数：最多 10 条，避免 prompt 过长。

## 7. API 设计

### 7.1 保存样本

```http
POST /api/parsing-samples
```

权限：

- 复用卡密校验。
- 复用限流或新增轻量限流。

入参：

```json
{
  "sourceText": "虎免龙蛇复四三各五十",
  "mode": "zodiacFushi",
  "normalizedText": "虎兔龙蛇复四三各50",
  "formula": "C(4,3) × 50 = 200",
  "createdFrom": "manual_fix"
}
```

后端必须再次校验：

```js
validateAiBetCandidate({
  mode,
  normalizedText,
  reason: 'manual sample',
  modelUsed: 'manual',
  warnings: [],
});
```

只有校验通过才保存。

返回：

```json
{
  "ok": true,
  "sample": {
    "id": "sample_xxx",
    "mode": "zodiacFushi",
    "normalizedText": "虎兔龙蛇复四三各50"
  }
}
```

### 7.2 查询样本

V1 可选：

```http
GET /api/parsing-samples?query=虎免龙蛇复四三各五十
```

用途：

- 管理调试。
- 后续前端可展示“历史相似修正”。

V1 如果不做管理界面，可以先不暴露该接口，只在后端 DeepSeek prompt 内部使用。

## 8. DeepSeek Prompt 注入策略

### 8.1 当前 Prompt 问题

当前 prompt 只有少量固定示例：

```text
平特一肖牛买1200
21.47.12.36各50
46.47
5.9二中二出50
鸡马虎龙猴蛇
一个号20
```

真实投注格式远多于这些。DeepSeek 遇到本地口语化、OCR 错字、断行混合格式时，容易无法给出本地可解析规范文本。

### 8.2 新 Prompt 结构

后端 `buildPrompt` 改成：

```text
系统角色和硬性规则

固定规范示例

历史人工修正样本：
1. 原文：虎免龙蛇复四三各五十
   模式：zodiacFushi
   规范文本：虎兔龙蛇复四三各50
   说明：OCR 把兔识别成免，金额五十转为50。

2. 原文：平码05号16号27号一个号各下40
   模式：pingma
   规范文本：05号16号27号一个号各下40元
   说明：平码多号码共用金额。

待处理原文：...
当前输入框文本：...
```

### 8.3 注入规则

只注入与当前 `sourceTexts` 相关的样本：

- 优先同玩法关键词。
- 优先包含相同生肖或号码结构。
- 优先最近确认的样本。
- 限制总长度，避免污染 prompt。

### 8.4 模型输出仍需本地校验

即使 DeepSeek 因样本给出更好的结果，也必须继续通过：

```js
validateAiBetCandidate
parseBetGroups
```

不允许因命中样本而直接计入金额。

## 9. 本地规则沉淀策略

样本库不是最终目标。最终目标是减少 AI 调用。

建议定期统计：

- 相同 `normalizedText` 出现次数。
- 相似 `sourceText` 出现次数。
- 同一模式下高频失败原因。

当某类样本出现 3 次以上，就应该考虑写成本地规则。

示例：

```text
虎免龙蛇复四三各五十
虎兔龙蛇复四三各50
虎兔龙蛇复四三每组50
```

可以沉淀为：

- OCR 归一：`免 → 兔`
- 中文数字金额：`五十 → 50`
- 生肖复式口语玩法：`复四三`

对应测试写进：

```text
src/lib/lottery.test.js
```

## 10. 测试计划

### 10.1 `src/lib/lottery.test.js`

新增真实失败样本测试：

```js
it('解析 OCR 错字的生肖复四三人工修正样本', () => {
  const candidate = validateAiBetCandidate({
    mode: 'zodiacFushi',
    normalizedText: '虎兔龙蛇复四三各50',
    reason: '人工修正',
    modelUsed: 'manual',
    warnings: [],
  });

  assert.equal(candidate.status, 'needs_confirm');
  assert.match(candidate.formula, /C\(4,3\).*50/);
});
```

建议加入这些样本：

```text
虎免龙蛇复四三各五十 → 虎兔龙蛇复四三各50
平码05号16号27号一个号各下40 → 05号16号27号一个号各下40元
06.18.29 12.25.44 03.17.39 三中三每组40
09.14 27.33 05.42 二中二出60
鸡马虎龙猴蛇 一个号20
```

### 10.2 `server/parsingSamples.test.js`

测试：

- 保存合法样本。
- 拒绝无法被本地解析器校验的样本。
- 相同样本去重并增加 `usageCount`。
- 能按最近时间取样本。
- 能按文本相似度取样本。

### 10.3 `server/api.test.js`

测试：

- `POST /api/parsing-samples` 需要有效卡密。
- 保存样本时后端再次校验。
- 非法模式返回 400。
- 无效规范文本返回 400。
- `/api/assist-bet-parsing` 会把相似样本传入 DeepSeek prompt。

### 10.4 前端行为测试

如果当前项目暂不引入浏览器测试，可先通过 helper 测试覆盖：

- 手动修正候选能通过 `validateAiBetCandidate`。
- 确认后能追加到正确模式文本。
- unresolved 项手动修正后不再显示为待处理。
- 保存样本失败不影响已经本地确认的计入结果，但要提示用户“样本保存失败”。

## 11. 错误处理

### 11.1 保存样本失败

如果用户确认计入成功，但保存样本失败：

```text
该投注已计入金额，但样本保存失败；下次可能仍需手动修正。
```

原因：

- 金额计算不能因为样本保存失败而回滚。
- 样本库只是学习优化，不是当前计算的唯一依据。

### 11.2 样本文件损坏

后端读取 `parsing-samples.json` 时，如果 JSON 损坏：

- 不影响投注解析主流程。
- 记录错误。
- 返回空样本列表。
- 保存时可以备份损坏文件为：

```text
parsing-samples.corrupt.<timestamp>.json
```

### 11.3 Prompt 注入过长

如果样本过多：

- 限制最多 10 条。
- 限制每条 `sourceText` 和 `normalizedText` 长度。
- 超长样本截断，但不要截断金额和玩法关键词。

## 12. 数据安全

样本可能包含用户投注内容，因此：

- 不提交到 Git。
- 不写入前端构建产物。
- 不在日志中完整打印大量样本。
- 导出样本前应人工确认。
- 服务器同步时不得覆盖生产样本库。

建议 `.gitignore` 保持：

```gitignore
server/data/*.json
```

## 13. 迭代计划

### V1：手动修正和保存样本

- 第三页新增“手动修正”。
- 本地校验通过后计入。
- 后端保存样本。
- DeepSeek prompt 注入最近样本。
- 基础测试覆盖。

### V2：相似样本召回

- 增加文本 token 化。
- 根据当前失败文本召回相似样本。
- prompt 注入相似样本。
- 后端测试覆盖相似度排序。

### V3：样本管理和规则升级

- 管理页查看样本。
- 统计高频失败格式。
- 一键导出开发测试样本。
- 将高频样本沉淀到 `lottery.js` 本地规则。

## 14. 验证命令

本地：

```powershell
npm.cmd run test
npm.cmd run build
```

如果改动包含 OCR Python 逻辑：

```powershell
.\.venv\Scripts\python.exe -m unittest ocr_service.test_chat_recognizer
```

服务器：

```bash
cd /opt/mark-six
npm install
npm run test
npm run build
.venv/bin/python -m unittest ocr_service.test_chat_recognizer
pm2 restart mark-six-api mark-six-ocr --update-env
curl -sS http://127.0.0.1:8787/api/health
pm2 status
```

## 15. 成功标准

该方案完成后，应达到：

- 无法解析项可以由用户手动修正并安全计入。
- 修正过程必须展示本地校验结果和公式预览。
- 每次成功修正都会沉淀为样本。
- 后续类似格式更容易被 DeepSeek 正确格式化。
- 高频样本可以转化为本地规则和测试。
- 总金额仍然只来自本地确定性计算器。
