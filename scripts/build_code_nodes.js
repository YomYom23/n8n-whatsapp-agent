#!/usr/bin/env node
'use strict';
// Fills the generated region of every Code node that starts with "// @lib <module>[, <module>...]"
// with the named lib/ modules and the lib/ modules they require (design section 2, file 20).
//
//   node scripts/build_code_nodes.js           rewrite the regions in workflows/**/*.json
//   node scripts/build_code_nodes.js --check   exit 1 if any region differs from lib/ (names the node)
//   options: --dir <path> (default workflows), --print <module>[,<module>] (print a region to stdout)
//
// Both modes also fail if a workflow file contains a secret: a known token pattern, or the value
// of a secret-looking variable (name contains SECRET, TOKEN, KEY or PASSWORD) from deploy/*.env.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'lib');
const START = '// @lib ';
const END = '// @end-lib';
const BANNER = '// generated from lib/ by scripts/build_code_nodes.js: edit lib/, not this region';
const SECRET_PATTERNS = [/xox[abposr]-/, /sk-ant-/, /EAA[A-Za-z0-9]{20,}/, /pat-[a-z0-9]{2}-/, /-----BEGIN/];

function args() {
  const a = process.argv.slice(2);
  const get = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  return { check: a.includes('--check'), dir: path.resolve(ROOT, get('--dir') || 'workflows'), print: get('--print') };
}

function moduleSource(name) {
  const file = path.join(LIB, name + '.js');
  if (!fs.existsSync(file)) throw new Error('no lib module ' + name + ' (' + file + ')');
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function requiresOf(src) {
  // ignore block comments and whole-line // comments, so a comment that mentions require() isn't a dependency
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const out = [];
  const re = /require\(\s*['"]\.\/([A-Za-z0-9_]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

// Dependencies first; a cycle is an error.
function order(names) {
  const done = [];
  const visiting = new Set();
  const visit = (n) => {
    if (done.includes(n)) return;
    if (visiting.has(n)) throw new Error('require cycle through lib/' + n + '.js');
    visiting.add(n);
    for (const d of requiresOf(moduleSource(n))) visit(d);
    visiting.delete(n);
    done.push(n);
  };
  names.forEach(visit);
  return done;
}

function exportNames(name) {
  // the modules are pure, so loading them here only reads their export names
  return Object.keys(require(path.join(LIB, name + '.js')));
}

function region(names) {
  const lines = [START + names.join(', '), BANNER, 'const __lib = {};'];
  for (const n of order(names)) {
    lines.push(
      "__lib['" + n + "'] = (function () {",
      '  const module = { exports: {} };',
      '  const exports = module.exports;',
      "  const require = (p) => __lib[String(p).replace(/^\\.\\//, '')];",
      moduleSource(n).trimEnd().split('\n').map((l) => (l ? '  ' + l : l)).join('\n'),
      '  return module.exports;',
      '})();'
    );
  }
  const seen = new Map();
  for (const n of names) {
    for (const e of exportNames(n)) {
      if (seen.has(e)) throw new Error('export "' + e + '" is in both lib/' + seen.get(e) + '.js and lib/' + n + '.js');
      seen.set(e, n);
    }
    lines.push('const { ' + exportNames(n).join(', ') + " } = __lib['" + n + "'];");
  }
  lines.push(END);
  return lines.join('\n');
}

function rebuild(code) {
  if (!code.startsWith(START)) return null;
  const names = code.slice(START.length, code.indexOf('\n') === -1 ? undefined : code.indexOf('\n'))
    .split(',').map((s) => s.trim()).filter(Boolean);
  const endAt = code.indexOf(END);
  const callBlock = endAt === -1 ? code.slice(code.indexOf('\n') + 1) : code.slice(endAt + END.length).replace(/^\n/, '');
  return region(names) + '\n' + callBlock;
}

function envSecrets() {
  const dir = path.join(ROOT, 'deploy');
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.env'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && /SECRET|TOKEN|KEY|PASSWORD/.test(m[1]) && m[2].trim().length > 8) out.push({ name: m[1], value: m[2].trim() });
    }
  }
  return out;
}

function workflowFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...workflowFiles(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function main() {
  const a = args();
  if (a.print) {
    process.stdout.write(region(a.print.split(',').map((s) => s.trim())) + '\n');
    return 0;
  }
  const secrets = envSecrets();
  let problems = 0;
  let changed = 0;
  const files = workflowFiles(a.dir);
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) { console.error(rel + ': matches secret pattern ' + re); problems++; }
    }
    for (const s of secrets) {
      if (text.includes(s.value)) { console.error(rel + ': contains the value of ' + s.name + ' from deploy/*.env'); problems++; }
    }
    const wf = JSON.parse(text);
    let fileChanged = false;
    for (const node of wf.nodes || []) {
      if (node.type !== 'n8n-nodes-base.code') continue;
      const key = node.parameters && typeof node.parameters.jsCode === 'string' ? 'jsCode' : null;
      if (!key) continue;
      const before = node.parameters[key].replace(/\r\n/g, '\n');
      const after = rebuild(before);
      if (after === null || after === before) continue;
      if (a.check) { console.error(rel + ': node "' + node.name + '" differs from lib/'); problems++; }
      else { node.parameters[key] = after; fileChanged = true; console.log(rel + ': rebuilt node "' + node.name + '"'); }
    }
    if (fileChanged) { fs.writeFileSync(file, JSON.stringify(wf, null, 2) + '\n'); changed++; }
  }
  console.log((a.check ? 'checked ' : 'built ') + files.length + ' workflow file(s)' + (a.check ? '' : ', ' + changed + ' changed') + (problems ? ', ' + problems + ' problem(s)' : ''));
  return problems ? 1 : 0;
}

try { process.exitCode = main(); } catch (e) { console.error('build_code_nodes: ' + e.message); process.exitCode = 1; }
