export function createBrowserId(cryptoLike = globalThis.crypto) {
  if (cryptoLike?.randomUUID) {
    return cryptoLike.randomUUID();
  }

  const values = new Uint32Array(4);
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 0xffffffff);
    }
  }

  return `browser-${Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('-')}`;
}

export function toGeneratedCodeRows(codes) {
  return (codes || []).map((code, index) => ({
    id: `${code}-${index}`,
    code,
  }));
}

export function buildLicenseHeaders(cardId, browserId) {
  if (!cardId || !browserId) return {};

  return {
    'x-license-card-id': cardId,
    'x-license-browser-id': browserId,
  };
}
