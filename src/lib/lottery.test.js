import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildReportText,
  calculateAllModeDraftSummary,
  calculateAllModeLotteryResult,
  calculateLotteryResult,
  classifyBetText,
  parseBetGroups,
} from './lottery.js';

describe('parseBetGroups', () => {
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
});
