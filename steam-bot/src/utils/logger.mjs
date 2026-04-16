import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(__dirname, '..', '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const logStream = fs.createWriteStream(resolve(LOG_DIR, 'bot.log'), { flags: 'a' });

function timestamp() {
  return new Date().toISOString();
}

function format(level, tag, msg, data) {
  const base = `[${timestamp()}] [${level}] [${tag}] ${msg}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

function write(level, tag, msg, data) {
  const line = format(level, tag, msg, data);
  logStream.write(line + '\n');
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(tag) {
  return {
    info:  (msg, data) => write('INFO',  tag, msg, data),
    warn:  (msg, data) => write('WARN',  tag, msg, data),
    error: (msg, data) => write('ERROR', tag, msg, data),
    debug: (msg, data) => {
      if (process.env.DEBUG) write('DEBUG', tag, msg, data);
    },
  };
}
