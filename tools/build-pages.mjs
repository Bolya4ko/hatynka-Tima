// Copies the page from public/ into dist/ for GitHub Pages and adds a content version to app.js/styles.css,
// so a browser never combines new HTML with an old cached script. Data comes from the Cloudflare Worker.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildPages(directory = path.join(root, 'dist')) {
  await mkdir(directory, { recursive: true });
  let html = await readFile(path.join(root, 'public/index.html'), 'utf8');
  for (const asset of ['app.js', 'styles.css']) {
    const bytes = await readFile(path.join(root, 'public', asset));
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    html = html.replace(new RegExp('\\./' + asset.replace('.', '\\.') + '(?:\\?v=[^\"]*)?\"'), './' + asset + '?v=' + version + '"');
  }
  await writeFile(path.join(directory, 'index.html'), html);
  for (const name of ['app.js', 'styles.css', 'favicon.svg', 'iphone-step-1.png', 'iphone-step-2.png', 'iphone-step-3.png', 'outage-schedule.json'])
    await copyFile(path.join(root, 'public', name), path.join(directory, name));
  await writeFile(path.join(directory, '.nojekyll'), '');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPages();
  console.log('Сторінку підготовлено в папці dist.');
}
