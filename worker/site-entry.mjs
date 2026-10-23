// Production entry point for the Workers.dev address. It keeps the dashboard
// and its API together, so the page remains available independently of GitHub Pages.
import api from './index.mjs';
import page from '../public/index.html';
import script from './static-app.mjs';
import styles from '../public/styles.css';
import icon from '../public/favicon.svg';
import schedule from '../public/outage-schedule.json';
import stepOne from '../public/iphone-step-1.png';
import stepTwo from '../public/iphone-step-2.png';
import stepThree from '../public/iphone-step-3.png';

const assets = new Map([
  ['/', [page, 'text/html; charset=utf-8']],
  ['/index.html', [page, 'text/html; charset=utf-8']],
  ['/app.js', [script, 'text/javascript; charset=utf-8']],
  ['/styles.css', [styles, 'text/css; charset=utf-8']],
  ['/favicon.svg', [icon, 'image/svg+xml']],
  ['/outage-schedule.json', [schedule, 'application/json; charset=utf-8']],
  ['/iphone-step-1.png', [stepOne, 'image/png']],
  ['/iphone-step-2.png', [stepTwo, 'image/png']],
  ['/iphone-step-3.png', [stepThree, 'image/png']]
]);

function bytesFromDataUrl(value) {
  const base64 = value.slice(value.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function staticResponse(value, contentType) {
  const body = typeof value === 'string' && value.startsWith('data:') ? bytesFromDataUrl(value) : value;
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': contentType.includes('text/html') || contentType.includes('json') ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export default {
  async fetch(request, env, context) {
    if (request.method === 'GET') {
      const asset = assets.get(new URL(request.url).pathname);
      if (asset) return staticResponse(asset[0], asset[1]);
    }
    return api.fetch(request, env, context);
  }
};