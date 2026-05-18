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
});
