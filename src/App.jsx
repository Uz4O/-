import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  ClipboardCopy,
  Info,
  FileImage,
  KeyRound,
  Link2Off,
  Lock,
  Plus,
  Trash2,
  RefreshCw,
  RotateCcw,
  ScanText,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import {
  appVersion,
  betModes,
  buildReportText,
  calculateAllModeDraftSummary,
  calculateAllModeLotteryResult,
  classifyRecognizedChatTexts,
  formatMoney,
  formatTableBetsAsBetText,
  getZodiacByNumber,
  initialModeTexts,
  initialSummary,
  joinBetText,
  normalizeMarkSixNumber,
} from './lib/lottery.js';
import { buildLicenseHeaders, createBrowserId, toGeneratedCodeRows } from './lib/licenseClient.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function compressImageForRecognition(file, options = {}) {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageUrl);
    const maxSide = options.maxSide || 1200;
    const minWidth = options.minWidth || 0;
    const quality = options.quality || 0.75;
    const crop = options.crop || {};
    const cropLeft = Math.round(image.naturalWidth * (crop.left || 0));
    const cropTop = Math.round(image.naturalHeight * (crop.top || 0));
    const cropRight = Math.round(image.naturalWidth * (crop.right || 0));
    const cropBottom = Math.round(image.naturalHeight * (crop.bottom || 0));
    const sourceWidth = Math.max(1, image.naturalWidth - cropLeft - cropRight);
    const sourceHeight = Math.max(1, image.naturalHeight - cropTop - cropBottom);
    const longestSide = Math.max(sourceWidth, sourceHeight);
    const sideScale = Math.min(1, maxSide / longestSide);
    const widthScale = minWidth > 0 && sourceWidth < minWidth ? minWidth / sourceWidth : 1;
    const scale = Math.max(sideScale, widthScale);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, cropLeft, cropTop, sourceWidth, sourceHeight, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });

    if (!blob) {
      return {
        imageBase64: await fileToBase64(file),
        mimeType: file.type || 'image/jpeg',
        originalSize: file.size,
        compressedSize: file.size,
      };
    }

    return {
      imageBase64: await blobToBase64(blob),
      mimeType: 'image/jpeg',
      originalSize: file.size,
      compressedSize: blob.size,
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      response.ok
        ? '识别接口返回空内容'
        : '识别后端没有返回内容，请确认 npm.cmd run start 正在运行',
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`识别接口返回的不是 JSON：${text.slice(0, 120)}`);
  }
}

async function postRecognitionRequest(path, body) {
  const urlToken = new URLSearchParams(window.location.search).get('ocrToken');
  const storedToken = window.localStorage.getItem('ocrToken');
  const ocrToken = urlToken || storedToken || '';
  if (urlToken) window.localStorage.setItem('ocrToken', urlToken);
  const licenseCardId = window.localStorage.getItem(licenseCardIdKey);
  const licenseBrowserId = window.localStorage.getItem(licenseBrowserIdKey);
  const licenseHeaders = buildLicenseHeaders(licenseCardId, licenseBrowserId);

  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ocrToken ? { 'x-ocr-token': ocrToken } : {}),
      ...licenseHeaders,
    },
    body: JSON.stringify(body),
  };

  try {
    return await fetch(path, requestOptions);
  } catch (error) {
    const { protocol, hostname } = window.location;
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') throw error;
    return fetch(`${protocol}//${hostname}:8787${path}`, requestOptions);
  }
}

const licenseBrowserIdKey = 'markSixLicenseBrowserId';
const licenseCardIdKey = 'markSixLicenseCardId';

function getBrowserId() {
  const stored = window.localStorage.getItem(licenseBrowserIdKey);
  if (stored) return stored;

  const next = createBrowserId();
  window.localStorage.setItem(licenseBrowserIdKey, next);
  return next;
}

function formatLicenseDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getLicenseDaysLeft(card) {
  if (!card?.expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(card.expiresAt).getTime() - Date.now()) / 86400000));
}

async function fetchJson(path, options = {}) {
  const licenseCardId = window.localStorage.getItem(licenseCardIdKey);
  const licenseBrowserId = window.localStorage.getItem(licenseBrowserIdKey);
  const licenseHeaders = buildLicenseHeaders(licenseCardId, licenseBrowserId);
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...licenseHeaders,
      ...(options.headers || {}),
    },
  });
  const payload = await readJsonResponse(response);
  return { response, payload };
}

function LicenseGate({ children }) {
  const [browserId] = useState(() => getBrowserId());
  const [licenseCard, setLicenseCard] = useState(null);
  const [cardCode, setCardCode] = useState('');
  const [status, setStatus] = useState('checking');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    async function checkSession() {
      const cardId = window.localStorage.getItem(licenseCardIdKey);
      if (!cardId) {
        setStatus('idle');
        return;
      }

      try {
        const { response, payload } = await fetchJson(
          `/api/license/session?cardId=${encodeURIComponent(cardId)}&browserId=${encodeURIComponent(browserId)}`,
        );
        if (!response.ok || !payload.ok) throw new Error(payload.error || '卡密已失效');

        setLicenseCard(payload.card);
        setStatus('authorized');
      } catch (error) {
        window.localStorage.removeItem(licenseCardIdKey);
        setErrorText(error instanceof Error ? error.message : '卡密校验失败，请重新激活');
        setStatus('idle');
      }
    }

    void checkSession();
  }, [browserId]);

  async function handleActivate(event) {
    event.preventDefault();
    if (!cardCode.trim()) return;

    setStatus('activating');
    setErrorText('');
    try {
      const { response, payload } = await fetchJson('/api/license/activate', {
        method: 'POST',
        body: JSON.stringify({
          code: cardCode.trim(),
          browserId,
        }),
      });

      if (!response.ok || !payload.ok) throw new Error(payload.error || '卡密激活失败');

      window.localStorage.setItem(licenseCardIdKey, payload.card.id);
      setLicenseCard(payload.card);
      setStatus('authorized');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '卡密激活失败');
      setStatus('idle');
    }
  }

  if (status === 'authorized') {
    return (
      <>
        <div className="license-ribbon">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>已激活，剩余 {getLicenseDaysLeft(licenseCard)} 天，到期 {formatLicenseDate(licenseCard?.expiresAt)}</span>
        </div>
        {children}
      </>
    );
  }

  return (
    <main className="license-shell">
      <section className="license-panel">
        <div className="license-mark">
          <Lock size={30} aria-hidden="true" />
        </div>
        <p className="section-label">Paid Access</p>
        <h1>卡密激活</h1>
        <form className="license-form" onSubmit={handleActivate}>
          <label>
            输入卡密
            <input
              value={cardCode}
              onChange={(event) => setCardCode(event.target.value.toUpperCase())}
              placeholder="MK6-XXXX-XXXX-XXXX"
              autoComplete="off"
              disabled={status === 'checking' || status === 'activating'}
            />
          </label>
          <button type="submit" className="primary-button" disabled={!cardCode.trim() || status === 'checking' || status === 'activating'}>
            <KeyRound size={18} aria-hidden="true" />
            {status === 'activating' ? '正在激活' : status === 'checking' ? '正在校验' : '激活进入工作台'}
          </button>
        </form>
        {errorText && <p className="license-error">{errorText}</p>}
      </section>
    </main>
  );
}

function AdminCardsPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [cards, setCards] = useState([]);
  const [plainCodes, setPlainCodes] = useState([]);
  const [copiedCode, setCopiedCode] = useState('');
  const [count, setCount] = useState(1);
  const [durationDays, setDurationDays] = useState(30);
  const [note, setNote] = useState('');
  const [statusText, setStatusText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState('');
  const selectedCard = cards.find((card) => card.id === selectedCardId) || null;

  async function loadCards() {
    const { response, payload } = await fetchJson('/api/admin/cards');
    if (!response.ok || !payload.ok) {
      setIsAuthed(false);
      throw new Error(payload.error || '请先登录后台');
    }

    const nextCards = payload.cards || [];
    setCards(nextCards);
    setSelectedCardId((current) => {
      if (current && nextCards.some((card) => card.id === current)) return current;
      return nextCards[0]?.id || '';
    });
    setIsAuthed(true);
  }

  useEffect(() => {
    void loadCards().catch(() => {});
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setIsBusy(true);
    setStatusText('');
    try {
      const { response, payload } = await fetchJson('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (!response.ok || !payload.ok) throw new Error(payload.error || '登录失败');
      await loadCards();
      setStatusText('已登录后台');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '登录失败');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setIsBusy(true);
    setStatusText('');
    try {
      const { response, payload } = await fetchJson('/api/admin/cards/generate', {
        method: 'POST',
        body: JSON.stringify({
          count,
          durationDays,
          note,
        }),
      });
      if (!response.ok || !payload.ok) throw new Error(payload.error || '生成失败');
      setPlainCodes(payload.plainCodes || []);
      setCopiedCode('');
      await loadCards();
      setStatusText(`已生成 ${payload.plainCodes?.length || 0} 张卡密`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '生成失败');
    } finally {
      setIsBusy(false);
    }
  }

  async function updateCard(pathname, successText) {
    setIsBusy(true);
    setStatusText('');
    try {
      const { response, payload } = await fetchJson(pathname, { method: 'POST' });
      if (!response.ok || !payload.ok) throw new Error(payload.error || successText);
      await loadCards();
      setStatusText(successText);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : successText);
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteCard(card) {
    const label = card.note || card.id;
    if (!window.confirm(`确定删除这张卡密吗？\n${label}\n删除后列表将不再显示，已激活用户也不能继续使用。`)) return;

    await updateCard(`/api/admin/cards/${card.id}/delete`, '已删除卡密');
  }

  async function copyGeneratedCode(code) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => {
      setCopiedCode((current) => (current === code ? '' : current));
    }, 1400);
  }

  if (!isAuthed) {
    return (
      <main className="license-shell">
        <section className="license-panel">
          <div className="license-mark">
            <ShieldCheck size={30} aria-hidden="true" />
          </div>
          <p className="section-label">Admin</p>
          <h1>卡密后台</h1>
          <form className="license-form" onSubmit={handleLogin}>
            <label>
              管理密码
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="primary-button" disabled={!password.trim() || isBusy}>
              <Lock size={18} aria-hidden="true" />
              登录后台
            </button>
          </form>
          {statusText && <p className="license-error">{statusText}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar admin-topbar">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>卡密后台</h1>
        </div>
        <a className="admin-link" href="/">返回工作台</a>
      </header>

      <section className="admin-grid">
        <form className="panel admin-form" onSubmit={handleGenerate}>
          <div className="panel-heading">
            <div>
              <p className="section-label">生成卡密</p>
              <h2>创建新卡</h2>
            </div>
            <Plus size={22} aria-hidden="true" />
          </div>
          <div className="field-grid">
            <label>
              数量
              <input value={count} onChange={(event) => setCount(event.target.value)} type="number" min="1" max="200" />
            </label>
            <label>
              有效天数
              <input value={durationDays} onChange={(event) => setDurationDays(event.target.value)} type="number" min="1" max="3650" />
            </label>
            <label className="full-field">
              备注
              <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="客户名或用途" />
            </label>
          </div>
          <button type="submit" className="primary-button" disabled={isBusy}>
            生成卡密
          </button>
          {statusText && <p className="admin-status">{statusText}</p>}
        </form>

        <section className="panel generated-panel">
          <p className="section-label">明文卡密</p>
          <h2>仅本次显示</h2>
          <div className="generated-list">
            {plainCodes.length ? (
              toGeneratedCodeRows(plainCodes).map(({ id, code }) => (
                <div className="generated-code-row" key={id}>
                  <code>{code}</code>
                  <button type="button" onClick={() => copyGeneratedCode(code)} title="复制卡密">
                    <ClipboardCopy size={15} aria-hidden="true" />
                    {copiedCode === code ? '已复制' : '复制'}
                  </button>
                </div>
              ))
            ) : (
              <span>生成后这里会显示可复制的明文卡密</span>
            )}
          </div>
        </section>
      </section>

      <section className="card-admin-grid">
      <section className="panel card-list-panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">卡密列表</p>
            <h2>{cards.length} 张卡</h2>
          </div>
          <button type="button" className="ghost-button" onClick={() => loadCards()} disabled={isBusy}>
            刷新
          </button>
        </div>
        <div className="card-table">
          {cards.map((card) => (
            <article
              className={`card-row ${selectedCardId === card.id ? 'is-selected' : ''}`}
              key={card.id}
              onClick={() => setSelectedCardId(card.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedCardId(card.id);
              }}
            >
              <div>
                <strong>{card.note || '未备注'}</strong>
                <span>{card.durationDays} 天 · {card.isBound ? '已绑定' : '未绑定'} · 到期 {formatLicenseDate(card.expiresAt)}</span>
              </div>
              <b className={`card-status is-${card.status}`}>{card.status}</b>
              <div className="card-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => updateCard(`/api/admin/cards/${card.id}/reset-binding`, '已解绑卡密')}
                  disabled={isBusy || card.status !== 'active'}
                  title="解绑浏览器"
                >
                  <Link2Off size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => updateCard(`/api/admin/cards/${card.id}/disable`, '已禁用卡密')}
                  disabled={isBusy || card.status === 'disabled'}
                  title="禁用卡密"
                >
                  <Ban size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button danger-button"
                  onClick={() => deleteCard(card)}
                  disabled={isBusy}
                  title="删除卡密"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
          {!cards.length && (
            <div className="empty-card-list">
              <Info size={18} aria-hidden="true" />
              <span>暂无卡密，先在上方生成新卡。</span>
            </div>
          )}
        </div>
      </section>
      <aside className="panel card-detail-panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">卡密信息</p>
            <h2>{selectedCard ? (selectedCard.note || '未备注卡密') : '未选择卡密'}</h2>
          </div>
          <Info size={22} aria-hidden="true" />
        </div>
        {selectedCard ? (
          <dl className="card-detail-list">
            <div>
              <dt>卡密</dt>
              <dd className="detail-code-line">
                {selectedCard.code ? (
                  <>
                    <code>{selectedCard.code}</code>
                    <button type="button" onClick={() => copyGeneratedCode(selectedCard.code)}>
                      <ClipboardCopy size={14} aria-hidden="true" />
                      {copiedCode === selectedCard.code ? '已复制' : '复制'}
                    </button>
                  </>
                ) : (
                  <span>旧卡未保存明文</span>
                )}
              </dd>
            </div>
            <div>
              <dt>卡密 ID</dt>
              <dd>{selectedCard.id}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{selectedCard.status}</dd>
            </div>
            <div>
              <dt>有效天数</dt>
              <dd>{selectedCard.durationDays} 天</dd>
            </div>
            <div>
              <dt>绑定状态</dt>
              <dd>{selectedCard.isBound ? '已绑定浏览器' : '未绑定'}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatLicenseDate(selectedCard.createdAt)}</dd>
            </div>
            <div>
              <dt>激活时间</dt>
              <dd>{formatLicenseDate(selectedCard.activatedAt)}</dd>
            </div>
            <div>
              <dt>到期时间</dt>
              <dd>{formatLicenseDate(selectedCard.expiresAt)}</dd>
            </div>
            <div>
              <dt>最近使用</dt>
              <dd>{formatLicenseDate(selectedCard.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>备注</dt>
              <dd>{selectedCard.note || '-'}</dd>
            </div>
          </dl>
        ) : (
          <div className="empty-card-list">
            <Info size={18} aria-hidden="true" />
            <span>点击左侧任意卡密查看详情。</span>
          </div>
        )}
      </aside>
      </section>
    </main>
  );
}

function WorkbenchApp() {
  const [betMode, setBetMode] = useState('pingma');
  const [modeTexts, setModeTexts] = useState(initialModeTexts);
  const [screenshots, setScreenshots] = useState([]);
  const [hasSelectedFiles, setHasSelectedFiles] = useState(false);
  const [drawNumber, setDrawNumber] = useState('');
  const [extraDrawNumbers, setExtraDrawNumbers] = useState('');
  const [drawZodiac, setDrawZodiac] = useState('');
  const [latestDraw, setLatestDraw] = useState(null);
  const [latestDrawStatus, setLatestDrawStatus] = useState('正在同步最新开奖');
  const [isSyncingDraw, setIsSyncingDraw] = useState(false);
  const [summary, setSummary] = useState(initialSummary);
  const [winners, setWinners] = useState([]);
  const [statusText, setStatusText] = useState('等待输入截图、文本和开奖信息');
  const [uploadDebugText, setUploadDebugText] = useState('未选择图片');
  const [isDragging, setIsDragging] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionProgress, setRecognitionProgress] = useState(0);
  const [copyState, setCopyState] = useState('复制汇报');
  const [hasGenerated, setHasGenerated] = useState(false);
  const screenshotsRef = useRef([]);
  const fileInputRef = useRef(null);
  const plainFileInputRef = useRef(null);
  const selectedFilesRef = useRef([]);
  const isSyncingDrawRef = useRef(false);
  const modeTextsRef = useRef(initialModeTexts);
  const hasGeneratedRef = useRef(false);
  const drawInputsRef = useRef({
    drawNumber: '',
    extraDrawNumbers: '',
    drawZodiac: '',
  });

  const normalizedDrawNumber = normalizeMarkSixNumber(drawNumber);
  const canGenerate = normalizedDrawNumber && drawZodiac.trim();
  const canRecognizeUploaded = hasSelectedFiles || screenshots.length > 0;
  const uploadedPhotoCount = screenshots.length || selectedFilesRef.current.length;
  const recognitionDone = recognitionProgress === 100 && !isRecognizing;
  const activeBetMode = betModes.find((mode) => mode.id === betMode) || betModes[0];
  const rawText = modeTexts[betMode] || '';
  const draftSummary = useMemo(() => calculateAllModeDraftSummary(modeTexts), [modeTexts]);

  function updateActiveModeText(value) {
    setModeTexts((current) => ({
      ...current,
      [betMode]: value,
    }));
  }

  function appendModeTexts(nextTexts) {
    const mergedTexts = {
      pingma: joinBetText(modeTexts.pingma, nextTexts.pingma),
      lianma: joinBetText(modeTexts.lianma, nextTexts.lianma),
      fushi: joinBetText(modeTexts.fushi, nextTexts.fushi),
    };

    setModeTexts(mergedTexts);
    return mergedTexts;
  }

  function generateFromModeTexts(nextModeTexts, successText) {
    if (!canGenerate) {
      setSummary(initialSummary);
      setWinners([]);
      setHasGenerated(false);
      setCopyState('复制汇报');
      setStatusText(`${successText}，等待开奖信息后自动计算`);
      return;
    }

    const result = calculateAllModeLotteryResult(nextModeTexts, {
      screenshots,
      drawNumber: normalizedDrawNumber,
      extraDrawNumbers,
      drawZodiac: drawZodiac.trim(),
    });

    setSummary(result.summary);
    setWinners(result.winners);
    setCopyState('复制汇报');
    setHasGenerated(true);
    setStatusText(`${successText}，已自动生成计算结果`);
  }

  const uploadHint = useMemo(() => {
    if (!screenshots.length) return '支持多张截图，当前先做预览和待识别占位';
    return `已上传 ${screenshots.length} 张截图，等待后续接入 OCR`;
  }, [screenshots.length]);
  useEffect(() => {
    screenshotsRef.current = screenshots;
  }, [screenshots]);

  useEffect(() => {
    modeTextsRef.current = modeTexts;
  }, [modeTexts]);

  useEffect(() => {
    hasGeneratedRef.current = hasGenerated;
  }, [hasGenerated]);

  useEffect(() => {
    drawInputsRef.current = {
      drawNumber,
      extraDrawNumbers,
      drawZodiac,
    };
  }, [drawNumber, extraDrawNumbers, drawZodiac]);

  useEffect(() => {
    return () => {
      screenshotsRef.current.forEach((item) => {
        if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  useEffect(() => {
    setDrawZodiac(getZodiacByNumber(drawNumber));
  }, [drawNumber]);

  useEffect(() => {
    void syncLatestDraw(false);

    const syncTimer = window.setInterval(() => {
      void syncLatestDraw(false);
    }, 60000);

    return () => window.clearInterval(syncTimer);
  }, []);

  async function syncLatestDraw(forceRefresh = false) {
    if (isSyncingDrawRef.current) return;

    isSyncingDrawRef.current = true;
    setIsSyncingDraw(true);
    setLatestDrawStatus(forceRefresh ? '正在重新同步开奖' : '正在同步最新开奖');

    try {
      const { response, payload } = await fetchJson(`/api/latest-lottery-result${forceRefresh ? '?refresh=1' : ''}`);

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.sync?.lastError || payload.error || '没有拿到最新开奖');
      }

      setLatestDraw(payload.data);
      setLatestDrawStatus(`已同步 ${payload.data.date} 第${payload.data.issue}期`);
      applyLatestDraw(payload.data);
    } catch (error) {
      setLatestDrawStatus(`同步失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      isSyncingDrawRef.current = false;
      setIsSyncingDraw(false);
    }
  }

  function applyLatestDraw(draw = latestDraw) {
    if (!draw) return;

    const nextDrawNumber = draw.specialNumber || '';
    const nextExtraDrawNumbers = (draw.normalNumbers || []).join('.');
    const nextDrawZodiac = draw.specialZodiac || getZodiacByNumber(draw.specialNumber);
    const currentDrawInputs = drawInputsRef.current;
    const isSameDraw =
      currentDrawInputs.drawNumber === nextDrawNumber &&
      currentDrawInputs.extraDrawNumbers === nextExtraDrawNumbers &&
      currentDrawInputs.drawZodiac === nextDrawZodiac;

    setDrawNumber(nextDrawNumber);
    setExtraDrawNumbers(nextExtraDrawNumbers);
    setDrawZodiac(nextDrawZodiac);

    if (isSameDraw) return;

    if (hasGeneratedRef.current) {
      const result = calculateAllModeLotteryResult(modeTextsRef.current, {
        screenshots: screenshotsRef.current,
        drawNumber: nextDrawNumber,
        extraDrawNumbers: nextExtraDrawNumbers,
        drawZodiac: nextDrawZodiac,
      });

      setSummary(result.summary);
      setWinners(result.winners);
      setCopyState('复制汇报');
      setHasGenerated(true);
      setStatusText(`已自动同步第${draw.issue}期并重新计算：特码${nextDrawNumber}/${nextDrawZodiac}`);
      return;
    }

    setStatusText(`已自动同步第${draw.issue}期：特码${nextDrawNumber}/${nextDrawZodiac}`);
  }


  async function addScreenshots(fileList) {
    const incomingFiles = Array.from(fileList || []);
    setUploadDebugText(
      incomingFiles.length
        ? `已选择 ${incomingFiles.length} 个文件：${incomingFiles
            .map((file) => `${file.name || '未命名'} / ${file.type || '未知类型'} / ${file.size || 0}B`)
            .join('；')}`
        : '选择器没有返回文件',
    );
    setHasSelectedFiles(incomingFiles.length > 0);
    selectedFilesRef.current = incomingFiles;

    const imageFiles = Array.from(fileList || []).filter((file) => {
      const fileName = file.name || '';
      return (
        file.type.startsWith('image/') ||
        !file.type ||
        /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(fileName)
      );
    });

    if (!imageFiles.length) {
      setStatusText('没有读取到图片，请重新选择相册截图');
      return;
    }

    const nextScreenshots = await Promise.all(
      imageFiles.map(async (file) => {
        let previewUrl = '';
        try {
          previewUrl = await fileToDataUrl(file);
        } catch {
          previewUrl = '';
        }

        return {
          id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          name: file.name || '手机截图',
          size: file.size,
          file,
          previewUrl,
        };
      }),
    );

    setScreenshots((current) => [...current, ...nextScreenshots]);
    setStatusText(`已添加 ${imageFiles.length} 张截图，可点击 OCR 识别`);
  }

  function clearUploadedPhotos() {
    setScreenshots((current) => {
      current.forEach((item) => {
        if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    selectedFilesRef.current = [];
    setHasSelectedFiles(false);
    setUploadDebugText('未选择图片');
    setRecognitionProgress(0);
    setStatusText('已清除已上传图片');
  }

  function getRecognitionSources() {
    if (screenshots.length) {
      return screenshots.map((item, index) => ({
        file: item.file,
        name: item.name || `图片${index + 1}`,
      }));
    }

    return selectedFilesRef.current.map((file, index) => ({
      file,
      name: file.name || `图片${index + 1}`,
    }));
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    void addScreenshots(event.dataTransfer.files);
  }

  async function handleRecognizeUploadedTables() {
    const sources = getRecognitionSources();
    if (isRecognizing) return;
    if (!sources.length) {
      setStatusText('请先上传表格截图后再识别');
      return;
    }

    setIsRecognizing(true);
    setRecognitionProgress(12);
    setStatusText(`正在提交 ${sources.length} 张图片进行 OCR 表格识别`);

    try {
      const recognizedTexts = [];
      let detectedCount = 0;

      for (const [index, source] of sources.entries()) {
        const currentIndex = index + 1;
        const compressedImage = await compressImageForRecognition(source.file);
        const compressRatio = compressedImage.originalSize
          ? Math.round((compressedImage.compressedSize / compressedImage.originalSize) * 100)
          : 100;

        setRecognitionProgress(Math.round(16 + (index / sources.length) * 66));
        setStatusText(`正在识别第 ${currentIndex}/${sources.length} 张表格，图片已压缩到原大小 ${compressRatio}%`);

        const response = await postRecognitionRequest('/api/recognize-table', {
          imageBase64: compressedImage.imageBase64,
          mimeType: compressedImage.mimeType,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(payload.error || `第 ${currentIndex} 张 OCR 识别表格失败`);
        }

        const bets = payload.bets || {};
        const formattedText = typeof payload.text === 'string' && payload.text.trim()
          ? payload.text.trim()
          : formatTableBetsAsBetText(bets);

        if (formattedText) {
          recognizedTexts.push(formattedText);
          detectedCount += Object.keys(bets).length;
        }
      }

      const combinedText = recognizedTexts.join('\n');
      if (!combinedText) {
        setRecognitionProgress(0);
        setStatusText('OCR 没有识别到表格金额，请换更清晰图片或手动填写');
        return;
      }

      const nextModeTexts = appendModeTexts({ ...initialModeTexts, pingma: combinedText });
      setBetMode('pingma');
      setRecognitionProgress(100);
      generateFromModeTexts(nextModeTexts, `OCR 已识别 ${sources.length} 张图片、${detectedCount} 个号码金额，已追加到输入区`);
    } catch (error) {
      setRecognitionProgress(0);
      setStatusText(`OCR 识别表格失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsRecognizing(false);
    }
  }

  async function handleRecognizeUploadedChats() {
    const sources = getRecognitionSources();
    if (isRecognizing) return;
    if (!sources.length) {
      setStatusText('请先上传聊天截图后再识别');
      return;
    }

    setIsRecognizing(true);
    setRecognitionProgress(12);
    setStatusText(`正在提交 ${sources.length} 张图片进行 OCR 文字识别`);

    try {
      const recognizedTexts = [];

      for (const [index, source] of sources.entries()) {
        const currentIndex = index + 1;
        const compressedImage = await compressImageForRecognition(source.file, {
          maxSide: 2600,
          minWidth: 900,
          quality: 0.92,
          crop: {
            top: 0.105,
          },
        });
        const compressRatio = compressedImage.originalSize
          ? Math.round((compressedImage.compressedSize / compressedImage.originalSize) * 100)
          : 100;

        setRecognitionProgress(Math.round(16 + (index / sources.length) * 66));
        setStatusText(`正在识别第 ${currentIndex}/${sources.length} 张聊天图，图片已压缩到原大小 ${compressRatio}%`);

        const response = await postRecognitionRequest('/api/recognize-chat', {
          imageBase64: compressedImage.imageBase64,
          mimeType: compressedImage.mimeType,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(payload.error || `第 ${currentIndex} 张 OCR 识别文字失败`);
        }

        const formattedText = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (formattedText) recognizedTexts.push(formattedText);
      }

      const classifiedTexts = classifyRecognizedChatTexts(recognizedTexts);
      const hasClassifiedText = Object.values(classifiedTexts).some((text) => text.trim());
      if (!hasClassifiedText) {
        setRecognitionProgress(0);
        setStatusText('OCR 没有提取到有效投注内容，请换更清晰截图或手动填写');
        return;
      }

      const counts = Object.entries(classifiedTexts)
        .filter(([, text]) => text.trim())
        .map(([mode, text]) => `${betModes.find((item) => item.id === mode)?.label || mode}${text.split(/\r?\n/).filter(Boolean).length}行`);

      const nextModeTexts = appendModeTexts(classifiedTexts);
      setBetMode(classifiedTexts.fushi.trim() ? 'fushi' : classifiedTexts.lianma.trim() ? 'lianma' : 'pingma');
      setRecognitionProgress(100);
      generateFromModeTexts(
        nextModeTexts,
        `OCR 已分类 ${sources.length} 张图片：${counts.length ? counts.join('，') : '未分类到有效内容'}`,
      );
    } catch (error) {
      setRecognitionProgress(0);
      setStatusText(`OCR 识别文字失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsRecognizing(false);
    }
  }

  function handleGenerate() {
    if (!canGenerate) return;

    const result = calculateAllModeLotteryResult(modeTexts, {
      screenshots,
      drawNumber: normalizedDrawNumber,
      extraDrawNumbers,
      drawZodiac: drawZodiac.trim(),
    });

    setSummary(result.summary);
    setWinners(result.winners);
    setStatusText(result.statusText);
    setCopyState('复制汇报');
    setHasGenerated(true);
  }

  async function handleCopyReport() {
    if (!hasGenerated) return;

    const reportText = buildReportText(summary, winners, drawNumber, drawZodiac);
    await navigator.clipboard.writeText(reportText);
    setCopyState('已复制');
    window.setTimeout(() => setCopyState('复制汇报'), 1400);
  }

  function handleClearRawText() {
    setModeTexts((current) => ({
      ...current,
      [betMode]: '',
    }));
    setRecognitionProgress(0);
    setSummary(initialSummary);
    setWinners([]);
    setStatusText('已清除填入信息');
    setCopyState('复制汇报');
    setHasGenerated(false);
  }

  function handleReset() {
    setModeTexts(initialModeTexts);
    setScreenshots([]);
    setHasSelectedFiles(false);
    selectedFilesRef.current = [];
    setUploadDebugText('未选择图片');
    setRecognitionProgress(0);
    setDrawNumber('');
    setExtraDrawNumbers('');
    setDrawZodiac('');
    setSummary(initialSummary);
    setWinners([]);
    setStatusText('等待输入截图、文本和开奖信息');
    setCopyState('复制汇报');
    setHasGenerated(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Data Workbench</p>
          <h1>计算工作台</h1>
          <span className="app-version">{appVersion}</span>
        </div>
        <div className="topbar-status">
          <span>当前结果</span>
          <strong>{hasGenerated ? `${winners.length} 人中奖` : '未生成'}</strong>
        </div>
      </header>

      <section className="panel quick-summary top-summary">
        <p className="section-label">金额汇总</p>
        <div className="metric">
          <span>已录入投注金额</span>
          <strong>{formatMoney(draftSummary.totalBetAmount)}</strong>
        </div>
        <div className="metric accent">
          <span>中奖金额</span>
          <strong>{formatMoney(hasGenerated ? summary.totalWinAmount : 0)}</strong>
        </div>
      </section>

      <nav className="mode-tabs" aria-label="计算模式">
        {betModes.map((mode) => (
          <button
            type="button"
            key={mode.id}
            className={betMode === mode.id ? 'is-active' : ''}
            onClick={() => {
              setBetMode(mode.id);
              setStatusText(`已切换到${mode.label}模式`);
            }}
          >
            {mode.label}
            {modeTexts[mode.id]?.trim() && (
              <span>{modeTexts[mode.id].split(/\r?\n/).filter(Boolean).length}</span>
            )}
          </button>
        ))}
      </nav>

      <section className="workspace">
        <div className="input-column">
          <section className="panel screenshot-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">截图输入</p>
                <h2>上传投注截图</h2>
              </div>
              <FileImage aria-hidden="true" size={22} />
            </div>

            <div
              className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  void addScreenshots(event.target.files);
                  event.target.value = '';
                }}
              />
              <input
                ref={plainFileInputRef}
                type="file"
                multiple
                onChange={(event) => {
                  void addScreenshots(event.target.files);
                  event.target.value = '';
                }}
              />
              <UploadCloud aria-hidden="true" size={28} />
              <span>拖入截图或点击上传</span>
              <small>{uploadHint}</small>
              <small className="upload-debug">{uploadDebugText}</small>
              <button
                type="button"
                className={`upload-button ${uploadedPhotoCount ? 'has-files' : ''}`}
                data-label={uploadedPhotoCount ? `已上传 ${uploadedPhotoCount} 张` : '上传照片'}
                onClick={() => fileInputRef.current?.click()}
              >
                上传照片
              </button>
              <button
                type="button"
                className={`ghost-button clear-upload-button ${uploadedPhotoCount ? '' : 'is-hidden'}`}
                onClick={clearUploadedPhotos}
                aria-label="清除已上传图片"
                title="清除已上传图片"
              >
                清除
              </button>
              {(hasSelectedFiles || screenshots.length > 0) && (
                <div className="recognize-actions inline-recognize-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRecognizeUploadedTables}
                    disabled={isRecognizing}
                    data-label={isRecognizing ? '正在识别' : `识别表格 · ${uploadedPhotoCount}张`}
                  >
                    <ScanText size={17} aria-hidden="true" />
                    {isRecognizing ? '正在识别' : `识别表格 · ${uploadedPhotoCount}张`}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleRecognizeUploadedChats}
                    disabled={isRecognizing}
                    data-label={`识别文字 · ${uploadedPhotoCount}张`}
                  >
                    识别文字 · {uploadedPhotoCount}张
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="panel text-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">手动输入</p>
                <h2>{activeBetMode.title}</h2>
              </div>
              <span className="line-count">{rawText.split(/\r?\n/).filter(Boolean).length} 行</span>
            </div>
            <div className="textarea-wrap">
              <button
                type="button"
                className="clear-text-button"
                onClick={handleClearRawText}
                disabled={!rawText.trim()}
              >
                清除
              </button>
              <textarea
                value={rawText}
                onChange={(event) => updateActiveModeText(event.target.value)}
                placeholder={activeBetMode.placeholder}
                spellCheck="false"
              />
            </div>
            <div className="text-recognition-footer">
              <div className={`inline-status ${recognitionDone ? 'is-success' : ''}`}>
                <div>
                  <span>识别状态</span>
                  <strong>{statusText}</strong>
                </div>
                <div className="progress-track" aria-label="识别进度">
                  <div
                    className="progress-fill"
                    style={{ width: `${isRecognizing ? Math.max(recognitionProgress, 8) : recognitionProgress}%` }}
                  />
                </div>
                {recognitionDone && <em>识别成功，已追加到文本输入区</em>}
              </div>

              <div className="recognize-actions text-recognize-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleRecognizeUploadedTables}
                  disabled={!canRecognizeUploaded || isRecognizing}
                >
                  <ScanText size={17} aria-hidden="true" />
                  {isRecognizing ? '正在识别' : '识别表格'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleRecognizeUploadedChats}
                  disabled={!canRecognizeUploaded || isRecognizing}
                >
                  识别文字
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="control-column">
          <section className="panel draw-panel">
            <p className="section-label">开奖信息</p>
            <h2>填写当天结果</h2>
            <div className="latest-draw-box">
              <div>
                <span>最新开奖</span>
                <strong>
                  {latestDraw
                    ? `${latestDraw.date} 第${latestDraw.issue}期 特码 ${latestDraw.specialNumber}/${latestDraw.specialZodiac}`
                    : latestDrawStatus}
                </strong>
              </div>
              <div className="latest-draw-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => syncLatestDraw(true)}
                  disabled={isSyncingDraw}
                  aria-label="重新同步开奖"
                  title="重新同步开奖"
                >
                  <RefreshCw size={16} aria-hidden="true" />
                </button>
              </div>
              {latestDraw && (
                <small>
                  正码 {(latestDraw.normalNumbers || []).join('.')}，同步时间{' '}
                  {latestDraw.syncedAt ? new Date(latestDraw.syncedAt).toLocaleString('zh-CN') : '-'}
                </small>
              )}
              {!latestDraw && <small>{latestDrawStatus}</small>}
            </div>
            <div className="field-grid">
              <label>
                开奖数字
                <input
                  value={drawNumber}
                  onChange={(event) => setDrawNumber(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                  inputMode="numeric"
                  placeholder="01-49"
                />
              </label>
              <label>
                自动生肖
                <input value={drawZodiac || '等待开奖数字'} readOnly />
              </label>
              <label className="full-field">
                其他开奖号码
                <input
                  value={extraDrawNumbers}
                  onChange={(event) => setExtraDrawNumbers(event.target.value)}
                  placeholder="连码用，例：01.02.03.04.05"
                />
              </label>
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              title={!canGenerate ? '先填写开奖数字和生肖' : '生成计算结果'}
            >
              生成计算结果
            </button>

            {!canGenerate && <p className="form-tip">需要填入 01-49 的开奖数字，生肖会自动选择。</p>}
          </section>

          <section className="panel quick-summary">
            <p className="section-label">金额汇总</p>
            <div className="metric">
              <span>总赌注金额</span>
              <strong>{formatMoney(draftSummary.totalBetAmount)}</strong>
            </div>
            <div className="metric accent">
              <span>总用户中奖金额</span>
              <strong>{formatMoney(hasGenerated ? summary.totalWinAmount : 0)}</strong>
            </div>
          </section>
        </div>

        <aside className="result-panel">
          <div className="result-header">
            <div>
              <p className="section-label">副窗口</p>
              <h2>中奖发放名单</h2>
            </div>
            <div className="result-actions">
              <button
                type="button"
                className="icon-button"
                onClick={handleCopyReport}
                disabled={!hasGenerated}
                aria-label="复制汇报"
                title="复制汇报"
              >
                <ClipboardCopy size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={handleReset}
                aria-label="清空重新计算"
                title="清空重新计算"
              >
                <RotateCcw size={17} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="report-card">
            <span>汇报文本</span>
            <button type="button" onClick={handleCopyReport} disabled={!hasGenerated}>
              {copyState}
            </button>
          </div>

          <div className="winner-list">
            {winners.length === 0 ? (
              <div className="empty-state">
                <strong>暂无中奖名单</strong>
                <span>生成后这里会列出中奖用户和应发金额。</span>
              </div>
            ) : (
              winners.map((winner) => (
                <article className="winner-row" key={winner.id}>
                  <div>
                    <strong>{winner.userName}</strong>
                    <span>{winner.hitContent}</span>
                  </div>
                  <b>{formatMoney(winner.winAmount)}</b>
                </article>
              ))
            )}
          </div>
        </aside>

      </section>
    </main>
  );
}

export default function App() {
  if (window.location.pathname === '/admin/cards') {
    return <AdminCardsPage />;
  }

  return (
    <LicenseGate>
      <WorkbenchApp />
    </LicenseGate>
  );
}
