import { build } from 'esbuild';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const funcs = [
  { entry: 'api/webhook.ts', name: 'webhook' },
  { entry: 'api/cron.ts',    name: 'cron' },
];

for (const { entry, name } of funcs) {
  const outDir = `.vercel/output/functions/api/${name}.func`;
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: `${outDir}/index.mjs`,
    external: [],
    alias: { '@': path.resolve('src') },
    minify: false,
    banner: {
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
    },
  });

  await writeFile(`${outDir}/.vc-config.json`, JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: true,
  }, null, 2));

  console.log(`✅ Bundled ${name} → ${outDir}/index.mjs`);
}

console.log('✅ All API functions bundled.');
