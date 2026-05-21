import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');

describe('OCR image preparation flow', () => {
  it('keeps table OCR on the existing compressed image path', () => {
    const tableHandler = appSource.match(/async function handleRecognizeUploadedTables\(\) \{([\s\S]*?)async function handleRecognizeUploadedChats\(\)/)?.[1] || '';

    assert.match(tableHandler, /compressImageForRecognition\(source\.file\)/);
    assert.doesNotMatch(tableHandler, /prepareChatImageForRecognition\(source\.file\)/);
  });

  it('uses the chat high-definition image path for text OCR', () => {
    const chatHandler = appSource.match(/async function handleRecognizeUploadedChats\(\) \{([\s\S]*?)function handleGenerate\(\)/)?.[1] || '';

    assert.match(chatHandler, /prepareChatImageForRecognition\(source\.file\)/);
    assert.match(chatHandler, /使用原图并在 OCR 服务端清晰化/);
  });
  it('caps chat OCR images by dimensions before upload', () => {
    const helper = appSource.match(/async function prepareChatImageForRecognition\(file\) \{([\s\S]*?)async function readJsonResponse/)?.[1] || '';

    assert.match(helper, /maxRawSide = 3200/);
    assert.match(helper, /image\.naturalWidth <= maxRawSide/);
    assert.match(helper, /image\.naturalHeight <= maxRawSide/);
  });

  it('continues to the result page when automatic AI formatting fails', () => {
    const aiReviewHandler = appSource.match(/async function runAiReviewForDraft[\s\S]*?async function handleParseManualBetText/)?.[0] || '';
    const catchBlock = aiReviewHandler.match(/catch \(error\) \{([\s\S]*?)\} finally/)?.[1] || '';

    assert.doesNotMatch(catchBlock, /setAiIssues\(\[fallbackIssue\]\)/);
    assert.doesNotMatch(catchBlock, /sourceTexts\.join/);
    assert.match(catchBlock, /setAiIssues\(\[\]\)/);
    assert.match(catchBlock, /setWorkbenchStep\('result'\)/);
    assert.match(catchBlock, /generateFromModeTexts\(draftModeTexts,\s*successText\)/);
  });

  it('does not add browser-side timeouts to AI formatting requests', () => {
    const fetchHelper = appSource.match(/async function fetchJson\(path, options = \{\}\) \{([\s\S]*?)function LicenseGate/)?.[1] || '';
    const aiReviewHandler = appSource.match(/async function runAiReviewForDraft[\s\S]*?async function handleParseManualBetText/)?.[0] || '';
    const manualAssistHandler = appSource.match(/async function handleAssistBetParsing[\s\S]*?function handleConfirmAiCandidate/)?.[0] || '';

    assert.doesNotMatch(fetchHelper, /AbortController/);
    assert.doesNotMatch(fetchHelper, /timeoutMs/);
    assert.doesNotMatch(aiReviewHandler, /timeoutMs:/);
    assert.doesNotMatch(manualAssistHandler, /timeoutMs:/);
  });
});
