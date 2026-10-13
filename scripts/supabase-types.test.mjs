import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const generatedPath = 'apps/web/src/lib/data/database.types.ts';

function withTypegenFixture(run) {
  const tempRoot = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(tempRoot, 'stage-tracker-typegen-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  mkdirSync(path.dirname(path.join(root, generatedPath)), { recursive: true });
  const stub = path.join(bin, 'typegen.cjs');
  writeFileSync(
    stub,
    'process.stdout.write(process.env.TYPEGEN_TEST_OUTPUT ?? "");\n' +
      'process.exitCode = Number(process.env.TYPEGEN_TEST_EXIT ?? 0);\n',
  );
  if (process.platform === 'win32') {
    writeFileSync(path.join(bin, 'supabase.cmd'), `@"${process.execPath}" "${stub}"\r\n`);
  } else {
    writeFileSync(
      path.join(bin, 'supabase'),
      '#!/usr/bin/env node\n' + readFileSync(stub, 'utf8'),
      { mode: 0o755 },
    );
  }
  const execute = (script, output, exit = 0) =>
    spawnSync(process.execPath, [path.join(scriptsRoot, script)], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TYPEGEN_TEST_OUTPUT: output,
        TYPEGEN_TEST_EXIT: String(exit),
      },
    });
  try {
    run({ root, execute });
  } finally {
    assert.equal(path.dirname(path.resolve(root)), tempRoot);
    rmSync(root, { recursive: true, force: true });
  }
}

test('official typegen whitespace round-trips while schema drift still fails', () => {
  withTypegenFixture(({ root, execute }) => {
    const output = 'export type Row = {  \n  id: string\t \n}\n';
    const generated = execute('generate-supabase-types.mjs', output);
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(
      readFileSync(path.join(root, generatedPath), 'utf8'),
      'export type Row = {\n  id: string\n}\n',
    );
    const matching = execute('check-supabase-types-drift.mjs', output);
    assert.equal(matching.status, 0, matching.stderr);
    const changed = execute(
      'check-supabase-types-drift.mjs',
      output.replace('id: string', 'id: number'),
    );
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /Generated Supabase types differ/);
  });
});

test('failed typegen leaves the committed artifact intact and fails the check', () => {
  withTypegenFixture(({ root, execute }) => {
    const before = 'export type Row = { id: string }\n';
    writeFileSync(path.join(root, generatedPath), before);
    const generated = execute('generate-supabase-types.mjs', 'partial output', 1);
    assert.equal(generated.status, 1);
    assert.equal(readFileSync(path.join(root, generatedPath), 'utf8'), before);
    const check = execute('check-supabase-types-drift.mjs', before, 1);
    assert.equal(check.status, 1);
    assert.match(check.stderr, /Failed to generate Supabase types/);
  });
});
