import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../worker/index.mjs';

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const separator = line.indexOf('=');
    return separator < 0 ? [] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }).filter(pair => pair.length));
}

const env = parseEnv(await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'));
const handle = createHandler();
const host = '127.0.0.1';
const port = 8787;

createServer(async (request, response) => {
  try {
    const url = `http://${request.headers.host || host}${request.url || '/'}`;
    const workerRequest = new Request(url, { method: request.method, headers: request.headers });
    const workerResponse = await handle(workerRequest, env);
    response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
    response.end(Buffer.from(await workerResponse.arrayBuffer()));
  } catch {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Локальний сервер не зміг обробити запит.' }));
  }
}).listen(port, host, () => {
  console.log(`Локальний Worker готовий: http://${host}:${port}`);
});