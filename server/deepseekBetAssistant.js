import { parseBetGroups, validateAiBetCandidate } from '../src/lib/lottery.js';
import { getRecentParsingSamples } from './parsingSamples.js';

const defaultBaseUrl = 'https://api.deepseek.com';
const defaultFlashModel = 'deepseek-v4-flash';
const defaultProModel = 'deepseek-v4-pro';
const maxProFallbackTextLength = 180;
const maxProFallbackLineCount = 4;
const maxProFallbackItemCount = 3;

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

function formatParsingSamplesForPrompt(samples = []) {
  if (!samples.length) return '';

  const lines = ['历史人工校正样本：'];
  samples.slice(0, 10).forEach((sample, index) => {
    lines.push(
      `${index + 1}. 原文：${String(sample.sourceText || '').slice(0, 160)}`,
      `   模式：${sample.mode}`,
      `   规范文本：${String(sample.normalizedText || '').slice(0, 160)}`,
      `   校验式：${String(sample.formula || '').slice(0, 120)}`,
    );
  });
  return lines.join('\n');
}

function buildPrompt(sourceTexts, modeTexts, parsingSamples = []) {
  const samplePrompt = formatParsingSamplesForPrompt(parsingSamples);
  return [
    '你是 OCR 行文本结构化助手。只处理无法被规则确定分类或可能有多解释冲突的短文本。',
    '不要计算汇总结果，不要补造原文不存在的项目，不要输出 Markdown。',
    '你只能输出 JSON object，格式：{"items":[{"sourceText":"原文","needsPro":false,"candidates":[{"mode":"pingma|lianma|numberFushi|zodiacFushi","normalizedText":"本地规则可解析的规范文本","reason":"简短理由","confidence":0.0,"warnings":[]}]}]}',
    'mode 只能是 pingma、lianma、numberFushi、zodiacFushi。',
    'normalizedText 必须保留原文中的编号、中文类别、结构名称、尾部数值。无法判断或多解释冲突时 candidates 为空，并设置 needsPro true。',
    'pingma 规则：mode=pingma 时 normalizedText 固定输出为 01.02.03/100 这种 slash 格式；编号必须补零为 01-49；逗号、句号、横杆、多点号、空格、换行都只是编号分隔符。',
    'pingma 数值规则：/100、各100、每个100 都表示前面同一组编号逐项对应 100；一个数值只作用于它前面同一组编号；如果有编号缺少对应数值，不猜测，candidates 为空并设置 needsPro true。',
    '尾数规则：三尾、九尾、三九尾、3尾9尾等表示尾数对应的全部 01-49 编号，必须展开成 pingma slash 格式；0尾=10.20.30.40，1尾=01.11.21.31.41，2尾=02.12.22.32.42，3尾=03.13.23.33.43，4尾=04.14.24.34.44，5尾=05.15.25.35.45，6尾=06.16.26.36.46，7尾=07.17.27.37.47，8尾=08.18.28.38.48，9尾=09.19.29.39.49。',
    'pingma 示例：原文 1，2....3各100 => normalizedText 01.02.03/100；原文 1-2-3-4/20 => normalizedText 01.02.03.04/20；原文 01.02.03/100 04.05 因 04.05 缺少对应数值，不猜测。',
    '已确认口语 pingma 示例：蛇一码10、兔一码5块 => mode=pingma normalizedText=蛇10\\n兔5；鸡猪猴号各二十兔蛇龙号码五十 => mode=pingma normalizedText=鸡20\\n猪20\\n猴20\\n兔50\\n蛇50\\n龙50；11---8026--4--各30 / 16--44--14--38--28各10 => mode=pingma normalizedText=11.08.02.04/30\\n16.44.14.38.28/10。',
    '已确认中文类别 pingma 示例：鼠猴狗一各了各十元 => mode=pingma normalizedText=鼠猴狗一个号10；蛇号各五十 => mode=pingma normalizedText=蛇50；三九尾一个各十元 => mode=pingma normalizedText=03.13.23.33.43.09.19.29.39.49/10。',
    'numberFushi 示例：42-43-44-45-46-47-48-49复试三中三每组各2块 => mode=numberFushi normalizedText=复试三中三各2\\n42.43.44.45.46.47.48.49；21-47-32--13-42复式特碰每组100 => mode=numberFushi normalizedText=复式特碰每组100\\n21.47.32.13.42。',
    'lianma 示例：三连肖，鼠猴羊，100 => mode=lianma normalizedText=三连肖，鼠猴羊，100；二连肖/三连肖/四连肖/五连肖都归到 lianma。',
    '常见规范文本示例：平特一项牛1200；21.47.12.36各50；46.47\\n5.9二中二出50；鸡马虎龙猴蛇\\n一个号20。',
    samplePrompt,
    `待处理原文：${JSON.stringify(sourceTexts)}`,
    `当前输入框文本：${JSON.stringify(modeTexts || {})}`,
  ].filter(Boolean).join('\n');
}

function shouldUsePro(aiPayload, validatedItems) {
  const hasConfirmedCandidate = validatedItems.some((item) => item.status === 'needs_confirm');
  if (!hasConfirmedCandidate) return true;
  return validatedItems.some((item) => item.status !== 'needs_confirm');
}

function isSafeProFallbackText(text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return false;
  if (normalizedText.length > maxProFallbackTextLength) return false;
  return normalizedText.split(/\r?\n/).filter((line) => line.trim()).length <= maxProFallbackLineCount;
}

function collectProFallbackSourceTexts(flashItems, originalSourceTexts) {
  const unresolvedTexts = flashItems
    .filter((item) => item.status !== 'needs_confirm')
    .map((item) => normalizeIssueSourceText(item))
    .filter(Boolean);

  const sourceTexts = unresolvedTexts.length ? unresolvedTexts : originalSourceTexts;
  const fallbackTexts = [...new Set(sourceTexts.map((text) => String(text || '').trim()).filter(isSafeProFallbackText))];
  return fallbackTexts.length <= maxProFallbackItemCount ? fallbackTexts : [];
}

function normalizeIssueSourceText(issue) {
  return String(issue?.sourceText || issue?.source_text || '').trim();
}

function mergeAiReviewItems(primaryItems, fallbackItems) {
  const fallbackBySource = new Map(
    fallbackItems
      .map((item) => [normalizeIssueSourceText(item), item])
      .filter(([source]) => source),
  );
  const usedFallbackSources = new Set();

  const mergedItems = primaryItems.map((item, index) => {
    if (item.status === 'needs_confirm') return item;

    const sourceText = normalizeIssueSourceText(item);
    const fallbackItem = sourceText ? fallbackBySource.get(sourceText) : fallbackItems[index];
    if (!fallbackItem) return item;

    if (sourceText) usedFallbackSources.add(sourceText);
    return fallbackItem.status === 'needs_confirm' || fallbackItem.status === 'needs_mode' ? fallbackItem : item;
  });

  fallbackItems.forEach((item) => {
    const sourceText = normalizeIssueSourceText(item);
    if (sourceText && usedFallbackSources.has(sourceText)) return;
    if (!primaryItems.some((primary) => normalizeIssueSourceText(primary) === sourceText)) {
      mergedItems.push(item);
    }
  });

  return mergedItems.map((item, index) => ({
    ...item,
    id: `ai-issue-${index + 1}`,
  }));
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

async function callDeepSeek({ env, fetchImpl, model, sourceTexts, modeTexts, parsingSamples = [] }) {
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
          content: '你只输出 JSON object，不直接决定最终汇总结果。',
        },
        {
          role: 'user',
          content: buildPrompt(sourceTexts, modeTexts, parsingSamples),
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

async function assistBetParsing({ env, fetchImpl = fetch, sourceTexts = [], modeTexts = {}, parsingSamplesPath = '' }) {
  const normalizedSourceTexts = normalizeSourceTexts(sourceTexts, modeTexts);
  if (!normalizedSourceTexts.length) {
    return { ok: true, modelUsed: '', items: [] };
  }

  const parsingSamples = parsingSamplesPath ? await getRecentParsingSamples(parsingSamplesPath, 8) : [];
  const flashModel = env.DEEPSEEK_FLASH_MODEL || defaultFlashModel;
  const proModel = env.DEEPSEEK_PRO_MODEL || defaultProModel;
  const flashPayload = await callDeepSeek({
    env,
    fetchImpl,
    model: flashModel,
    sourceTexts: normalizedSourceTexts,
    modeTexts,
    parsingSamples,
  });
  const flashItems = validateAiPayload(flashPayload, flashModel);

  if (!shouldUsePro(flashPayload, flashItems)) {
    return { ok: true, modelUsed: flashModel, items: flashItems };
  }

  const proSourceTexts = collectProFallbackSourceTexts(flashItems, normalizedSourceTexts);
  if (!proSourceTexts.length) {
    return { ok: true, modelUsed: flashModel, items: flashItems };
  }

  const proPayload = await callDeepSeek({
    env,
    fetchImpl,
    model: proModel,
    sourceTexts: proSourceTexts,
    modeTexts: {},
    parsingSamples,
  });
  return {
    ok: true,
    modelUsed: proModel,
    items: mergeAiReviewItems(flashItems, validateAiPayload(proPayload, proModel)),
  };
}

export { assistBetParsing, buildPrompt };
