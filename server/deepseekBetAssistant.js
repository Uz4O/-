import { parseBetGroups, validateAiBetCandidate } from '../src/lib/lottery.js';

const defaultBaseUrl = 'https://api.deepseek.com';
const defaultFlashModel = 'deepseek-v4-flash';
const defaultProModel = 'deepseek-v4-pro';

function parseJsonObject(text, label) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not_object');
    }
    return value;
  } catch {
    throw new Error(`${label} 返回的不是有效 JSON`);
  }
}

function modeTextHasParsedAmount(mode, text) {
  const groups = parseBetGroups(text, mode);
  return groups.reduce((sum, group) => sum + group.betAmount, 0) > 0;
}

function collectUnparsedModeTexts(modeTexts) {
  return Object.entries(modeTexts || {})
    .filter(([mode, text]) => String(text || '').trim() && !modeTextHasParsedAmount(mode, text))
    .map(([, text]) => text);
}

function normalizeSourceTexts(sourceTexts, modeTexts) {
  const texts = [...(Array.isArray(sourceTexts) ? sourceTexts : []), ...collectUnparsedModeTexts(modeTexts)]
    .map((text) => String(text || '').trim())
    .filter(Boolean);
  return [...new Set(texts)].slice(0, 30);
}

function buildPrompt(sourceTexts, modeTexts) {
  return [
    '你是六合彩投注文本标准化助手。只处理无法被规则确定分类或可能有多解释冲突的投注文本。',
    '不要计算最终金额，不要编造投注，不要输出 Markdown。',
    '你只能输出 JSON object，格式：{"items":[{"sourceText":"原文","needsPro":false,"candidates":[{"mode":"pingma|lianma|numberFushi|zodiacFushi","normalizedText":"本地规则可解析的规范文本","reason":"简短理由","confidence":0.0,"warnings":[]}]}]}',
    'mode 只能是 pingma、lianma、numberFushi、zodiacFushi。',
    'normalizedText 必须保留号码、生肖、玩法、金额。无法判断或多解释冲突时 candidates 为空，并设置 needsPro true。',
    '常见规范文本示例：平特一肖牛买1200；21.47.12.36各50；46.47\\n5.9二中二出50；鸡马虎龙猴蛇\\n一个号20。',
    `待处理原文：${JSON.stringify(sourceTexts)}`,
    `当前输入框文本：${JSON.stringify(modeTexts || {})}`,
  ].join('\n');
}

function shouldUsePro(aiPayload, validatedItems) {
  const items = Array.isArray(aiPayload.items) ? aiPayload.items : [];
  if (items.some((item) => item?.needsPro === true || item?.needs_pro === true)) return true;
  if (!validatedItems.some((item) => item.status === 'needs_confirm')) return true;
  return validatedItems.some((item) => item.status === 'needs_mode');
}

function validateAiPayload(aiPayload, modelUsed) {
  const items = Array.isArray(aiPayload.items) ? aiPayload.items : [];
  if (!items.length) {
    return [
      {
        id: 'ai-issue-1',
        sourceText: '',
        status: 'unresolved',
        message: 'AI 没有返回候选解释',
        candidates: [],
      },
    ];
  }

  return items.map((item, itemIndex) => {
    const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
    const validatedCandidates = candidates.map((candidate) =>
      validateAiBetCandidate({
        ...candidate,
        modelUsed,
      }),
    );
    const confirmCandidates = validatedCandidates.filter((candidate) => candidate.status === 'needs_confirm');
    const unresolvedCandidates = validatedCandidates.filter((candidate) => candidate.status !== 'needs_confirm');
    const sourceText = String(item?.sourceText || item?.source_text || '').trim();

    if (confirmCandidates.length === 1 && !item?.needsPro && !item?.needs_pro) {
      return {
        id: `ai-issue-${itemIndex + 1}`,
        sourceText,
        status: 'needs_confirm',
        message: confirmCandidates[0].message,
        candidates: confirmCandidates,
      };
    }

    if (confirmCandidates.length > 1) {
      return {
        id: `ai-issue-${itemIndex + 1}`,
        sourceText,
        status: 'needs_mode',
        message: '存在多个可解析候选，请选择模式后确认',
        candidates: confirmCandidates,
      };
    }

    return {
      id: `ai-issue-${itemIndex + 1}`,
      sourceText,
      status: 'unresolved',
      message: item?.needsPro || item?.needs_pro ? 'Flash 无法判断，需 Pro 复核' : 'AI 候选未通过本地规则校验',
      candidates: unresolvedCandidates,
    };
  });
}

async function callDeepSeek({ env, fetchImpl, model, sourceTexts, modeTexts }) {
  const apiKey = String(env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY，无法使用 AI 辅助解析');

  const baseUrl = String(env.DEEPSEEK_BASE_URL || defaultBaseUrl).replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你只输出 JSON object，不直接决定最终金额。',
        },
        {
          role: 'user',
          content: buildPrompt(sourceTexts, modeTexts),
        },
      ],
      temperature: 0.1,
    }),
  });
  const text = await response.text();
  const payload = parseJsonObject(text, 'DeepSeek 接口');
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || 'DeepSeek 接口调用失败');
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 没有返回候选内容');
  return parseJsonObject(content, model);
}

async function assistBetParsing({ env, fetchImpl = fetch, sourceTexts = [], modeTexts = {} }) {
  const normalizedSourceTexts = normalizeSourceTexts(sourceTexts, modeTexts);
  if (!normalizedSourceTexts.length) {
    return { ok: true, modelUsed: '', items: [] };
  }

  const flashModel = env.DEEPSEEK_FLASH_MODEL || defaultFlashModel;
  const proModel = env.DEEPSEEK_PRO_MODEL || defaultProModel;
  const flashPayload = await callDeepSeek({
    env,
    fetchImpl,
    model: flashModel,
    sourceTexts: normalizedSourceTexts,
    modeTexts,
  });
  const flashItems = validateAiPayload(flashPayload, flashModel);

  if (!shouldUsePro(flashPayload, flashItems)) {
    return { ok: true, modelUsed: flashModel, items: flashItems };
  }

  const proPayload = await callDeepSeek({
    env,
    fetchImpl,
    model: proModel,
    sourceTexts: normalizedSourceTexts,
    modeTexts,
  });
  return {
    ok: true,
    modelUsed: proModel,
    items: validateAiPayload(proPayload, proModel),
  };
}

export { assistBetParsing };
