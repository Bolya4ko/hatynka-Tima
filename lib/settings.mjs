import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export class SettingsStore {
  constructor(directory) { this.directory = directory; }
  async key() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'key');
    try { return await readFile(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const key = randomBytes(32);
      try { await writeFile(file, key, { flag: 'wx', mode: 0o600 }); return key; }
      catch (e) { if (e.code === 'EEXIST') return readFile(file); throw e; }
    }
  }
  async load() {
    let payload;
    try { payload = JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Не вдалося прочитати налаштування. Перевірте папку .local.'); }
    try {
      const decipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
    } catch { throw new Error('Не вдалося розшифрувати налаштування. Потрібен відповідний файл .local/key.'); }
  }
  async save(settings) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]);
    const payload = { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    const temporary = path.join(this.directory, 'settings.tmp');
    await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
    await rename(temporary, path.join(this.directory, 'settings.json'));
  }
}
