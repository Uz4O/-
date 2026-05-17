import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildReportText,
  calculateAllModeDraftSummary,
  calculateAllModeLotteryResult,
  calculateLotteryResult,
  classifyBetText,
  classifyRecognizedChatTexts,
  getPreferredBetMode,
  mergeModeTexts,
  mergeRecognizedChatTexts,
  parseBetGroups,
} from './lottery.js';

describe('parseBetGroups', () => {
  it('parses compact OCR slash numbers as two-digit mark six numbers', () => {
    const groups = parseBetGroups('123508/250\n4603192741062214/150\n0931441825/100', 'pingma');

    assert.deepEqual(groups.map((group) => group.numbers), [
      ['12', '35', '08'],
      ['46', '03', '19', '27', '41', '06', '22', '14'],
      ['09', '31', '44', '18', '25'],
    ]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 2450);
  });

  it('parses odd compact OCR runs that duplicate the next number prefix', () => {
    const groups = parseBetGroups('4603192 27 41 06 22 14/150', 'pingma');

    assert.deepEqual(groups.map((group) => group.numbers), [['46', '03', '19', '27', '41', '06', '22', '14']]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 1200);
  });

  it('parses compact OCR runs with one duplicated digit inserted inside the number run', () => {
    const groups = parseBetGroups('46031922741062214/150', 'pingma');

    assert.deepEqual(groups.map((group) => group.numbers), [['46', '03', '19', '27', '41', '06', '22', '14']]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 1200);
  });

  it('merges compact OCR number continuation lines into the following slash pingma group', () => {
    const groups = parseBetGroups('234811/250\n0617293240052137441226\n08153049/150', 'pingma');

    assert.deepEqual(groups.map((group) => group.numbers), [
      ['23', '48', '11'],
      ['06', '17', '29', '32', '40', '05', '21', '37', '44', '12', '26', '08', '15', '30', '49'],
    ]);
    assert.deepEqual(groups.map((group) => group.amountPerNumber), [250, 150]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 3000);
  });

  it('does not merge Chinese pingma number lines into following slash groups', () => {
    const groups = parseBetGroups(
      [
        '澳门彩特码07号16号28号33号',
        '45号一个号各下30元,',
        '234811/250',
        '0617293240052137441226',
        '08153049/150',
      ].join('\n'),
      'pingma',
    );

    assert.deepEqual(groups.map((group) => group.numbers), [
      ['23', '48', '11'],
      ['06', '17', '29', '32', '40', '05', '21', '37', '44', '12', '26', '08', '15', '30', '49'],
      ['07', '16', '28', '33', '45'],
    ]);
    assert.deepEqual(groups.map((group) => group.amountPerNumber), [250, 150, 30]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 3150);
  });

  it('解析平码斜杠、中文金额和生肖投注', () => {
    const groups = parseBetGroups('张三：18..06..12/250..08.16.22/150\n李四：9号14号24号一个号各下30元\n狗20');

    assert.equal(groups.length, 4);
    assert.deepEqual(groups[0], {
      id: '0-slash-0',
      userName: '张三',
      numbers: ['18', '06', '12'],
      amountPerNumber: 250,
      betAmount: 750,
    });
    assert.deepEqual(groups[1].numbers, ['08', '16', '22']);
    assert.equal(groups[1].betAmount, 450);
    assert.deepEqual(groups[2].numbers, ['09', '14', '24']);
    assert.equal(groups[2].betAmount, 90);
    assert.equal(groups[3].betLabel, '狗');
    assert.deepEqual(groups[3].numbers, ['09', '21', '33', '45']);
    assert.equal(groups[3].betAmount, 80);
  });

  it('解析 OCR 换行拆开的平码中文金额投注', () => {
    const text = [
      '澳门彩特码10号12号14号24号',
      '26号32号34号36号38号40号',
      '42号48号一个号各下10元.4号',
      '14号24号34号44号一个号各下',
      '100元.5号15号25号35号45号',
      '一个号各下70元',
    ].join('\n');
    const groups = parseBetGroups(text, 'pingma');

    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0].numbers, ['10', '12', '14', '24', '26', '32', '34', '36', '38', '40', '42', '48']);
    assert.equal(groups[0].amountPerNumber, 10);
    assert.equal(groups[0].betAmount, 120);
    assert.deepEqual(groups[1].numbers, ['04', '14', '24', '34', '44']);
    assert.equal(groups[1].amountPerNumber, 100);
    assert.equal(groups[1].betAmount, 500);
    assert.deepEqual(groups[2].numbers, ['05', '15', '25', '35', '45']);
    assert.equal(groups[2].amountPerNumber, 70);
    assert.equal(groups[2].betAmount, 350);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 970);
    assert.equal(calculateAllModeDraftSummary({ pingma: text, lianma: '', fushi: '' }).totalBetAmount, 970);
  });

  it('解析 OCR 常见少字的平码中文金额投注', () => {
    const groups = parseBetGroups(
      [
        '澳门彩特码9号14号24号34号25号35号一',
        '个号各下30元,4号14号24号34号44号5',
        '号15号25号35号45号个号各下20元',
        '香港特码27号下300元',
      ].join('\n'),
      'pingma',
    );

    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 680);
    assert.deepEqual(groups[0].numbers, ['09', '14', '24', '34', '25', '35']);
    assert.equal(groups[0].amountPerNumber, 30);
    assert.deepEqual(groups[1].numbers, ['04', '14', '24', '34', '44', '05', '15', '25', '35', '45']);
    assert.equal(groups[1].amountPerNumber, 20);
    assert.deepEqual(groups[2].numbers, ['27']);
    assert.equal(groups[2].amountPerNumber, 300);
  });

  it('把 OCR 换行拆开的 slash 平码保留在平码分类', () => {
    const result = classifyBetText(
      [
        '18..06..12/250..08.16.22..04..02.28..20.36.2',
        '6.10',
        '..24.14.07..21../150...30..34..36..47..32/100',
      ].join('\n'),
    );

    assert.equal(result.lianma, '');
    assert.match(result.pingma, /6\.10/);
    assert.equal(parseBetGroups(result.pingma, 'pingma').reduce((sum, group) => sum + group.betAmount, 0), 3350);
  });

  it('分类时保留 OCR 拆开的平码金额续行', () => {
    const result = classifyBetText(
      [
        '..06..20...40..26.05..29..07..21..32..24.36/15',
        '0',
        '澳门彩特码10号12号14号24号26号32号',
        '10元,4号14号24号34号44号个号各下',
        '100元,5号15号25号35号45号个号各下',
        '70元',
        '香港特码27号下300元',
      ].join('\n'),
    );

    assert.match(result.pingma, /\n0(?:\n|$)/);
    assert.match(result.pingma, /70元/);
    assert.equal(result.lianma, '');
    assert.equal(parseBetGroups(result.pingma, 'pingma').reduce((sum, group) => sum + group.betAmount, 0), 2860);
  });

  it('解析 OCR 把 slash 金额拆成下一行数字的平码', () => {
    const groups = parseBetGroups(
      [
        '12...48..07/250..46..44..08.16.22..30.02..28',
        '..06..20...40..26.05..29..07..21..32..24.36/15',
        '0',
      ].join('\n'),
      'pingma',
    );

    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 3600);
  });

  it('解析 OCR 把中文金额拆成下一行金额的平码', () => {
    const groups = parseBetGroups(
      [
        '澳门彩特码10号12号14号24号26号32号',
        '10元.4号14号24号34号44号个号各下',
        '100元.5号15号25号35号45号个号各下',
        '70元',
        '香港特码27号下300元',
      ].join('\n'),
      'pingma',
    );

    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 1210);
    assert.deepEqual(groups.map((group) => group.amountPerNumber), [10, 100, 70, 300]);
  });

  it('解析识别文本中带空格和中文标点的平码', () => {
    const groups = parseBetGroups(
      [
        '澳门彩特码 10号 12号 14号 24号 26号 32号',
        '34号 36号 38号 40号 42号 48号一个号各下',
        '10元，4号14号24号34号44号一个号各下',
        '100元，5号15号25号35号45号一个号各下',
        '70元',
        '香港特码 27号下 300元',
      ].join('\n'),
      'pingma',
    );

    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 1270);
    assert.deepEqual(groups.map((group) => group.amountPerNumber), [10, 100, 70, 300]);
  });

  it('解析连码手工组合', () => {
    const groups = parseBetGroups('46.47\n4.14\n24.32\n5.9二中二出50', 'lianma');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].betMode, 'manual-combo');
    assert.equal(groups[0].comboType, '二中二');
    assert.equal(groups[0].comboCount, 4);
    assert.equal(groups[0].betAmount, 200);
    assert.deepEqual(groups[0].manualCombos, [
      ['46', '47'],
      ['04', '14'],
      ['24', '32'],
      ['05', '09'],
    ]);
  });

  it('解析复式块', () => {
    const groups = parseBetGroups('复试二中二各20\n23.22.27.06', 'fushi');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].betMode, 'fushi');
    assert.equal(groups[0].comboType, '二中二');
    assert.equal(groups[0].comboCount, 6);
    assert.equal(groups[0].betAmount, 120);
  });

  it('复式标题后的多行号码合并为同一组号码池', () => {
    const groups = parseBetGroups('复试三中三各20\n23.22.27.06\n01.02.03', 'fushi');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].comboType, '三中三');
    assert.deepEqual(groups[0].numbers, ['23', '22', '27', '06', '01', '02', '03']);
    assert.equal(groups[0].comboCount, 35);
    assert.equal(groups[0].betAmount, 700);
  });

  it('按二中二口径解析复式特碰任意两两组合', () => {
    const groups = parseBetGroups('21-47-32--13-42复式特碰每组100', 'fushi');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].betMode, 'fushi');
    assert.equal(groups[0].comboType, '特碰');
    assert.deepEqual(groups[0].numbers, ['21', '47', '32', '13', '42']);
    assert.equal(groups[0].pickCount, 2);
    assert.equal(groups[0].comboCount, 10);
    assert.equal(groups[0].betAmount, 1000);
  });

  it('未配置赔率的二中三不参与计算，避免错误赔付', () => {
    const groups = parseBetGroups('复试二中三各20\n23.22.27.06', 'fushi');

    assert.equal(groups.length, 0);
  });

  it('解析生肖口头复式复四三', () => {
    const groups = parseBetGroups('牛鸡兔龙复四三各五十', 'fushi');

    assert.equal(groups.length, 1);
    assert.equal(groups[0].betMode, 'manual-combo');
    assert.equal(groups[0].comboType, '复四三');
    assert.equal(groups[0].comboCount, 4);
    assert.equal(groups[0].betAmount, 200);
    assert.deepEqual(groups[0].manualCombos, [
      ['牛', '鸡', '兔'],
      ['牛', '鸡', '龙'],
      ['牛', '兔', '龙'],
      ['鸡', '兔', '龙'],
    ]);
  });
});

describe('calculateLotteryResult', () => {
  it('按平码命中特码计算 47 倍中奖金额', () => {
    const result = calculateLotteryResult({
      betMode: 'pingma',
      rawText: '张三：18..06..12/10\n狗20',
      drawNumber: '09',
      drawZodiac: '狗',
    });

    assert.equal(result.summary.totalBetAmount, 110);
    assert.equal(result.summary.groupCount, 2);
    assert.equal(result.summary.totalWinAmount, 940);
    assert.equal(result.winners.length, 1);
    assert.equal(result.winners[0].userName, '第2行');
    assert.match(result.winners[0].hitContent, /狗肖/);
  });

  it('按连码开奖号码集合计算中奖组合', () => {
    const result = calculateLotteryResult({
      betMode: 'lianma',
      rawText: '46.47\n4.14\n24.32\n5.9二中二出50',
      drawNumber: '46',
      extraDrawNumbers: '47.01.02.03.04',
      drawZodiac: '鸡',
    });

    assert.equal(result.summary.totalBetAmount, 200);
    assert.equal(result.summary.totalWinAmount, 3250);
    assert.equal(result.winners[0].hitContent, '连码二中二，列出4组，命中1组，50一组');
  });

  it('按复式命中码数计算组合数和中奖金额', () => {
    const result = calculateLotteryResult({
      betMode: 'fushi',
      rawText: '复试二中二各20\n23.22.27.06',
      drawNumber: '23',
      extraDrawNumbers: '22.01.02.03',
      drawZodiac: '猴',
    });

    assert.equal(result.summary.totalBetAmount, 120);
    assert.equal(result.summary.totalWinAmount, 1300);
    assert.match(result.winners[0].hitContent, /命中2码\/1组/);
  });

  it('复式特碰中奖计算沿用二中二赔率和组合命中数', () => {
    const result = calculateLotteryResult({
      betMode: 'fushi',
      rawText: '21-47-32--13-42复式特碰每组100',
      drawNumber: '21',
      extraDrawNumbers: '47.01.02.03.04',
      drawZodiac: '鸡',
    });

    assert.equal(result.summary.totalBetAmount, 1000);
    assert.equal(result.summary.totalWinAmount, 6500);
    assert.match(result.winners[0].hitContent, /复式特碰/);
    assert.match(result.winners[0].hitContent, /命中2码\/1组/);
  });

  it('二中三未配置赔率时不产生中奖金额', () => {
    const result = calculateLotteryResult({
      betMode: 'fushi',
      rawText: '复试二中三各20\n23.22.27.06',
      drawNumber: '23',
      extraDrawNumbers: '22.27.06',
      drawZodiac: '猴',
    });

    assert.equal(result.summary.totalBetAmount, 0);
    assert.equal(result.summary.totalWinAmount, 0);
    assert.equal(result.winners.length, 0);
  });

  it('按生肖复四三计算中奖组合', () => {
    const result = calculateLotteryResult({
      betMode: 'fushi',
      rawText: '牛鸡兔龙复四三各五十',
      drawNumber: '06',
      extraDrawNumbers: '10.04.01.02.05',
      drawZodiac: '牛',
    });

    assert.equal(result.summary.totalBetAmount, 200);
    assert.equal(result.summary.totalWinAmount, 10000);
    assert.equal(result.winners.length, 1);
    assert.match(result.winners[0].hitContent, /生肖复四三/);
    assert.match(result.winners[0].hitContent, /命中1组/);
  });
});

describe('calculateAllModeLotteryResult', () => {
  it('汇总三个模式当前已录入的投注金额', () => {
    const summary = calculateAllModeDraftSummary({
      pingma: '狗20',
      lianma: '46.47\n4.14\n24.32\n5.9二中二出50',
      fushi: '复试二中二各20\n23.22.27.06',
    });

    assert.equal(summary.totalBetAmount, 400);
    assert.equal(summary.groupCount, 3);
  });

  it('汇总平码、连码和复式三个模式的投注金额与中奖金额', () => {
    const result = calculateAllModeLotteryResult(
      {
        pingma: '狗20',
        lianma: '46.47\n4.14\n24.32\n5.9二中二出50',
        fushi: '复试二中二各20\n23.22.27.06',
      },
      {
        drawNumber: '09',
        extraDrawNumbers: '46.47.23.22.01',
        drawZodiac: '狗',
      },
    );

    assert.equal(result.summary.totalBetAmount, 400);
    assert.equal(result.summary.totalWinAmount, 5490);
    assert.equal(result.summary.groupCount, 3);
    assert.equal(result.winners.length, 3);
  });
});

describe('buildReportText', () => {
  it('生成中奖汇报文本', () => {
    const text = buildReportText(
      {
        totalBetAmount: 110,
        totalWinAmount: 940,
        groupCount: 2,
        entryCount: 7,
      },
      [
        {
          userName: '第2行',
          hitContent: '09号 / 狗，狗肖，命中1码，4码各20',
          winAmount: 940,
        },
      ],
      '09',
      '狗',
    );

    assert.equal(
      text,
      [
        '开奖号：09',
        '开奖生肖：狗',
        '总赌注金额：110',
        '总中奖金额：940',
        '投注组数：2',
        '投注号码数：7',
        '中奖名单：',
        '第2行：09号 / 狗，狗肖，命中1码，4码各20，中 940',
      ].join('\n'),
    );
  });

  it('无中奖时写暂无中奖用户', () => {
    const text = buildReportText(
      {
        totalBetAmount: 0,
        totalWinAmount: 0,
        groupCount: 0,
        entryCount: 0,
      },
      [],
      '01',
      '马',
    );

    assert.match(text, /暂无中奖用户$/);
  });
});

describe('classifyBetText', () => {
  it('keeps compact OCR number continuation lines in pingma before following slash amount', () => {
    const result = classifyBetText('234811/250\n0617293240052137441226\n08153049/150');
    const groups = parseBetGroups(result.pingma, 'pingma');

    assert.equal(result.lianma, '');
    assert.equal(result.pingma, '23 48 11/250\n06 17 29 32 40 05 21 37 44 12 26\n08 15 30 49/150');
    assert.deepEqual(groups.map((group) => group.numbers), [
      ['23', '48', '11'],
      ['06', '17', '29', '32', '40', '05', '21', '37', '44', '12', '26', '08', '15', '30', '49'],
    ]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 3000);
  });

  it('preserves OCR spaces and parses spaced slash pingma bets', () => {
    const result = classifyBetText('12 35 08/250\n46 03 19 27 41 06 22 14/150\n09 31 44 18 25/100');
    const groups = parseBetGroups(result.pingma, 'pingma');

    assert.equal(result.pingma, '12 35 08/250\n46 03 19 27 41 06 22 14/150\n09 31 44 18 25/100');
    assert.deepEqual(groups.map((group) => group.numbers), [
      ['12', '35', '08'],
      ['46', '03', '19', '27', '41', '06', '22', '14'],
      ['09', '31', '44', '18', '25'],
    ]);
    assert.equal(groups.reduce((sum, group) => sum + group.betAmount, 0), 2450);
  });

  it('keeps a multiline lianma block together after slash pingma bets', () => {
    const result = classifyBetText(
      [
        '18 06 42/200',
        '09 31 47 12 25 38/150',
        '03 14 29 36 44/100',
        '澳门彩特码08号17号26号39号',
        '46号一个号各下30元',
        '05号15号25号35号45号一个',
        '号各下50元',
        '11 23 34/250',
        '07 16 28 41 49 02 19/120',
        '04 13 22 37/100',
        '06.18.29',
        '12.25.44',
        '03.17.39',
        '08.21.46三中三每组40',
      ].join('\n'),
    );

    assert.equal(result.pingma.includes('06.18.29'), false);
    assert.match(result.pingma, /澳门彩特码08号17号26号39号/);
    assert.match(result.pingma, /46号一个号各下30元/);
    assert.match(result.pingma, /05号15号25号35号45号一个/);
    assert.match(result.pingma, /号各下50元/);
    assert.equal(result.pingma.split(/\r?\n/).filter(Boolean).length, 10);
    assert.equal(result.lianma.includes('澳门彩特码'), false);
    assert.equal(result.lianma.includes('46号一个号各下30元'), false);
    assert.equal(result.lianma, '06.18.29\n12.25.44\n03.17.39\n08.21.46三中三每组40');
    assert.equal(parseBetGroups(result.lianma, 'lianma').reduce((sum, group) => sum + group.betAmount, 0), 160);
  });

  it('把 OCR 文本分类到对应模式', () => {
    const result = classifyBetText('狗20\n46.47\n5.9二中二出50\n复试二中二各20\n23.22.27.06');

    assert.equal(result.pingma, '狗20');
    assert.equal(result.lianma, '46.47\n5.9二中二出50');
    assert.equal(result.fushi, '复试二中二各20\n23.22.27.06');
  });

  it('分类时保留复式标题后的多行号码', () => {
    const result = classifyBetText('复试三中三各20\n23.22.27.06\n01.02.03\n狗20');

    assert.equal(result.fushi, '复试三中三各20\n23.22.27.06\n01.02.03');
    assert.equal(result.pingma, '狗20');
  });

  it('复式 slash 格式优先归类到复式而不是平码', () => {
    const result = classifyBetText('二中二 04.05.09.14.24/50\n12...48..07/250');

    assert.equal(result.fushi, '二中二04.05.09.14.24/50');
    assert.equal(result.pingma, '12...48..07/250');
  });

  it('新的复式玩法行会结束上一段复式号码池', () => {
    const result = classifyBetText('复试三中三各20\n23.22.27.06\n01.02.03\n二中二 04.05.09.14.24/50');
    const groups = parseBetGroups(result.fushi, 'fushi');

    assert.equal(groups.length, 2);
    assert.equal(groups[0].comboType, '三中三');
    assert.equal(groups[0].comboCount, 35);
    assert.equal(groups[0].betAmount, 700);
    assert.equal(groups[1].comboType, '二中二');
    assert.equal(groups[1].comboCount, 10);
    assert.equal(groups[1].betAmount, 500);
  });

  it('把生肖复四三口头写法归类到复式', () => {
    const result = classifyBetText('牛鸡兔龙复四三各五十\n狗20');

    assert.equal(result.fushi, '牛鸡兔龙复四三各五十');
    assert.equal(result.pingma, '狗20');
  });

  it('把复式特碰口头写法归类到复式', () => {
    const result = classifyBetText('21-47-32--13-42复式特碰每组100');

    assert.equal(result.fushi, '21-47-32--13-42复式特碰每组100');
    assert.equal(result.pingma, '');
    assert.equal(result.lianma, '');
  });
});

describe('mergeRecognizedChatTexts', () => {
  it('去掉相邻聊天截图尾部和头部的重复内容', () => {
    const merged = mergeRecognizedChatTexts([
      '07.09.13\n20.33.42\n46.47\n4.14\n24.32\n9.10',
      '46.47\n4.14\n24.32\n9.10\n31.33\n21.25\n5.9二中二出50',
    ]);

    assert.equal(
      merged,
      '07.09.13\n20.33.42\n46.47\n4.14\n24.32\n9.10\n31.33\n21.25\n5.9二中二出50',
    );
  });

  it('上传顺序反了且相邻方向没有重叠时保留原始顺序', () => {
    const merged = mergeRecognizedChatTexts([
      '46.47\n4.14\n24.32\n9.10\n31.33\n21.25\n5.9二中二出50',
      '07.09.13\n20.33.42\n46.47\n4.14\n24.32\n9.10',
    ]);

    assert.equal(
      merged,
      '46.47\n4.14\n24.32\n9.10\n31.33\n21.25\n5.9二中二出50\n07.09.13\n20.33.42\n46.47\n4.14\n24.32\n9.10',
    );
  });

  it('没有相邻重叠时保留原始上传顺序', () => {
    const merged = mergeRecognizedChatTexts(['狗20', '复试三中三各20\n23.22.27.06']);

    assert.equal(merged, '狗20\n复试三中三各20\n23.22.27.06');
  });

  it('再次追加同一段识别结果时不重复复制已有内容', () => {
    const text = [
      '12 35 08/250',
      '46 03 19 27 41 06 22 14/150',
      '09 31 44 18 25/100',
    ].join('\n');

    assert.equal(mergeRecognizedChatTexts([text, text]), text);
  });

  it('去掉下一张开头对应上一张中段到末尾的大段重叠内容', () => {
    const merged = mergeRecognizedChatTexts([
      [
        '14 27 36/250',
        '03 08 19 22 41 46 09 31/150',
        '12 25 33 44 48/100',
        '澳门彩特码06号18号29号37号',
        '45号一个号各下30元,',
        '04号14号24号34号44号一个',
        '号各下20元',
        '23 05 17/250',
        '11 28 39 42 07 16 30 48 02 21 35',
        '44/150',
        '09 13 26 31/100',
        '香港特码38号下300元',
        '05.12.29',
        '07.18.41',
        '09.22.36',
        '15.27.44三中三每组35',
        '06.14',
        '21.33',
        '08.42',
        '17.39',
        '25.46',
        '03.31',
        '10.28',
        '05.09二中二出50',
      ].join('\n'),
      [
        '45号一个号各下30元,',
        '04号14号24号34号44号一个',
        '号各下20元',
        '23 05 17/250',
        '11 28 39 42 07 16 30 48 02 21 35',
        '44/150',
        '09 13 26 31/100',
        '香港特码38号下300元',
        '05.12.29',
        '07.18.41',
        '09.22.36',
        '15.27.44三中三每组35',
        '06.14',
        '21.33',
        '08.42',
        '17.39',
        '25.46',
        '03.31',
        '10.28',
        '05.09二中二出50',
        '复式三中三各20',
        '02.11.36.47',
        '鼠牛兔蛇复四三各五十',
      ].join('\n'),
    ]);

    assert.equal(
      merged,
      [
        '14 27 36/250',
        '03 08 19 22 41 46 09 31/150',
        '12 25 33 44 48/100',
        '澳门彩特码06号18号29号37号',
        '45号一个号各下30元,',
        '04号14号24号34号44号一个',
        '号各下20元',
        '23 05 17/250',
        '11 28 39 42 07 16 30 48 02 21 35',
        '44/150',
        '09 13 26 31/100',
        '香港特码38号下300元',
        '05.12.29',
        '07.18.41',
        '09.22.36',
        '15.27.44三中三每组35',
        '06.14',
        '21.33',
        '08.42',
        '17.39',
        '25.46',
        '03.31',
        '10.28',
        '05.09二中二出50',
        '复式三中三各20',
        '02.11.36.47',
        '鼠牛兔蛇复四三各五十',
      ].join('\n'),
    );
  });

  it('去掉 OCR 轻微识别差异造成的连码重叠内容', () => {
    const first = [
      '05.12.29',
      '07.18.41',
      '09.22.36',
      '15.27.44三中三每组35',
      '06.14',
      '21.33',
      '08.42',
      '17.39',
      '25.46',
      '03.31',
      '10.28',
      '05.09二中二出50',
    ].join('\n');
    const second = [
      '05.12.29',
      '07.18.41',
      '09.22.36',
      '15.27.44三中三每组35',
      '06.14',
      '21.33',
      '08.42',
      '17.39',
      '25.46',
      '03.31',
      '10.28',
      '05.09 9二中二出50',
    ].join('\n');

    assert.equal(mergeRecognizedChatTexts([first, second]), first);
  });

  it('去掉 OCR 轻微识别差异造成的平码中段重叠内容', () => {
    const first = [
      '14 27 36/250',
      '03 08 19 22 41 46 09 31/150',
      '12 25 33 44 48/100',
      '澳门彩特码06号18号29号37号',
      '45号一个号各下30元.',
      '04号14号24号34号44号一个',
      '号各下20元',
      '23 05 17/250',
      '11 28 39 42 07 16 30 48 02 21 35',
      '44/150',
      '09 13 26 31/100',
      '香港特码38号下300元',
    ].join('\n');
    const second = [
      '45号 一1号合下30元.',
      '04号14号24号34号44号一个',
      '号各下20元',
      '23 05 17/250',
      '11 28 39 42 07 16 30 48 02 21 35',
      '44/150',
      '09 13 26 31/100',
      '香港特码38号下300元',
    ].join('\n');

    assert.equal(mergeRecognizedChatTexts([first, second]), first);
  });

  it('用下一张完整内容替换上一张被输入栏截断的底部连码内容', () => {
    const first = [
      '06.18.29',
      '12.25.44',
      '03.17.39',
      '08.21.46三中三每组40',
      '09.14',
      '27.33',
      '05.42',
      '16.38',
      '22.49二中二出60',
      '01.13.24',
      '07.10 21',
    ].join('\n');
    const second = [
      '06.18.29',
      '12.25.44',
      '03.17.39',
      '08.21.46三中三每组40',
      '09.14',
      '27.33',
      '05.42',
      '16.38',
      '22.49二中二出60',
      '01.13.24',
      '07.19.31',
      '11.28.45三中三每组30',
      '02.15',
      '06.34',
      '18.47二中二出80',
    ].join('\n');

    assert.equal(
      mergeRecognizedChatTexts([first, second]),
      [
        '06.18.29',
        '12.25.44',
        '03.17.39',
        '08.21.46三中三每组40',
        '09.14',
        '27.33',
        '05.42',
        '16.38',
        '22.49二中二出60',
        '01.13.24',
        '07.19.31',
        '11.28.45三中三每组30',
        '02.15',
        '06.34',
        '18.47二中二出80',
      ].join('\n'),
    );
  });
});

describe('mergeModeTexts', () => {
  it('追加 OCR 识别结果时去掉输入区里已经存在的重叠内容', () => {
    const current = {
      pingma: ['12 35 08/250', '46 03 19 27 41 06 22 14/150'].join('\n'),
      lianma: '05.09二中二出50',
      fushi: '',
    };
    const addition = {
      pingma: ['46 03 19 27 41 06 22 14/150', '09 31 44 18 25/100'].join('\n'),
      lianma: '05.09二中二出50\n复式三中三各20',
      fushi: '',
    };

    assert.deepEqual(mergeModeTexts(current, addition), {
      pingma: ['12 35 08/250', '46 03 19 27 41 06 22 14/150', '09 31 44 18 25/100'].join('\n'),
      lianma: '05.09二中二出50\n复式三中三各20',
      fushi: '',
    });
  });
});

describe('getPreferredBetMode', () => {
  it('识别结果包含多个模式时优先展示行数最多的模式', () => {
    assert.equal(
      getPreferredBetMode({
        pingma: '15 24 39/250\n08 21 37 44/100',
        lianma: '04.17.32\n09.26.41\n13.28.45\n06.22.39三中三每组35',
        fushi: '复式三中三各20\n05.16.23.31.38.49',
      }),
      'lianma',
    );
  });
});

describe('classifyRecognizedChatTexts', () => {
  it('drops chat UI noise before classifying recognized chat text', () => {
    const result = classifyRecognizedChatTexts([
      [
        '1:10 . 654',
        '1 文件传输助手',
        '12 35 08/250',
        '46 03 19 27 41 06 22 14/150',
        '0',
      ].join('\n'),
    ]);

    assert.equal(result.pingma, '12 35 08/250\n46 03 19 27 41 06 22 14/150');
    assert.equal(result.lianma, '');
    assert.equal(parseBetGroups(result.pingma, 'pingma').reduce((sum, group) => sum + group.betAmount, 0), 1950);
  });

  it('normalizes odd compact OCR runs before classifying recognized chat text', () => {
    const result = classifyRecognizedChatTexts(['4603192 27 41 06 22 14/150']);

    assert.equal(result.pingma, '46 03 19 27 41 06 22 14/150');
    assert.equal(parseBetGroups(result.pingma, 'pingma').reduce((sum, group) => sum + group.betAmount, 0), 1200);
  });

  it('normalizes compact OCR runs with one inserted duplicate digit before classifying recognized chat text', () => {
    const result = classifyRecognizedChatTexts(['46031922741062214/150']);

    assert.equal(result.pingma, '46 03 19 27 41 06 22 14/150');
    assert.equal(parseBetGroups(result.pingma, 'pingma').reduce((sum, group) => sum + group.betAmount, 0), 1200);
  });

  it('classifies the dense chat OCR sample without losing compact slash continuation bets', () => {
    const result = classifyRecognizedChatTexts([
      [
        '1235 08/250',
        '4603192741062214/150',
        '0931441825/100',
        '澳门彩特码07号16号28号33号',
        '45号一个号各下30元,',
        '04号14号24号34号44号一个',
        '号各下20元',
        '234811/250',
        '0617293240052137441226',
        '08153049/150',
        '澳门彩特码10号13号18号22号',
        '27号31号36号39号42号48号',
        '一个号各下10元,',
        '05号15号25号35号45号一个',
        '号各下100元,',
        '06号16号26号36号46号一个',
        '号各下70元',
        '香港特码38号下300元',
        '03.12.29',
        '07.18.41',
        '09.22.36',
        '15.27.44三中三每组35',
        '06.14',
      ].join('\n'),
    ]);
    const summary = calculateAllModeDraftSummary(result);

    assert.equal(summary.totalBetAmount, 7090);
    assert.equal(parseBetGroups(result.pingma, 'pingma').reduce((sum, group) => sum + group.betAmount, 0), 6950);
    assert.equal(parseBetGroups(result.lianma, 'lianma').reduce((sum, group) => sum + group.betAmount, 0), 140);
  });

  it('合并多张聊天 OCR 文本时只删除真实重叠内容', () => {
    const result = classifyRecognizedChatTexts([
      '46.47\n4.14\n24.32\n9.10',
      '31.33\n21.25\n5.9二中二出50',
    ]);

    assert.equal(result.lianma, '46.47\n4.14\n24.32\n9.10\n31.33\n21.25\n5.9二中二出50');
  });
});
