const QWEN_CHAT_OCR_PROMPT = `请只转写图片中绿色微信聊天气泡里的文字。
保持原始顺序、原始换行、原始标点、数字和金额。
不要解释，不要总结，不要改写，不要自动纠错。
忽略顶部状态栏、标题、头像、底部输入栏和非聊天气泡内容。
如果有看不清的地方，用 [不确定: 原样猜测] 标记。
只返回纯文本。`;

function getQwenConfig(env) {
  return {
    apiKey: env.QWEN_API_KEY || env.DASHSCOPE_API_KEY || '',
    baseUrl: env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: env.QWEN_OCR_MODEL || 'qwen-vl-ocr-latest',
    timeoutMs: Number(env.QWEN_OCR_TIMEOUT_MS || env.OCR_TIMEOUT_MS || 300000),
  };
}

async function readQwenJson(response) {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error('Qwen OCR 没有返回内容');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Qwen OCR 返回的不是 JSON：${text.slice(0, 160)}`);
  }
}

function extractQwenText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }

  return '';
}

const zodiacChars = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const chineseAmountChars = '一二三四五六七八九十百佰两俩';

function stripQwenUiPrefix(line) {
  return String(line || '')
    .replace(/^\s*\d{1,2}:\d{2}(?:[.:]\d{1,3})?\s*(?:文件传输助手|file transfer assistant)\s*\d*\s*/iu, '')
    .replace(/^\s*(?:文件传输助手|file transfer assistant)\s*\d*\s*/iu, '');
}

function isQwenUiNoiseLine(line) {
  const compact = String(line || '').replace(/\s+/g, '');
  if (!compact) return true;
  if (/^\d{1,2}:\d{2}(?:[.:]\d{1,3})?$/.test(compact)) return true;
  if (/^文件传输助手\d*$/i.test(compact)) return true;
  return false;
}

function normalizeQwenOcrSpacing(line) {
  return String(line || '')
    .replace(/\s+/g, '')
    .replace(/((?:每组|各下|各|买|=|\/)[\d一二三四五六七八九十百佰两俩块元]+)(?=\d{2}[.+-])/g, '$1\n')
    .replace(/[，；;]/g, '，')
    .replace(/([/=])，/g, '$1')
    .replace(/，([/=])/g, '$1');
}

function splitDenseQwenLine(line) {
  const compact = normalizeQwenOcrSpacing(stripQwenUiPrefix(line));
  if (!compact || isQwenUiNoiseLine(compact)) return [];

  const markerPattern = new RegExp([
    '澳门彩特码',
    '香港特码',
    '平特',
    `(?:[${zodiacChars}]{2,}复[${chineseAmountChars}\\d]+[^，\\n]{0,8}各[${chineseAmountChars}\\d]+)`,
    `(?:[${zodiacChars}]+号各[${chineseAmountChars}\\d]+)`,
    `(?:[${zodiacChars}]+一码\\d+)`,
    '(?:\\d{1,2}买\\d+)',
    '(?:(?:\\d{1,2}[-.]{1,2}){2,}\\d{1,2}(?=[^，\\n]{0,24}(?:复|各|/|=|买)))',
  ].join('|'), 'g');

  return compact
    .replace(markerPattern, '\n$&')
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => part && !isQwenUiNoiseLine(part));
}

function normalizeQwenChatText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .flatMap(splitDenseQwenLine)
    .join('\n')
    .trim();
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function recognizeChatWithQwen({ env = process.env, fetchImpl = fetch, imageBase64, mimeType = 'image/jpeg' }) {
  const config = getQwenConfig(env);
  if (!config.apiKey) {
    throw new Error('未配置 QWEN_API_KEY');
  }

  const normalizedMimeType = mimeType || 'image/jpeg';
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: QWEN_CHAT_OCR_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${normalizedMimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    },
    config.timeoutMs,
  );
  const payload = await readQwenJson(response);

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Qwen OCR 请求失败：HTTP ${response.status}`);
  }

  const rawText = extractQwenText(payload);
  const normalizedText = normalizeQwenChatText(rawText);

  return {
    ok: true,
    provider: 'qwen',
    model: config.model,
    text: normalizedText,
    rawText,
  };
}
