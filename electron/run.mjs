// Electron'u başlatır; tüm veriler (profil, önbellek) proje klasörü içinde kalır.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, ELECTRON_CACHE: path.join(root, 'data', 'electron-cache') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'electron', 'cli.js'), root], { cwd: root, env, stdio: 'inherit', windowsHide: false });
child.on('close', code => process.exit(code ?? 0));
