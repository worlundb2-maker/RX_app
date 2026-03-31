import express from 'express';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { registerRoutes } from './routes';
import { getAppRootDir } from './paths';

const app = express();
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

registerRoutes(app);

const wantsProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

async function mountVite() {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    configFile: path.resolve(getAppRootDir(), 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    try {
      const file = await fs.readFile(path.resolve(getAppRootDir(), 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, file);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      next(error);
    }
  });
}

async function mountDist() {
  const dist = path.resolve(getAppRootDir(), 'dist', 'public');
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

async function start() {
  const dist = path.resolve(getAppRootDir(), 'dist', 'public', 'index.html');
  const useDist = wantsProduction && process.env.USE_DIST === '1' && syncFs.existsSync(dist);

  if (useDist) {
    await mountDist();
  } else {
    await mountVite();
  }

  const port = Number(process.env.PORT || 5000);
  app.listen(port, '127.0.0.1', () => {
    console.log(`Pharmacy Analytics running on http://127.0.0.1:${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
