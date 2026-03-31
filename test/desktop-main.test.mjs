import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const desktopMainPath = path.resolve('desktop/main.cjs');
const source = fs.readFileSync(desktopMainPath, 'utf8');

test('desktop bootstrap starts local server and loads loopback URL', async () => {
  let readyCallback = null;
  const appEvents = new Map();
  const spawnCalls = [];
  let loadedURL = '';

  const mockChild = {
    killed: false,
    on() {},
    kill() {
      this.killed = true;
    },
  };

  const BrowserWindow = class {
    constructor() {
      this.webContents = { setWindowOpenHandler: () => ({ action: 'deny' }) };
    }
    async loadURL(url) {
      loadedURL = url;
    }
  };

  const app = {
    isPackaged: false,
    getPath(name) {
      if (name === 'userData') return '/tmp/rx-user';
      throw new Error(`unexpected getPath(${name})`);
    },
    whenReady() {
      return {
        then(cb) {
          readyCallback = cb;
        },
      };
    },
    on(event, cb) {
      appEvents.set(event, cb);
    },
    quit() {},
  };

  const context = vm.createContext({
    require: (id) => {
      if (id === 'electron') {
        return {
          app,
          BrowserWindow,
          dialog: { showErrorBox() {} },
          shell: { openExternal() {} },
        };
      }
      if (id === 'node:path') return path;
      if (id === 'node:child_process') {
        return {
          spawn: (...args) => {
            spawnCalls.push(args);
            return mockChild;
          },
        };
      }
      throw new Error(`unexpected require: ${id}`);
    },
    process: {
      env: {},
      execPath: '/usr/bin/node',
      resourcesPath: '/resources',
    },
    fetch: async () => ({ ok: true }),
    setTimeout,
    clearTimeout,
    console,
    __dirname: path.dirname(desktopMainPath),
  });

  vm.runInContext(source, context, { filename: desktopMainPath });
  assert.ok(readyCallback, 'app.whenReady callback should register');

  await readyCallback();

  assert.equal(spawnCalls.length, 1, 'server should be spawned once');
  const [execPath, args, options] = spawnCalls[0];
  assert.equal(execPath, '/usr/bin/node');
  assert.ok(args[0].endsWith(path.join('node_modules', 'tsx', 'dist', 'cli.mjs')));
  assert.ok(args[1].endsWith(path.join('server', 'index.ts')));
  assert.deepEqual(Array.from(args.slice(2)), ['--production']);
  assert.equal(options.env.USE_DIST, '1');
  assert.equal(options.env.RX_APP_DATA_ROOT, '/tmp/rx-user/local-data');
  assert.equal(options.env.RX_APP_ROOT, path.resolve(path.dirname(desktopMainPath), '..'));
  assert.equal(loadedURL, 'http://127.0.0.1:5000');

  const beforeQuit = appEvents.get('before-quit');
  assert.ok(beforeQuit, 'before-quit handler should register');
  beforeQuit();
  assert.equal(mockChild.killed, true, 'server should be killed on app quit');
});
