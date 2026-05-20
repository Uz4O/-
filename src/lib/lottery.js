const zodiacNumberMap = {
  马: ['01', '13', '25', '37', '49'],
  蛇: ['02', '14', '26', '38'],
  龙: ['03', '15', '27', '39'],
  兔: ['04', '16', '28', '40'],
  虎: ['05', '17', '29', '41'],
  牛: ['06', '18', '30', '42'],
  鼠: ['07', '19', '31', '43'],
  猪: ['08', '20', '32', '44'],
  狗: ['09', '21', '33', '45'],
  鸡: ['10', '22', '34', '46'],
  猴: ['11', '23', '35', '47'],
  羊: ['12', '24', '36', '48'],
};

const initialSummary = {
  totalBetAmount: 0,
  totalWinAmount: 0,
  entryCount: 0,
  groupCount: 0,
};

const appVersion = 'OCR分类 2026-05-12 16:24';

const initialModeTexts = {
  pingma: '',
  lianma: '',
  numberFushi: '',
  zodiacFushi: '',
  fushi: '',
};

const unsupportedComboTypes = new Set(['二中三']);
const zodiacChars = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const zodiacInputChars = `${zodiacChars}侯`;
const currentYearZodiac = '马';
const lianxiaoOdds = {
  2: { normal: 4, currentYear: 3.4 },
  3: { normal: 11, currentYear: 9 },
  4: { normal: 31, currentYear: 28 },
  5: { normal: 100, currentYear: 85 },
};
const lianxiaoPickLabels = {
  2: '二连肖',
  3: '三连肖',
  4: '四连肖',
  5: '五连肖',
};
const chineseDigitMap = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const chineseAmountAliases = {
  佰: 100,
  百: 100,
};

const betModes = [
  {
    id: 'pingma',
    label: '平码',
    title: '批量粘贴平码信息',
    placeholder: '',
  },
  {
    id: 'lianma',
    label: '连码',
    title: '批量粘贴连码单式',
    placeholder: '',
  },
  {
    id: 'numberFushi',
    label: '数字复式',
    title: '批量粘贴数字复式',
    placeholder: '',
    parseMode: 'fushi-number',
  },
  {
    id: 'zodiacFushi',
    label: '生肖复式',
    title: '批量粘贴生肖复式',
    placeholder: '',
    parseMode: 'fushi-zodiac',
  },
];

const calculationBetModes = [...betModes, { id: 'fushi', parseMode: 'fushi' }];

const markSixNumbers = Array.from({ length: 49 }, (_, index) => String(index + 1).padStart(2, '0'));

function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeMarkSixNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 49) return '';
  return String(number).padStart(2, '0');
}

function getZodiacByNumber(value) {
  const normalizedNumber = normalizeMarkSixNumber(value);
  if (!normalizedNumber) return '';

  return (
    Object.entries(zodiacNumberMap).find(([, numbers]) => numbers.includes(normalizedNumber))?.[0] || ''
  );
}

function normalizeZodiacText(text) {
  return String(text || '').replace(/[侯候]/g, '猴');
}

function expandCompactMarkSixNumberRuns(text) {
  function getValidNumbers(digits) {
    const numbers = digits.match(/\d{2}/g) || [];
    return numbers.every((number) => normalizeMarkSixNumber(number)) ? numbers : [];
  }

  function removeSingleDuplicateDigit(digits) {
    const candidates = new Set();
    for (let index = 1; index < digits.length; index += 1) {
      if (digits[index] !== digits[index - 1]) continue;
      const candidate = `${digits.slice(0, index)}${digits.slice(index + 1)}`;
      if (candidate.length % 2 === 0 && getValidNumbers(candidate).length) {
        candidates.add(candidate);
      }
    }
    return candidates.size === 1 ? [...candidates][0] : '';
  }

  return String(text || '').replace(/(?<digits>\d{4,})(?:(?<gap>[ \t]+)(?<next>\d{2})(?=\D|$))?/g, (match, digits, gap, next) => {
    if (digits.length < 4) return match;

    let numberDigits = digits;
    let suffix = '';
    let separator = '';
    if (numberDigits.length % 2 === 0) {
      suffix = next || '';
      separator = gap || '';
    } else {
      const duplicateDigitFix = removeSingleDuplicateDigit(numberDigits);
      if (duplicateDigitFix) {
        numberDigits = duplicateDigitFix;
        suffix = next || '';
        separator = gap || '';
      } else {
        if (!next || numberDigits.at(-1) !== next[0]) return match;
        numberDigits = numberDigits.slice(0, -1);
        suffix = next;
        separator = gap;
      }
    }

    const numbers = getValidNumbers(numberDigits);
    if (!numbers.length) return match;

    return `${numbers.join(' ')}${suffix ? `${separator}${suffix}` : ''}`;
  });
}

function normalizeCompactMarkSixNumberRuns(text) {
  return expandCompactMarkSixNumberRuns(text);
}

function parseBetNumbers(text) {
  return expandCompactMarkSixNumberRuns(text)
    .split(/\D+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map(normalizeMarkSixNumber)
    .filter(Boolean);
}

function combinationCount(total, pick) {
  if (total < pick || pick <= 0) return 0;
  let result = 1;
  for (let index = 1; index <= pick; index += 1) {
    result = (result * (total - index + 1)) / index;
  }
  return result;
}

function buildCombinations(items, pick) {
  const combos = [];

  function visit(startIndex, selected) {
    if (selected.length === pick) {
      combos.push(selected);
      return;
    }

    for (let index = startIndex; index <= items.length - (pick - selected.length); index += 1) {
      visit(index + 1, [...selected, items[index]]);
    }
  }

  visit(0, []);
  return combos;
}

function parseChineseInteger(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  if (chineseAmountAliases[value]) return chineseAmountAliases[value];
  if (/^[一二两三四五六七八九]?[百佰]$/.test(value)) {
    const left = value.slice(0, -1);
    return (left ? chineseDigitMap[left] || 0 : 1) * 100;
  }

  if (value === '十') return 10;
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex);
    const right = value.slice(tenIndex + 1);
    const tens = left ? chineseDigitMap[left] : 1;
    const ones = right ? chineseDigitMap[right] : 0;
    return (tens || 0) * 10 + (ones || 0);
  }

  return chineseDigitMap[value] || 0;
}

function getLineUserName(line, lineIndex) {
  const nameMatch = line.match(/^\s*([^0-9/：:，,\s.]{1,16})\s*[：:，,\s]+/);
  return nameMatch?.[1] || `第${lineIndex + 1}行`;
}

function normalizeSlashNumberBeforeAmount(text) {
  return String(text || '').replace(
    /\/\s*(\d{1,2})(?=\s*(?:各下|各押|各买|各|下|押|买)\s*(?:\d|[零一二两三四五六七八九十百佰]))/g,
    '.$1',
  );
}

function hasUnpricedNumberTail(text) {
  const tail = String(text || '')
    .replace(/[。．，,；;]/g, '.')
    .trim();
  if (!tail) return false;
  if (/(?:\/|各下|各押|各买|各|下|押|买)\s*(?:\d|[零一二两三四五六七八九十百佰])/.test(tail)) return false;
  return parseBetNumbers(tail).length > 0;
}

function parseSlashBetGroups(line, lineIndex, userName) {
  const groups = [];
  const groupPattern = /([^/\r\n]+?)\/\s*(\d+)/g;
  let match;
  let lastAmountEnd = 0;

  while ((match = groupPattern.exec(line)) !== null) {
    const numbers = parseBetNumbers(match[1]);
    const amountPerNumber = Number(match[2]);
    lastAmountEnd = groupPattern.lastIndex;

    if (!numbers.length || !amountPerNumber) continue;

    groups.push({
      id: `${lineIndex}-slash-${groups.length}`,
      userName: groups.length ? `${userName} 第${groups.length + 1}组` : userName,
      numbers,
      amountPerNumber,
      betAmount: numbers.length * amountPerNumber,
    });
  }

  if (groups.length && hasUnpricedNumberTail(line.slice(lastAmountEnd))) return [];

  return groups;
}

function parseMultilineSlashBetGroups(rawText) {
  const slashLines = [];
  let previousKeptLine = '';
  let pendingNumberLines = [];
  String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || /[号各下各押各买元特码]/.test(line)) return;
      const isSlashLine = line.includes('/');
      const isContinuationLine = previousKeptLine && /\.\d$/.test(previousKeptLine) && parseBetNumbers(line).length >= 2;
      const isAmountContinuationLine = previousKeptLine && /\/\d{1,2}$/.test(previousKeptLine) && /^\d{1,2}$/.test(line);
      const isPendingNumberLine = !isSlashLine && !isContinuationLine && !isAmountContinuationLine && parseBetNumbers(line).length >= 2;
      if (isPendingNumberLine) {
        pendingNumberLines.push(line);
        return;
      }
      if (!isSlashLine && !isContinuationLine && !isAmountContinuationLine) {
        pendingNumberLines = [];
        return;
      }
      if (isSlashLine && pendingNumberLines.length) {
        if (previousKeptLine) slashLines.push('.');
        slashLines.push(...pendingNumberLines);
        pendingNumberLines = [];
      } else if (isSlashLine && previousKeptLine && !isContinuationLine) {
        slashLines.push('.');
      }
      slashLines.push(line);
      previousKeptLine = line;
    });
  const normalizedText = slashLines
    .join('')
    .replace(/[。．]/g, '.')
    .replace(/[，,]/g, '.');
  const groups = [];
  const groupPattern = /([^/\r\n]+?)\/\s*(\d+)/g;
  let match;
  let lastAmountEnd = 0;

  while ((match = groupPattern.exec(normalizedText)) !== null) {
    const numbers = parseBetNumbers(match[1]);
    const amountPerNumber = Number(match[2]);
    lastAmountEnd = groupPattern.lastIndex;

    if (!numbers.length || !amountPerNumber) continue;

    groups.push({
      id: `multi-slash-${groups.length}`,
      userName: `第${groups.length + 1}组`,
      numbers,
      amountPerNumber,
      betAmount: numbers.length * amountPerNumber,
    });
  }

  if (groups.length && hasUnpricedNumberTail(normalizedText.slice(lastAmountEnd))) return [];

  return groups;
}

function parseInlinePingmaAmountGroups(rawText) {
  if (!hasSlashNumberBeforeAmount(rawText)) {
    return [];
  }

  const normalizedText = normalizeSlashNumberBeforeAmount(rawText)
    .replace(/[。．]/g, '.')
    .replace(/[，,；;]/g, '.')
    .replace(/\s+/g, '');
  const amountPattern =
    /\/(\d+(?:\.\d+)?)(?!\s*(?:各下|各押|各买|各|下|押|买)\s*(?:\d|[零一二两三四五六七八九十百佰]))|(?:一个号|个号|每个号|每号|各号)?(?:各下|各押|各买|各|下|押|买)(\d+(?:\.\d+)?|[零一二两三四五六七八九十百佰]+)元?/g;
  const groups = [];
  let cursor = 0;
  let match;

  while ((match = amountPattern.exec(normalizedText)) !== null) {
    const source = normalizedText.slice(cursor, match.index);
    const numbers = parseBetNumbers(source);
    const amountPerNumber = match[1] ? Number(match[1]) : parseChineseInteger(match[2]);

    if (numbers.length && amountPerNumber) {
      groups.push({
        id: `inline-pingma-${groups.length}`,
        userName: `第${groups.length + 1}组`,
        numbers,
        amountPerNumber,
        betAmount: numbers.length * amountPerNumber,
      });
    }

    cursor = amountPattern.lastIndex;
  }

  return groups;
}

function hasSlashNumberBeforeAmount(rawText) {
  return /\/\s*\d{1,2}\s*(?:各下|各押|各买|各|下|押|买)\s*(?:\d|[零一二两三四五六七八九十百佰])/.test(
    String(rawText || ''),
  );
}

function parseChineseBetGroups(line, lineIndex, userName) {
  const groups = [];
  const normalizedLine = normalizeSlashNumberBeforeAmount(line);
  const groupPattern =
    /([^。；;\r\n]+?)\s*(?:一个号|个号|每个号|每号|各号)?\s*(?:各下|各押|各买|各|下|押|买)\s*(\d+(?:\.\d+)?)\s*元?/g;
  let match;

  while ((match = groupPattern.exec(normalizedLine)) !== null) {
    const numbers = parseBetNumbers(match[1]);
    const amountPerNumber = Number(match[2]);

    if (!numbers.length || !amountPerNumber) continue;

    groups.push({
      id: `${lineIndex}-cn-${groups.length}`,
      userName: groups.length ? `${userName} 第${groups.length + 1}组` : userName,
      numbers,
      amountPerNumber,
      betAmount: numbers.length * amountPerNumber,
    });
  }

  return groups;
}

function parseMultilineChineseBetGroups(rawText) {
  const chineseText = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !line.includes('/') && /号|各下|各押|各买|一个号|个号|每号|下\d|押\d|买\d|元|特码/.test(line))
    .join('.');
  const chineseBetText = chineseText.replace(
    /(?:一个号|个号|每个号|每号|各号)?(?:各下|各押|各买|各|下|押|买)\.(\d+元?)/g,
    (match, amount) => match.replace(`.${amount}`, amount),
  );
  const normalizedText = chineseBetText
    .replace(/\/\s*(\d{1,2})(?=\s*(?:各下|各押|各买|各|下|押|买)\s*\d)/g, '.$1')
    .replace(/[。；;]/g, '.')
    .replace(/[，,]/g, '.')
    .replace(/一\.个号/g, '一个号')
    .replace(/\s+/g, '');
  const groups = [];
  const groupPattern = /(\d+)\s*元/g;
  let match;
  let cursor = 0;

  while ((match = groupPattern.exec(normalizedText)) !== null) {
    const source = normalizedText.slice(cursor, match.index);
    const numbers = parseBetNumbers(source);
    const amountPerNumber = Number(match[1]);

    if (!numbers.length || !amountPerNumber) continue;

    groups.push({
      id: `multi-cn-${groups.length}`,
      userName: `第${groups.length + 1}组`,
      numbers,
      amountPerNumber,
      betAmount: numbers.length * amountPerNumber,
    });

    cursor = groupPattern.lastIndex;
  }

  return groups;
}

function parseZodiacBetGroups(line, lineIndex, userName) {
  const groups = [];
  const zodiacPattern = /(?:^|[，,。；;\s])([鼠牛虎兔龙蛇马羊猴鸡狗猪])\s*(?:各下|各押|各买|各|下|押|买)?\s*(\d+(?:\.\d+)?)\s*元?/g;
  let match;
  const normalizedLine = normalizeZodiacText(line);

  while ((match = zodiacPattern.exec(normalizedLine)) !== null) {
    const zodiac = match[1];
    const amountPerNumber = Number(match[2]);
    const numbers = zodiacNumberMap[zodiac] || [];

    if (!numbers.length || !amountPerNumber) continue;

    groups.push({
      id: `${lineIndex}-zodiac-${groups.length}`,
      userName: groups.length ? `${userName} 第${groups.length + 1}组` : userName,
      numbers,
      amountPerNumber,
      betAmount: numbers.length * amountPerNumber,
      betLabel: zodiac,
    });
  }

  return groups;
}

function parseGroupedZodiacPingmaBetGroups(rawText) {
  const normalizedText = normalizeZodiacText(rawText).replace(/\s+/g, '');
  const amountMatch = normalizedText.match(
    /(?:一个号|个号|每个号|每号|各号)\s*(\d+(?:\.\d+)?|[零一二两三四五六七八九十百佰]+)\s*元?$/,
  );
  if (!amountMatch) return [];

  const amountPerNumber = parseChineseInteger(amountMatch[1]);
  if (!amountPerNumber) return [];

  const source = normalizedText.slice(0, amountMatch.index).replace(/[，,。；;\r\n]+$/, '');
  const chunks = source
    .split(/[，,。；;\r\n]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (!chunks.length || chunks.some((chunk) => !new RegExp(`^[${zodiacChars}]+$`).test(chunk))) return [];

  return chunks.map((chunk, index) => {
    const zodiacs = Array.from(chunk);
    const numbers = zodiacs.flatMap((zodiac) => zodiacNumberMap[zodiac] || []);

    return {
      id: `grouped-zodiac-${index}`,
      userName: `第${index + 1}组`,
      numbers,
      zodiacs,
      amountPerNumber,
      betAmount: numbers.length * amountPerNumber,
      betLabel: zodiacs.join(''),
    };
  });
}

function parseGroupedZodiacFushiBetGroups(rawText) {
  const pingmaGroups = parseGroupedZodiacPingmaBetGroups(rawText);
  const meta = getComboMeta('三中三');
  if (!pingmaGroups.length || !meta) return [];

  return pingmaGroups
    .map((group) => {
      const zodiacs = [...new Set(group.zodiacs || [])];
      const manualCombos = buildCombinations(zodiacs, meta.pickCount);
      if (!manualCombos.length) return null;

      return {
        ...group,
        numbers: zodiacs.flatMap((zodiac) => zodiacNumberMap[zodiac] || []),
        zodiacs,
        manualCombos,
        betAmount: manualCombos.length * group.amountPerNumber,
        betLabel: '三中三',
        betMode: 'manual-combo',
        comboType: '三中三',
        pickCount: meta.pickCount,
        odds: meta.odds,
        comboCount: manualCombos.length,
      };
    })
    .filter(Boolean);
}

function parseZodiacPingteBetGroups(line, lineIndex, userName) {
  const normalizedLine = normalizeZodiacText(line).replace(/\s+/g, '');
  const match = normalizedLine.match(
    new RegExp(`(?:平特|平特一肖|平特肖)([${zodiacChars}又和及、,，.。]+?)(?:各下|各押|各买|各|下|押|买)?(\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十百佰]+)元?$`),
  );
  if (!match) return [];

  const zodiacs = [...new Set(Array.from(match[1]).filter((char) => zodiacChars.includes(char)))];
  const amountPerNumber = parseChineseInteger(match[2]);
  if (!zodiacs.length || !amountPerNumber) return [];

  return [
    {
      id: `${lineIndex}-zodiac-pingte-0`,
      userName,
      numbers: zodiacs,
      zodiacs,
      amountPerNumber,
      betAmount: zodiacs.length * amountPerNumber,
      betLabel: `平特${zodiacs.join('')}`,
    },
  ];
}

function parseFushiBetGroups(line, lineIndex, userName) {
  const groups = [];
  const comboPattern = /(二中[二三]|三中三)\s*([^/，,。；;\r\n]+?)\/\s*(\d+(?:\.\d+)?)/g;
  let match;

  while ((match = comboPattern.exec(line)) !== null) {
    const comboType = match[1];
    const meta = getComboMeta(comboType);
    if (!meta) continue;

    const numbers = [...new Set(parseBetNumbers(match[2]))];
    const amountPerGroup = Number(match[3]);
    const comboCount = combinationCount(numbers.length, meta.pickCount);

    if (!comboCount || !amountPerGroup) continue;

    groups.push({
      id: `${lineIndex}-combo-${groups.length}`,
      userName: groups.length ? `${userName} 第${groups.length + 1}组` : userName,
      numbers,
      amountPerNumber: amountPerGroup,
      betAmount: comboCount * amountPerGroup,
      betLabel: comboType,
      betMode: 'fushi',
      comboType,
      pickCount: meta.pickCount,
      odds: meta.odds,
      comboCount,
    });
  }

  return groups;
}

function parseFushiBetBlocks(rawText) {
  const lines = rawText.split(/\r?\n/);
  const groups = [];
  let activeBlock = null;

  function pushActiveBlock(endLineIndex) {
    if (!activeBlock) return;

    const numbers = [...new Set(activeBlock.numbers)];
    const comboCount = combinationCount(numbers.length, activeBlock.pickCount);

    if (comboCount) {
      groups.push({
        id: `${activeBlock.startIndex}-fushi-block-${groups.length}`,
        userName: `第${activeBlock.startIndex + 1}行 复式${activeBlock.comboType}`,
        numbers,
        amountPerNumber: activeBlock.amountPerGroup,
        betAmount: comboCount * activeBlock.amountPerGroup,
        betLabel: activeBlock.comboType,
        betMode: 'fushi',
        comboType: activeBlock.comboType,
        pickCount: activeBlock.pickCount,
        odds: activeBlock.odds,
        comboCount,
      });
    }

    activeBlock = null;
  }

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) {
      if (activeBlock) return;
      pushActiveBlock(lineIndex);
      return;
    }

    const normalizedLine = line.replace(/^复试/, '复式');
    const comboType = normalizeComboType(normalizedLine);
    const amountPerGroup = comboType ? parseComboAmount(normalizedLine) : 0;
    const startsFushiBlock = comboType && amountPerGroup && !normalizedLine.includes('/');

    if (startsFushiBlock) {
      pushActiveBlock(lineIndex);
      const meta = getComboMeta(comboType);
      if (!meta) return;

      const inlineNumbers = parseComboLineNumbers(normalizedLine, comboType);
      activeBlock = {
        startIndex: lineIndex,
        comboType,
        amountPerGroup,
        numbers: inlineNumbers,
        pickCount: meta.pickCount,
        odds: meta.odds,
      };
      return;
    }

    if (activeBlock && (comboType || normalizedLine.includes('/'))) {
      pushActiveBlock(lineIndex);
      return;
    }

    if (activeBlock) {
      const numbers = parseBetNumbers(line);
      if (numbers.length) {
        activeBlock.numbers.push(...numbers);
        return;
      }

      pushActiveBlock(lineIndex);
    }
  });

  pushActiveBlock(lines.length);
  return groups;
}

function normalizeComboType(value) {
  if (/特碰/.test(value)) return '特碰';
  if (/复四三/.test(value)) return '复四三';
  if (/二中[二三]/.test(value)) return value.match(/二中[二三]/)?.[0] || '';
  if (/三中三/.test(value)) return '三中三';
  return '';
}

function getComboMeta(comboType) {
  if (comboType === '二中二') return { pickCount: 2, odds: 65 };
  if (comboType === '特碰') return { pickCount: 2, odds: 65 };
  if (comboType === '三中三') return { pickCount: 3, odds: 200 };
  if (comboType === '复四三') return { pickCount: 3, odds: 200 };
  return null;
}

function parseLianxiaoBetGroups(line, lineIndex, userName) {
  const normalizedLine = normalizeZodiacText(line).replace(/\s+/g, '');
  const match = normalizedLine.match(
    new RegExp(`([二两三四五])连肖[，,。；;、.]*([${zodiacChars}]+)[，,。；;、.]*(\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十百佰]+)元?$`),
  );
  if (!match) return [];

  const pickCount = parseChineseInteger(match[1]);
  const oddsConfig = lianxiaoOdds[pickCount];
  if (!oddsConfig) return [];

  const zodiacs = [...new Set(Array.from(match[2]).filter((char) => zodiacChars.includes(char)))];
  const amountPerGroup = parseChineseInteger(match[3]);
  if (zodiacs.length !== pickCount || !amountPerGroup) return [];

  const includesCurrentYearZodiac = zodiacs.includes(currentYearZodiac);
  const odds = includesCurrentYearZodiac ? oddsConfig.currentYear : oddsConfig.normal;
  const comboType = lianxiaoPickLabels[pickCount];

  return [
    {
      id: `${lineIndex}-lianxiao-0`,
      userName,
      numbers: zodiacs,
      zodiacs,
      manualCombos: [zodiacs],
      amountPerNumber: amountPerGroup,
      betAmount: amountPerGroup,
      betLabel: comboType,
      betMode: 'lianxiao',
      comboType,
      pickCount,
      odds,
      comboCount: 1,
      includesCurrentYearZodiac,
    },
  ];
}

function isLianxiaoBetLine(line) {
  return parseLianxiaoBetGroups(line, 0, '').length > 0;
}

function parseComboAmount(line) {
  const amountMatch = line.match(
    /(?:每组|各组|一组|每一组|各一组|出|组|各|下|押|买)\s*(\d+(?:\.\d+)?)\s*元?\s*$|(\d+(?:\.\d+)?)\s*元?\s*$/,
  );

  return Number(amountMatch?.[1] || amountMatch?.[2] || 0);
}

function parseComboLineNumbers(line, comboType = '') {
  const numberSource = comboType ? line.slice(0, line.indexOf(comboType)) : line;
  return [...new Set(parseBetNumbers(numberSource))];
}

function parseZodiacFushiBetGroups(line, lineIndex, userName) {
  const normalizedLine = normalizeZodiacText(line).replace(/^复试/, '复式');
  const match = normalizedLine.match(
    new RegExp(`^([${zodiacChars}]{4})\\s*复四三\\s*(?:每组|各组|一组|每一组|各一组|出|组|各|下|押|买)?\\s*(\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十]+)\\s*元?$`),
  );
  if (!match) return [];

  const zodiacs = [...new Set(Array.from(match[1]))];
  const amountPerGroup = parseChineseInteger(match[2]);
  const meta = getComboMeta('复四三');
  if (zodiacs.length !== 4 || !amountPerGroup || !meta) return [];

  const manualCombos = buildCombinations(zodiacs, meta.pickCount);
  return [
    {
      id: `${lineIndex}-zodiac-fushi-0`,
      userName,
      numbers: zodiacs.flatMap((zodiac) => zodiacNumberMap[zodiac] || []),
      zodiacs,
      manualCombos,
      amountPerNumber: amountPerGroup,
      betAmount: manualCombos.length * amountPerGroup,
      betLabel: '复四三',
      betMode: 'manual-combo',
      comboType: '复四三',
      pickCount: meta.pickCount,
      odds: meta.odds,
      comboCount: manualCombos.length,
    },
  ];
}

function parseManualComboBlocks(rawText) {
  const lines = rawText.split(/\r?\n/);
  const groups = lines.flatMap((line, lineIndex) => parseLianxiaoBetGroups(line.trim(), lineIndex, `第${lineIndex + 1}行`));
  let pendingCombos = [];
  let blockStartIndex = 0;

  function pushManualComboGroup(comboType, amountPerGroup, lineIndex) {
    const meta = getComboMeta(comboType);
    if (!meta) return;

    const validCombos = pendingCombos.filter((combo) => combo.length === meta.pickCount);
    if (!validCombos.length) return;

    groups.push({
      id: `${blockStartIndex}-manual-combo-${groups.length}`,
      userName: `第${blockStartIndex + 1}行 ${comboType}`,
      numbers: [...new Set(validCombos.flat())],
      manualCombos: validCombos,
      amountPerNumber: amountPerGroup,
      betAmount: validCombos.length * amountPerGroup,
      betLabel: comboType,
      betMode: 'manual-combo',
      comboType,
      pickCount: meta.pickCount,
      odds: meta.odds,
      comboCount: validCombos.length,
    });

    pendingCombos = [];
    blockStartIndex = lineIndex + 1;
  }

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line) {
      pendingCombos = [];
      blockStartIndex = lineIndex + 1;
      return;
    }

    const comboType = normalizeComboType(line);
    const numbers = parseComboLineNumbers(line, comboType);
    const amountPerGroup = comboType ? parseComboAmount(line) : 0;

    if (comboType && amountPerGroup) {
      const meta = getComboMeta(comboType);
      if (!meta) return;

      if (numbers.length === meta.pickCount) {
        if (!pendingCombos.length) blockStartIndex = lineIndex;
        pendingCombos.push(numbers);
      }

      pushManualComboGroup(comboType, amountPerGroup, lineIndex);
      return;
    }

    if (numbers.length >= 2 && !comboType && !line.includes('/')) {
      if (!pendingCombos.length) blockStartIndex = lineIndex;
      pendingCombos.push([...new Set(numbers)]);
    }
  });

  return groups;
}

function getParseMode(betMode = 'pingma') {
  return calculationBetModes.find((mode) => mode.id === betMode)?.parseMode || betMode;
}

function splitInlineMixedBetText(rawText) {
  return normalizeZodiacText(rawText).replace(
    new RegExp(`([${zodiacChars}]{4}\\s*复四三\\s*(?:每组|各组|一组|每一组|各一组|出|组|各|下|押|买)?\\s*(?:\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十百佰]+)\\s*元?)(?=平特|平特一肖|平特肖)`, 'g'),
    '$1\n',
  );
}

function hasInlineMixedBetText(rawText) {
  return splitInlineMixedBetText(rawText) !== String(rawText || '');
}

function splitMixedBetText(rawText) {
  if (!hasInlineMixedBetText(rawText)) return null;

  const classifiedTexts = classifyBetText(rawText);
  return classifiedTexts;
}

function isGroupedZodiacAmountText(rawText) {
  return parseGroupedZodiacPingmaBetGroups(rawText).length > 0;
}

function parseBetGroups(rawText, betMode = 'pingma') {
  const parseMode = getParseMode(betMode);
  if (parseMode === 'fushi-zodiac') {
    const groupedZodiacGroups = parseGroupedZodiacFushiBetGroups(rawText);
    if (groupedZodiacGroups.length) return groupedZodiacGroups;
  }

  const mixedTexts = parseMode === 'fushi-zodiac' || parseMode === 'fushi-number' ? splitMixedBetText(rawText) : null;
  if (mixedTexts) {
    return [
      ...parseBetGroups(mixedTexts.pingma, 'pingma'),
      ...parseBetGroups(mixedTexts.lianma, 'lianma'),
      ...parseBetGroups(mixedTexts.numberFushi, 'numberFushi'),
      ...parseBetGroups(mixedTexts.zodiacFushi, 'zodiacFushi'),
    ];
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (parseMode === 'lianma') return parseManualComboBlocks(rawText);

  const parsedLineGroups = lines.flatMap((line, lineIndex) => {
    const userName = getLineUserName(line, lineIndex);
    if (parseMode === 'fushi') {
      return [...parseZodiacFushiBetGroups(line, lineIndex, userName), ...parseFushiBetGroups(line, lineIndex, userName)];
    }
    if (parseMode === 'fushi-number') {
      return parseFushiBetGroups(line, lineIndex, userName);
    }
    if (parseMode === 'fushi-zodiac') {
      return parseZodiacFushiBetGroups(line, lineIndex, userName);
    }

    const slashGroups = parseSlashBetGroups(line, lineIndex, userName);
    const chineseGroups = parseChineseBetGroups(line, lineIndex, userName);
    const zodiacGroups = parseZodiacBetGroups(line, lineIndex, userName);
    const zodiacPingteGroups = parseZodiacPingteBetGroups(line, lineIndex, userName);

    return [...slashGroups, ...chineseGroups, ...zodiacGroups, ...zodiacPingteGroups].map((group, groupIndex) => ({
      ...group,
      userName: groupIndex ? `${userName} 第${groupIndex + 1}组` : userName,
    }));
  });

  if (parseMode === 'fushi') return [...parseFushiBetBlocks(rawText), ...parsedLineGroups];
  if (parseMode === 'fushi-number') return [...parseFushiBetBlocks(rawText), ...parsedLineGroups];
  if (parseMode === 'fushi-zodiac') {
    return parsedLineGroups;
  }
  if (parseMode === 'pingma') {
    const groupedZodiacGroups = parseGroupedZodiacPingmaBetGroups(rawText);
    if (groupedZodiacGroups.length) return groupedZodiacGroups;

    const inlinePingmaGroups = parseInlinePingmaAmountGroups(rawText);
    const multilineSlashGroups = parseMultilineSlashBetGroups(rawText);
    const multilineChineseGroups = parseMultilineChineseBetGroups(rawText);
    const parsedSlashGroups = parsedLineGroups.filter((group) => group.id.includes('slash'));
    const parsedOtherGroups = parsedLineGroups.filter((group) => !group.id.includes('slash') && !group.id.includes('cn'));
    const parsedChineseGroups = parsedLineGroups.filter((group) => group.id.includes('cn'));
    const slashGroups =
      multilineSlashGroups.reduce((sum, group) => sum + group.betAmount, 0) >
      parsedSlashGroups.reduce((sum, group) => sum + group.betAmount, 0)
        ? multilineSlashGroups
        : parsedSlashGroups;
    const chineseGroups =
      multilineChineseGroups.length > parsedChineseGroups.length ||
      multilineChineseGroups.reduce((sum, group) => sum + group.betAmount, 0) >
        parsedChineseGroups.reduce((sum, group) => sum + group.betAmount, 0)
        ? multilineChineseGroups
        : parsedChineseGroups;

    if (inlinePingmaGroups.length && hasSlashNumberBeforeAmount(rawText)) {
      return [...inlinePingmaGroups, ...parsedOtherGroups.filter((group) => group.id.includes('zodiac'))];
    }

    if (slashGroups.length || chineseGroups.length) return [...slashGroups, ...chineseGroups, ...parsedOtherGroups];
  }

  return parsedLineGroups;
}

function getEmptyStatusText(betMode) {
  const parseMode = getParseMode(betMode);
  if (parseMode === 'fushi-number') return '未解析到有效数字复式投注，支持：复试二中二各20 或 复式特碰每组100';
  if (parseMode === 'fushi-zodiac') return '未解析到有效生肖复式投注，支持：羊鸡猪牛复四三各五十';
  if (parseMode === 'fushi') return '未解析到有效复式投注，支持：复试二中二各20，然后下一行填号码';
  if (betMode === 'lianma') return '未解析到有效连码投注，支持：46.47 换行 5.9二中二出50';
  return '未解析到有效平码投注，支持：18..06..12/250 或 狗20';
}

function calculateLotteryResult(input) {
  const drawNumber = normalizeMarkSixNumber(input.drawNumber);
  const drawnNumbers = [...new Set([drawNumber, ...parseBetNumbers(input.extraDrawNumbers || '')].filter(Boolean))];
  const drawnZodiacs = [
    ...new Set([input.drawZodiac, ...drawnNumbers.map((number) => getZodiacByNumber(number))].filter(Boolean)),
  ];
  const betGroups = parseBetGroups(input.rawText, input.betMode);
  const totalBetAmount = betGroups.reduce((sum, group) => sum + group.betAmount, 0);
  const totalBetCount = betGroups.reduce((sum, group) => sum + group.numbers.length, 0);

  const winners = betGroups
    .map((group) => ({
      ...group,
      hitCount:
        group.betMode === 'lianxiao'
          ? group.zodiacs.filter((zodiac) => drawnZodiacs.includes(zodiac)).length
          : group.zodiacs && group.manualCombos
          ? group.manualCombos.filter((combo) => combo.filter((zodiac) => drawnZodiacs.includes(zodiac)).length >= group.pickCount)
              .length
          : group.betMode === 'manual-combo'
          ? group.manualCombos.filter((combo) =>
              combo.filter((number) => drawnNumbers.includes(number)).length >= group.pickCount,
            ).length
          : group.betMode === 'fushi'
          ? group.numbers.filter((number) => drawnNumbers.includes(number)).length
          : group.zodiacs
          ? group.zodiacs.filter((zodiac) => drawnZodiacs.includes(zodiac)).length
          : group.numbers.filter((number) => number === drawNumber).length,
      winComboCount:
        group.betMode === 'lianxiao'
          ? group.zodiacs.every((zodiac) => drawnZodiacs.includes(zodiac))
            ? 1
            : 0
          : group.zodiacs && group.manualCombos
          ? group.manualCombos.filter((combo) => combo.filter((zodiac) => drawnZodiacs.includes(zodiac)).length >= group.pickCount)
              .length
          : group.betMode === 'manual-combo'
          ? group.manualCombos.filter((combo) =>
              combo.filter((number) => drawnNumbers.includes(number)).length >= group.pickCount,
            ).length
          : group.betMode === 'fushi'
          ? combinationCount(group.numbers.filter((number) => drawnNumbers.includes(number)).length, group.pickCount)
          : 0,
    }))
    .filter((group) =>
      group.betMode === 'fushi' || group.betMode === 'manual-combo' || group.betMode === 'lianxiao'
        ? group.winComboCount > 0
        : group.hitCount > 0,
    )
    .map((group) => ({
      id: group.id,
      userName: group.userName,
      hitContent:
        group.betMode === 'fushi'
          ? `复式${group.comboType}，${group.numbers.length}码共${group.comboCount}组，命中${group.hitCount}码/${group.winComboCount}组，${group.amountPerNumber}一组`
          : group.betMode === 'lianxiao'
          ? `${group.comboType}，${group.zodiacs.join('')}，命中${group.hitCount}肖，${group.amountPerNumber}一组，${group.odds}倍`
          : group.zodiacs && group.manualCombos
          ? `生肖${group.comboType}，${group.zodiacs.join('')}共${group.comboCount}组，命中${group.winComboCount}组，${group.amountPerNumber}一组`
          : group.betMode === 'manual-combo'
          ? `连码${group.comboType}，列出${group.comboCount}组，命中${group.winComboCount}组，${group.amountPerNumber}一组`
          : `${drawNumber}号 / ${input.drawZodiac}，${group.betLabel ? `${group.betLabel}肖，` : ''}命中${group.hitCount}码，${group.numbers.length}码各${group.amountPerNumber}`,
      winAmount:
        group.betMode === 'fushi' || group.betMode === 'manual-combo' || group.betMode === 'lianxiao'
          ? group.winComboCount * group.amountPerNumber * group.odds
          : group.hitCount * group.amountPerNumber * 47,
    }));

  return {
    summary: {
      totalBetAmount,
      totalWinAmount: winners.reduce((sum, winner) => sum + winner.winAmount, 0),
      entryCount: totalBetCount,
      groupCount: betGroups.length,
    },
    winners,
    statusText: betGroups.length
      ? `已解析 ${betGroups.length} 组，共 ${totalBetCount} 个号码，命中 ${winners.length} 组`
      : getEmptyStatusText(input.betMode),
  };
}

function calculateAllModeDraftSummary(modeTexts) {
  return calculationBetModes.reduce(
    (summary, mode) => {
      const betGroups = parseBetGroups(modeTexts?.[mode.id] || '', mode.id);

      return {
        totalBetAmount: summary.totalBetAmount + betGroups.reduce((sum, group) => sum + group.betAmount, 0),
        totalWinAmount: 0,
        entryCount: summary.entryCount + betGroups.reduce((sum, group) => sum + group.numbers.length, 0),
        groupCount: summary.groupCount + betGroups.length,
      };
    },
    { ...initialSummary },
  );
}

function buildAiCandidateFormula(groups) {
  if (!groups.length) return '';
  const totalBetAmount = groups.reduce((sum, group) => sum + group.betAmount, 0);
  const first = groups[0];
  const sameComboShape =
    groups.length > 1 &&
    groups.every(
      (group) =>
        group.betMode === first.betMode &&
        group.comboType === first.comboType &&
        group.pickCount === first.pickCount &&
        group.comboCount === first.comboCount &&
        group.amountPerNumber === first.amountPerNumber,
    );

  if (sameComboShape && first.comboCount && first.pickCount) {
    const itemCount = first.zodiacs?.length || first.numbers?.length || first.comboCount;
    return `${groups.length}组 × C(${itemCount},${first.pickCount}) × ${first.amountPerNumber} = ${totalBetAmount}`;
  }

  if (groups.length === 1) {
    if (first.comboCount && first.pickCount) {
      const itemCount = first.zodiacs?.length || first.numbers?.length || first.comboCount;
      return `C(${itemCount},${first.pickCount}) × ${first.amountPerNumber} = ${first.betAmount}`;
    }

    const itemCount = first.zodiacs?.length || first.numbers?.length || 1;
    return `${itemCount}项 × ${first.amountPerNumber} = ${first.betAmount}`;
  }

  return `${groups.length}组，合计 ${totalBetAmount}`;
}

function normalizeAiCandidate(candidate = {}) {
  const mode = String(candidate.mode || '').trim();
  const normalizedText = String(candidate.normalizedText || '').trim();
  const warnings = Array.isArray(candidate.warnings) ? candidate.warnings.map(String).filter(Boolean) : [];

  return {
    mode,
    normalizedText,
    reason: String(candidate.reason || '').trim(),
    modelUsed: String(candidate.modelUsed || '').trim(),
    warnings,
    confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null,
  };
}

function validateAiBetCandidate(candidate) {
  const normalizedCandidate = normalizeAiCandidate(candidate);
  const availableModes = new Set(betModes.map((mode) => mode.id));

  if (!availableModes.has(normalizedCandidate.mode)) {
    return {
      status: 'unresolved',
      message: 'AI 候选模式不在支持范围内',
      ...normalizedCandidate,
      candidate: normalizedCandidate,
      betAmount: 0,
      groupCount: 0,
      formula: '',
    };
  }

  if (!normalizedCandidate.normalizedText) {
    return {
      status: 'unresolved',
      message: 'AI 候选缺少规范文本',
      ...normalizedCandidate,
      candidate: normalizedCandidate,
      betAmount: 0,
      groupCount: 0,
      formula: '',
    };
  }

  const groups = parseBetGroups(normalizedCandidate.normalizedText, normalizedCandidate.mode);
  const betAmount = groups.reduce((sum, group) => sum + group.betAmount, 0);
  if (!groups.length || !betAmount) {
    return {
      status: 'unresolved',
      message: 'AI 候选无法被本地规则解析，未计入金额',
      ...normalizedCandidate,
      candidate: normalizedCandidate,
      betAmount: 0,
      groupCount: 0,
      formula: '',
    };
  }

  return {
    status: 'needs_confirm',
    message: '请确认公式后计入',
    ...normalizedCandidate,
    candidate: normalizedCandidate,
    betAmount,
    groupCount: groups.length,
    formula: buildAiCandidateFormula(groups),
  };
}

function createAiAssistantModeTexts(candidate) {
  const normalizedCandidate = normalizeAiCandidate(candidate);
  return {
    ...initialModeTexts,
    [normalizedCandidate.mode]: normalizedCandidate.normalizedText,
  };
}

function hasParsedBetAmount(mode, text) {
  return parseBetGroups(text, mode).reduce((sum, group) => sum + group.betAmount, 0) > 0;
}

function splitAutoParseSourceLines(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function createAutoParseDraft(rawText, classifiedTexts = classifyBetText(rawText)) {
  const classifiedLineSet = new Set(
    Object.values(classifiedTexts)
      .flatMap(splitAutoParseSourceLines)
      .map((line) => line.replace(/\s+/g, '')),
  );
  const aiSourceTexts = splitAutoParseSourceLines(rawText).filter((line) => !classifiedLineSet.has(line.replace(/\s+/g, '')));
  const unparsedModeTexts = Object.entries(classifiedTexts)
    .filter(([mode, text]) => text.trim() && !hasParsedBetAmount(mode, text))
    .map(([, text]) => text.trim());

  return {
    modeTexts: classifiedTexts,
    aiSourceTexts: [...new Set([...aiSourceTexts, ...unparsedModeTexts])],
  };
}

function applyAiIssueDecision(modeTexts, decision) {
  if (decision?.action !== 'confirm') return { ...initialModeTexts, ...(modeTexts || {}) };

  return mergeModeTexts(modeTexts, createAiAssistantModeTexts(decision.candidate || {}));
}

function calculateAllModeLotteryResult(modeTexts, drawInfo) {
  const results = calculationBetModes.map((mode) =>
    calculateLotteryResult({
      ...drawInfo,
      betMode: mode.id,
      rawText: modeTexts?.[mode.id] || '',
    }),
  );
  const summary = results.reduce(
    (combined, result) => ({
      totalBetAmount: combined.totalBetAmount + result.summary.totalBetAmount,
      totalWinAmount: combined.totalWinAmount + result.summary.totalWinAmount,
      entryCount: combined.entryCount + result.summary.entryCount,
      groupCount: combined.groupCount + result.summary.groupCount,
    }),
    { ...initialSummary },
  );
  const winners = results.flatMap((result) => result.winners);

  return {
    summary,
    winners,
    statusText: summary.groupCount
      ? `已解析 ${summary.groupCount} 组，共 ${summary.entryCount} 个号码，命中 ${winners.length} 组`
      : '未解析到有效投注',
  };
}

function buildReportText(summary, winners, drawNumber, drawZodiac) {
  const winnerLines = winners.length
    ? winners.map((winner) => `${winner.userName}：${winner.hitContent}，中 ${winner.winAmount}`).join('\n')
    : '暂无中奖用户';

  return [
    `开奖号：${drawNumber}`,
    `开奖生肖：${drawZodiac}`,
    `总赌注金额：${summary.totalBetAmount}`,
    `总中奖金额：${summary.totalWinAmount}`,
    `投注组数：${summary.groupCount}`,
    `投注号码数：${summary.entryCount}`,
    '中奖名单：',
    winnerLines,
  ].join('\n');
}

function cleanRecognizedAmount(text) {
  const digits = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[^\d]/g, '');
  if (!digits) return '';
  const amount = Number(digits);
  if (!amount || amount > 9999) return '';
  return String(amount);
}

function formatTableBetsAsBetText(bets) {
  const groups = new Map();

  markSixNumbers.forEach((number) => {
    const amount = cleanRecognizedAmount(String(bets?.[number] || bets?.[Number(number)] || ''));
    if (!amount) return;
    groups.set(amount, [...(groups.get(amount) || []), String(Number(number))]);
  });

  return Array.from(groups.entries())
    .map(([amount, numbers]) => `${numbers.map((number) => `${number}号`).join('')}一个号各下${amount}元`)
    .join('，');
}

function cleanChatOcrText(text) {
  return normalizeZodiacText(text)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[|]/g, '/')
        .replace(/[。．]/g, '.')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => !isChatUiNoiseLine(line))
    .filter((line) => /(\d+[./]|号|各下|各押|各买|下|押|买|[鼠牛虎兔龙蛇马羊猴鸡狗猪])/.test(line))
    .join('\n');
}

function isChatUiNoiseLine(line) {
  const normalizedLine = String(line || '').trim();
  const compactLine = normalizedLine.replace(/\s+/g, '');

  if (!compactLine) return true;
  if (compactLine.includes('文件传输助手')) return true;
  if (/^\d{1,2}:\d{2}(?:[.:]\d{1,3})?$/.test(compactLine)) return true;

  return false;
}

function joinBetText(current, addition) {
  const cleanCurrent = String(current || '').trim();
  const cleanAddition = String(addition || '').trim();
  if (!cleanAddition) return cleanCurrent;
  return cleanCurrent ? `${cleanCurrent}\n${cleanAddition}` : cleanAddition;
}

function splitRecognizedChatLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeOverlapLine(line) {
  return String(line || '')
    .replace(/[|]/g, '/')
    .replace(/[。．]/g, '.')
    .replace(/\s+/g, '')
    .trim();
}

function lineSimilarity(left, right) {
  const a = normalizeOverlapLine(left);
  const b = normalizeOverlapLine(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLength = Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      const substitutionCost = a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }

  return (maxLength - previous[b.length]) / maxLength;
}

function areSimilarOverlapLines(leftLine, rightLine) {
  const left = normalizeOverlapLine(leftLine);
  const right = normalizeOverlapLine(rightLine);
  const maxLength = Math.max(left.length, right.length);
  if (maxLength < 6) return left === right;
  return lineSimilarity(left, right) >= 0.72;
}

function findSuffixPrefixOverlap(leftLines, rightLines) {
  const left = leftLines.map(normalizeOverlapLine);
  const right = rightLines.map(normalizeOverlapLine);
  const maxCount = Math.min(12, left.length, right.length);
  let best = { count: 0, charLength: 0, score: 0 };

  for (let count = 1; count <= maxCount; count += 1) {
    const leftStart = left.length - count;
    let matches = true;

    for (let index = 0; index < count; index += 1) {
      if (!left[leftStart + index] || left[leftStart + index] !== right[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      const charLength = right.slice(0, count).reduce((sum, line) => sum + line.length, 0);
      best = {
        count,
        charLength,
        score: count * 100000 + charLength,
      };
    }
  }

  return best;
}

function isStrongChatOverlap(overlap) {
  return overlap.count >= 2 || overlap.charLength >= 10;
}

function findContainedPrefixOverlap(leftLines, rightLines) {
  const left = leftLines.map(normalizeOverlapLine);
  const right = rightLines.map(normalizeOverlapLine);
  let best = { count: 0, charLength: 0, score: 0 };

  for (let start = 0; start < left.length; start += 1) {
    let count = 0;
    while (start + count < left.length && count < right.length && left[start + count] === right[count]) {
      count += 1;
    }

    if (!count) continue;
    const reachesLeftTail = start + count === left.length;
    if (!reachesLeftTail) continue;

    const charLength = right.slice(0, count).reduce((sum, line) => sum + line.length, 0);
    const score = count * 100000 + charLength;
    if (score > best.score) {
      best = { count, charLength, score };
    }
  }

  return best;
}

function findFuzzyContainedPrefixOverlap(leftLines, rightLines) {
  let best = { count: 0, charLength: 0, score: 0 };

  for (let start = 0; start < leftLines.length; start += 1) {
    let count = 0;
    let exactCount = 0;
    let similaritySum = 0;

    while (start + count < leftLines.length && count < rightLines.length) {
      const leftLine = leftLines[start + count];
      const rightLine = rightLines[count];
      if (!areSimilarOverlapLines(leftLine, rightLine)) break;

      if (normalizeOverlapLine(leftLine) === normalizeOverlapLine(rightLine)) exactCount += 1;
      similaritySum += lineSimilarity(leftLine, rightLine);
      count += 1;
    }

    if (!count) continue;
    const reachesLeftTail = start + count === leftLines.length;
    if (!reachesLeftTail) continue;

    const averageSimilarity = similaritySum / count;
    if (count < 2 && averageSimilarity < 0.9) continue;
    if (count >= 2 && exactCount === 0 && averageSimilarity < 0.82) continue;

    const charLength = rightLines
      .slice(0, count)
      .map(normalizeOverlapLine)
      .reduce((sum, line) => sum + line.length, 0);
    const score = count * 100000 + Math.round(averageSimilarity * 1000) + charLength;
    if (score > best.score) {
      best = { count, charLength, score };
    }
  }

  return best;
}

function findOverlapBeforeClippedTail(leftLines, rightLines) {
  let best = { count: 0, charLength: 0, score: 0, replaceTailCount: 0 };
  const maxTailCount = Math.min(3, Math.max(0, leftLines.length - 1));

  for (let tailCount = 1; tailCount <= maxTailCount; tailCount += 1) {
    const candidate = findFuzzyContainedPrefixOverlap(leftLines.slice(0, -tailCount), rightLines);
    if (!isStrongChatOverlap(candidate)) continue;

    const score = candidate.score + tailCount;
    if (score > best.score) {
      best = { ...candidate, score, replaceTailCount: tailCount };
    }
  }

  return best;
}

function mergeRecognizedChatTexts(texts) {
  const nodes = texts
    .map((text) => ({ lines: splitRecognizedChatLines(text) }))
    .filter((node) => node.lines.length);
  const mergedLines = [];

  nodes.forEach((node) => {
    const suffixOverlap = findSuffixPrefixOverlap(mergedLines, node.lines);
    const containedOverlap = findContainedPrefixOverlap(mergedLines, node.lines);
    const fuzzyContainedOverlap = findFuzzyContainedPrefixOverlap(mergedLines, node.lines);
    const clippedTailOverlap = findOverlapBeforeClippedTail(mergedLines, node.lines);
    const overlap = [suffixOverlap, containedOverlap, fuzzyContainedOverlap, clippedTailOverlap].reduce((best, current) =>
      current.score > best.score ? current : best,
    );
    const duplicateLineCount = isStrongChatOverlap(overlap) ? overlap.count : 0;
    if (duplicateLineCount && overlap.replaceTailCount) {
      mergedLines.splice(-overlap.replaceTailCount);
    }
    mergedLines.push(...node.lines.slice(duplicateLineCount));
  });

  return mergedLines.join('\n');
}

function classifyRecognizedChatTexts(texts) {
  return classifyBetText(mergeRecognizedChatTexts(texts));
}

function mergeModeTexts(currentTexts, nextTexts) {
  return {
    pingma: mergeRecognizedChatTexts([currentTexts?.pingma, nextTexts?.pingma]),
    lianma: mergeRecognizedChatTexts([currentTexts?.lianma, nextTexts?.lianma]),
    fushi: mergeRecognizedChatTexts([currentTexts?.fushi, nextTexts?.fushi]),
    numberFushi: mergeRecognizedChatTexts([currentTexts?.numberFushi, nextTexts?.numberFushi]),
    zodiacFushi: mergeRecognizedChatTexts([currentTexts?.zodiacFushi, nextTexts?.zodiacFushi]),
  };
}

function getPreferredBetMode(modeTexts) {
  return betModes
    .map((mode, index) => ({
      id: mode.id,
      index,
      lineCount: splitRecognizedChatLines(modeTexts?.[mode.id] || '').length,
    }))
    .filter((mode) => mode.lineCount > 0)
    .sort((left, right) => right.lineCount - left.lineCount || left.index - right.index)[0]?.id || 'pingma';
}

function classifyBetText(rawText) {
  const buckets = { ...initialModeTexts };
  if (isGroupedZodiacAmountText(rawText)) {
    buckets.zodiacFushi = String(rawText || '').trim();
    return buckets;
  }

  const lines = splitInlineMixedBetText(rawText)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[|]/g, '/')
        .replace(/[。．]/g, '.')
        .replace(/[，,]/g, '.')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => !isChatUiNoiseLine(line))
    .filter(Boolean);

  let currentMode = 'pingma';
  let pendingFushiHeader = '';
  let pendingFushiNumberLines = [];
  let pendingLianmaLines = [];
  let pendingAmbiguousComboLines = [];

  function append(mode, line) {
    buckets[mode] = joinBetText(buckets[mode], normalizeCompactMarkSixNumberRuns(line));
  }

  function flushPendingLianma() {
    if (!pendingLianmaLines.length) return;
    append('lianma', pendingLianmaLines.join('\n'));
    pendingLianmaLines = [];
  }

  function flushPendingAmbiguousComboLines(mode = 'pingma') {
    if (!pendingAmbiguousComboLines.length) return;
    append(mode, pendingAmbiguousComboLines.join('\n'));
    pendingAmbiguousComboLines = [];
  }

  function appendFushiLine(line) {
    const normalizedLine = String(line || '').replace(/^复试/, '复式');
    const mode = parseZodiacFushiBetGroups(normalizedLine, 0, '').length > 0 ? 'zodiacFushi' : 'numberFushi';
    append(mode, line);
  }

  function flushPendingFushiHeader() {
    if (!pendingFushiHeader) return;
    appendFushiLine([pendingFushiHeader, ...pendingFushiNumberLines].join('\n'));
    pendingFushiHeader = '';
    pendingFushiNumberLines = [];
  }

  lines.forEach((line) => {
    const lineWithZodiacAliases = normalizeZodiacText(line);
    const normalizedLine = lineWithZodiacAliases.replace(/^复试/, '复式');
    const comboType = normalizeComboType(normalizedLine);
    const numbers = parseBetNumbers(normalizedLine);
    const hasAmount = parseComboAmount(normalizedLine) > 0;
    const isLianxiaoLine = isLianxiaoBetLine(normalizedLine);
    const isZodiacFushiLine = parseZodiacFushiBetGroups(normalizedLine, 0, '').length > 0;
    const isZodiacPingteLine = parseZodiacPingteBetGroups(normalizedLine, 0, '').length > 0;
    const isUnsupportedComboLine = unsupportedComboTypes.has(comboType);
    const isFushiSlashLine =
      !isUnsupportedComboLine && comboType && normalizedLine.includes('/') && parseFushiBetGroups(normalizedLine, 0, '').length > 0;
    const isPingmaLine =
      lineWithZodiacAliases.includes('/') ||
      /号|各下|各押|各买|一个号|每号|平特|平特一肖|平特肖|[鼠牛虎兔龙蛇马羊猴鸡狗猪]\d/.test(lineWithZodiacAliases);
    const isZodiacPingmaLine = /^[鼠牛虎兔龙蛇马羊猴鸡狗猪]\d+(?:\.\d+)?元?$/.test(lineWithZodiacAliases);
    const isFushiHeader = /复式|复试/.test(line) && comboType && hasAmount;
    const isLianmaClosingLine = !/复式|复试/.test(line) && comboType && hasAmount && numbers.length >= 2;
    const isComboNumberLine = numbers.length >= 2 && !line.includes('/') && !isPingmaLine;
    const previousPingmaLine = buckets.pingma.split(/\r?\n/).filter(Boolean).at(-1) || '';
    const continuesSlashPingmaLine =
      currentMode === 'pingma' && !comboType && numbers.length >= 2 && /\/\d*$|\.\d$/.test(previousPingmaLine);
    const continuesSlashAmountLine =
      currentMode === 'pingma' && !comboType && /^\d{1,2}$/.test(line) && /\/\d{1,2}$/.test(previousPingmaLine);
    const continuesChineseAmountLine =
      currentMode === 'pingma' &&
      !comboType &&
      /^\d+(?:\.\d+)?元?$/.test(line) &&
      /(?:各下|各押|各买|各|下|押|买)$/.test(previousPingmaLine);

    if (line === '0' && !continuesSlashAmountLine) {
      return;
    }

    if (isLianxiaoLine) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      append('lianma', line);
      currentMode = 'lianma';
      return;
    }

    if (pendingAmbiguousComboLines.length && (isLianmaClosingLine || (isComboNumberLine && currentMode !== 'fushi'))) {
      pendingLianmaLines.push(...pendingAmbiguousComboLines);
      pendingAmbiguousComboLines = [];
      currentMode = 'lianma';
    } else if (pendingAmbiguousComboLines.length && !continuesSlashPingmaLine && !continuesSlashAmountLine && !continuesChineseAmountLine) {
      flushPendingAmbiguousComboLines('pingma');
    }

    if (isFushiSlashLine) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      appendFushiLine(line.replace(/\s+/g, ''));
      currentMode = 'fushi';
      return;
    }

    if (isZodiacFushiLine) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      appendFushiLine(line);
      currentMode = 'fushi';
      return;
    }

    if (isUnsupportedComboLine && hasAmount) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      appendFushiLine(line);
      currentMode = 'fushi';
      return;
    }

    if (isFushiHeader) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      currentMode = 'fushi';
      pendingFushiHeader = line;
      return;
    }

    if (pendingFushiHeader && isComboNumberLine) {
      pendingFushiNumberLines.push(line);
      currentMode = 'fushi';
      return;
    }

    if (isLianmaClosingLine) {
      flushPendingFushiHeader();
      pendingLianmaLines.push(line);
      flushPendingLianma();
      currentMode = 'lianma';
      return;
    }

    if (isPingmaLine || isZodiacPingmaLine || isZodiacPingteLine) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      append('pingma', line);
      currentMode = 'pingma';
      return;
    }

    if (continuesSlashPingmaLine && isComboNumberLine && !continuesSlashAmountLine && !continuesChineseAmountLine) {
      pendingAmbiguousComboLines.push(line);
      return;
    }

    if (continuesSlashPingmaLine || continuesSlashAmountLine || continuesChineseAmountLine) {
      flushPendingAmbiguousComboLines('pingma');
      flushPendingLianma();
      flushPendingFushiHeader();
      append('pingma', line);
      currentMode = 'pingma';
      return;
    }

    if (isComboNumberLine && currentMode === 'fushi') {
      flushPendingAmbiguousComboLines('pingma');
      if (pendingFushiHeader) {
        pendingFushiNumberLines.push(line);
      } else {
        appendFushiLine(line);
      }
      return;
    }

    if (isComboNumberLine) {
      pendingLianmaLines.push(line);
      currentMode = 'lianma';
      return;
    }
  });

  flushPendingAmbiguousComboLines('pingma');
  flushPendingLianma();
  flushPendingFushiHeader();
  return buckets;
}

export {
  appVersion,
  applyAiIssueDecision,
  betModes,
  buildReportText,
  calculateAllModeDraftSummary,
  calculateAllModeLotteryResult,
  calculateLotteryResult,
  classifyBetText,
  classifyRecognizedChatTexts,
  cleanRecognizedAmount,
  createAiAssistantModeTexts,
  createAutoParseDraft,
  formatMoney,
  formatTableBetsAsBetText,
  getEmptyStatusText,
  getPreferredBetMode,
  getZodiacByNumber,
  initialModeTexts,
  initialSummary,
  joinBetText,
  markSixNumbers,
  mergeModeTexts,
  mergeRecognizedChatTexts,
  normalizeMarkSixNumber,
  parseBetGroups,
  validateAiBetCandidate,
  zodiacNumberMap,
};
