module.exports = {
  apps: [
    {
      name: 'mark-six-api',
      script: 'server/index.js',
      cwd: '/opt/mark-six',
      env: {
        NODE_ENV: 'production',
        PORT: '8787',
        OCR_SERVICE_URL: 'http://127.0.0.1:8791',
        OCR_TIMEOUT_MS: '300000',
      },
    },
    {
      name: 'mark-six-ocr',
      script: '.venv/bin/python',
      args: '-m uvicorn ocr_service.app:app --host 127.0.0.1 --port 8791',
      cwd: '/opt/mark-six',
    },
  ],
};
