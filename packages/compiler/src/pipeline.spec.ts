import { afterEach, describe, expect, it } from 'vitest';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CompilerContext } from './context.js';
import { compileFile } from './pipeline.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('compileFile', () => {
  it('compiles a simple component into SSR/CSR manifests', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-compiler-'));
    tempDirs.push(tmpDir);

    const filePath = path.join(tmpDir, 'App.tsx');
    await fs.writeFile(
      filePath,
      `export function App(props: { title: string }) {
        return <div className="hero">Hello {props.title}</div>;
      }
      `,
      'utf8'
    );

    const ctx = new CompilerContext({ cwd: tmpDir });
    const artifact = await compileFile(ctx, filePath);

    console.log('artifact', artifact);

    expect(artifact.ssr?.code).toBeDefined();
    expect(artifact.csr?.code).toBeDefined();
    expect(extractPayload(artifact.ssr?.code ?? '').cssClasses).toContain(
      'hero'
    );
    expect(artifact.diagnostics).toHaveLength(0);
  });
});

function extractPayload(code: string): any {
  const marker = 'export default';
  const idx = code.indexOf(marker);
  if (idx === -1) {
    throw new Error('export default not found in generated code');
  }
  const jsonStart = idx + marker.length;
  const jsonString = code
    .slice(jsonStart)
    .replace(/^\s+/, '')
    .replace(/;\s*$/, '');
  return JSON.parse(jsonString);
}
