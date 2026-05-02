import { $ } from 'bun';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

export async function buildIndex(root: string): Promise<void> {
  await $`mkdir -p ${root}/dist`.nothrow().quiet();

  const { success } = await Bun.build({
    entrypoints: [join(root, 'src/index.ts')],
    outdir: join(root, 'dist'),
    root: join(root, 'src'),
    target: 'node',
    format: 'cjs',
    sourcemap: 'inline',
    external: ['electron', 'glimpse-tty-native-rs', '*.node'],
  });

  if (!success) {
    throw new Error('Failed to build src/index.ts -> dist/index.js');
  }
}

// Bundle the markdown extension into dist/extensions/markdown/.
// content.ts is a classic-script content_scripts entry (IIFE).
// mermaid-loader.ts is dynamically imported from content.ts via
// chrome.runtime.getURL + import(), so it must be ESM.
export async function buildMarkdownExtension(root: string): Promise<void> {
  const srcDir = join(root, 'default-extensions/markdown');
  const outDir = join(root, 'dist/extensions/markdown');
  await $`mkdir -p ${outDir}`.quiet();

  const entrypoints: Array<{ file: string; format: 'iife' | 'esm' }> = [
    { file: 'content.ts', format: 'iife' },
    { file: 'mermaid-loader.ts', format: 'esm' },
  ];

  for (const { file, format } of entrypoints) {
    // Minify both bundles: content.js loads on every .md page (parse time),
    // mermaid-loader.js is ~3MB even minified (every byte counts when it does load).
    // Skip sourcemaps — they bloat the bundles ~6x and aren't worth the cost
    // for production payload. Rebuild without --minify to debug.
    const { success } = await Bun.build({
      entrypoints: [join(srcDir, file)],
      outdir: outDir,
      target: 'browser',
      format,
      minify: true,
    });
    if (!success) {
      throw new Error(`Failed to build markdown extension: ${file}`);
    }
  }

  copyFileSync(join(srcDir, 'manifest.json'), join(outDir, 'manifest.json'));
}
