'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalize } = require('./patches');

const PRIVATE_PATH = /(?:^|\/)(?:\.[^/]+|node_modules|vendor|dist|build|__pycache__|[^/]*\.(?:pem|p12|pfx|kdbx|key)|(?:secrets?|credentials?)(?:\.[^/]+)?)(?:\/|$)/i;
const MAX_FILE = 512 * 1024;
const STOP_WORDS = new Set('about after along also appear before built called change covered each from have into loaded must other should that their them then this through using value values when where which will with would'.split(' '));
const SUPPORT_FILE = /(?:^|\/)(?:_static|static|fixtures|test_apps)(?:\/|$)|\.(?:svg|lock|snap|min\.js|map)$/i;

function git(root, args, signal, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(6000);
    // Resolve the repository from cwd. Editor launchers can inherit incomplete Git overrides.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^GIT_(?:CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+|DIR|WORK_TREE|COMMON_DIR|INDEX_FILE)$/i.test(key)));
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_PAGER = 'cat';
    const child = spawn('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root,
      shell: false,
      windowsHide: true,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      env
    });
    const chunks = [];
    let size = 0;
    let truncated = false;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        truncated = true;
        child.kill();
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => resolve({
      code, text: Buffer.concat(chunks).toString('utf8'), truncated
    }));
  });
}

function safePath(relative) {
  return typeof relative === 'string' && relative.length <= 400
    && !/[:\\\u0000-\u001f]/.test(relative) && !PRIVATE_PATH.test(relative)
    && relative.split('/').every(part => part && part !== '..' && part !== '.'
      && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

class Workspace {
  constructor(folder, signal, selection) {
    this.root = folder.uri.fsPath;
    this.signal = signal;
    this.selection = selection;
    this.files = new Map();
    this.staged = new Map();
  }

  async init() {
    this.realRoot = await fs.realpath(this.root);
    if (this.selection) {
      const file = await this.file(this.selection.path);
      if (file.document !== this.selection.document || file.document.version !== this.selection.version) {
        throw new Error('The selected text changed. Select it again and retry.');
      }
    }
  }

  async uri(relative) {
    this.signal.throwIfAborted();
    if (!safePath(relative)) throw new Error('Use a project-relative source path.');
    const joined = path.join(this.root, ...relative.split('/'));
    const real = await fs.realpath(joined);
    const expected = path.join(this.realRoot, ...relative.split('/'));
    const remainder = path.relative(this.realRoot, real);
    if (path.relative(expected, real) || path.isAbsolute(remainder)
        || remainder === '..' || remainder.startsWith('..' + path.sep)) {
      throw new Error('Linked files and paths outside this workspace are unavailable.');
    }
    if (this.selection && relative !== this.selection.path) {
      throw new Error('Inline edits are scoped to the selected file.');
    }
    const info = await fs.stat(real);
    if (!info.isFile() || info.size > MAX_FILE || info.nlink !== 1) {
      throw new Error('This tool needs an ordinary source file under 512 KiB.');
    }
    return vscode.Uri.file(joined);
  }

  async file(relative) {
    const uri = await this.uri(relative);
    const key = process.platform === 'win32' ? uri.fsPath.toLowerCase() : uri.fsPath;
    const existing = this.files.get(key);
    if (existing) return existing;
    const document = await vscode.workspace.openTextDocument(uri);
    if (this.files.has(key)) return this.files.get(key);
    const original = document.getText();
    if (original.includes('\0') || original.length > MAX_FILE) throw new Error('Unsupported text file.');
    const file = { key, relative, uri, document, original, base: normalize(original), version: document.version };
    this.files.set(key, file);
    return file;
  }

  text(file) {
    return this.staged.get(file.key)?.text ?? file.base;
  }

  async read({ path: relative, start_line = 1, end_line = start_line + 99 }) {
    if (!Number.isSafeInteger(start_line) || !Number.isSafeInteger(end_line)
        || start_line < 1 || end_line < start_line || end_line - start_line > 199) {
      throw new Error('Read a range of up to 200 lines using 1-based line numbers.');
    }
    const file = await this.file(relative);
    const lines = this.text(file).split('\n');
    const excerpt = lines.slice(start_line - 1, end_line)
      .map((line, index) => (start_line + index) + ' | ' + line).join('\n');
    return { path: relative, total_lines: lines.length, content: excerpt.slice(0, 12000) };
  }

  async paths() {
    if (!this.pathList) {
      this.pathList = git(this.root, ['ls-files', '-z', '--cached', '--'], this.signal)
        .then(({ code, text }) => code === 0 ? text.split('\0').filter(safePath) : [])
        .catch(error => {
          this.signal.throwIfAborted();
          if (error.code === 'ENOENT') return [];
          throw error;
        });
    }
    return this.pathList;
  }

  async matches(words) {
    if (!words.length) return new Map();
    const argv = ['grep', '-I', '-i', '-n', '-m', '12', '--no-color', '-F',
      ...words.flatMap(word => ['-e', word]), '--', '.',
      ':(exclude,glob)**/*.svg', ':(exclude,glob)**/*.lock', ':(exclude,glob)**/*.min.js'];
    const { text } = await git(this.root, argv, this.signal, 350000).catch(error => {
      this.signal.throwIfAborted();
      if (error.code === 'ENOENT') return { text: '' };
      throw error;
    });
    const matches = new Map();
    for (const line of text.split(/\r?\n/)) {
      const hit = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!hit || !safePath(hit[1])) continue;
      const snippets = matches.get(hit[1]) ?? [];
      snippets.push({ line: Number(hit[2]), text: hit[3].slice(0, 260) });
      matches.set(hit[1], snippets);
    }
    return matches;
  }

  terms(text) {
    return [...new Set(text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g))]
      .filter(word => !STOP_WORDS.has(word)).slice(0, 24);
  }

  async search({ query }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 250) {
      throw new Error('Enter a short search term or filename.');
    }
    if (this.selection) {
      const file = await this.file(this.selection.path);
      return this.text(file).split('\n')
        .map((text, index) => ({ line: index + 1, text: text.slice(0, 250) }))
        .filter(hit => hit.text.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
    }
    const [paths, hits] = await Promise.all([this.paths(), this.matches([query.trim()])]);
    return [...new Set([...paths.filter(file => file.toLowerCase().includes(query.toLowerCase())), ...hits.keys()])]
      .slice(0, 20).map(file => ({ path: file, matches: hits.get(file)?.slice(0, 3) ?? [] }));
  }

  async context(prompt) {
    if (this.selection) {
      const file = await this.file(this.selection.path);
      const [start, end] = this.selection.range;
      return [{ path: file.relative, reason: 'Selected text', text: file.base.slice(start, end) }];
    }
    const explicit = [...prompt.matchAll(/@file:(?:"([^"\r\n]+)"|([^\s,;]+))/g)]
      .slice(0, 8).map(match => match[1] ?? match[2]);
    const symbols = [...prompt.matchAll(/@symbol:([A-Za-z_][\w.]*)/g)]
      .slice(0, 8).map(match => match[1].split('.').at(-1));
    const words = this.terms(prompt.replace(/@file:(?:"[^"\r\n]+"|[^\s,;]+)|@symbol:[A-Za-z_][\w.]*/g, ' '));
    const [paths, hits, symbolHits] = await Promise.all([
      this.paths(), this.matches(words), this.matches(symbols)
    ]);
    const ranked = paths.map(file => {
      const entries = hits.get(file) ?? [];
      const filename = path.posix.basename(file).toLowerCase();
      const nameWords = filename.split(/[^a-z0-9]+/);
      const directTerms = words.filter(word => nameWords.includes(word));
      const pathTerms = words.filter(word => word.length >= 5 && filename.includes(word));
      const bodyTerms = words.filter(word => entries.some(entry => entry.text.toLowerCase().includes(word)));
      const references = (symbolHits.get(file) ?? []).filter(entry => symbols.some(symbol =>
        new RegExp('\\b' + symbol + '\\b').test(entry.text)));
      const definition = references.find(entry => symbols.some(symbol =>
        new RegExp('\\b(?:def|class|function|interface|type|struct|enum|const|let|fn)\\s+' + symbol + '\\b').test(entry.text)));
      const symbolHit = definition ?? references[0];
      const focus = symbolHit ?? [...entries].sort((a, b) => this.terms(b.text)
        .filter(word => words.includes(word)).length - this.terms(a.text)
        .filter(word => words.includes(word)).length)[0];
      const nameScore = directTerms.reduce((total, word) => total + 12 + Math.max(0, 12 - 2 * words.indexOf(word)), 0);
      const score = (symbolHit ? 100 : 0) + (definition ? 25 : 0) + nameScore + pathTerms.length * 3
        + bodyTerms.length * 2 + Math.min(entries.length, 5) - (SUPPORT_FILE.test(file) ? 20 : 0);
      return { path: file, score, line: focus?.line ?? 1,
        reason: symbolHit ? 'Explicit symbol match'
          : 'Matches ' + [...new Set([...directTerms, ...pathTerms, ...bodyTerms])].join(', ') };
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const groups = [/(?:^|\/)(?:src|lib)\//, /(?:^|\/)tests?\//, /(?:^|\/)docs?\//]
      .map(pattern => ranked.filter(entry => pattern.test(entry.path) && !SUPPORT_FILE.test(entry.path)));
    const byGroup = [0, 1].flatMap(index => groups.map(group => group[index])).filter(Boolean);
    const picked = new Set();
    const excerpts = [];
    let remaining = 9600;
    for (const entry of [
      ...explicit.map(file => {
        const match = ranked.find(item => item.path === file && item.reason === 'Explicit symbol match');
        return { path: file, line: match?.line ?? 1, reason: 'Explicit file mention' };
      }),
      ...ranked.filter(item => item.reason === 'Explicit symbol match').slice(0, 3),
      ...byGroup,
      ...ranked.slice(0, 16)
    ]) {
      this.signal.throwIfAborted();
      if (picked.has(entry.path) || remaining < 200 || excerpts.length === 8) continue;
      const start = Math.max(1, entry.line - 10);
      try {
        const excerpt = await this.read({ path: entry.path, start_line: start, end_line: start + 24 });
        const overhead = entry.path.length + entry.reason.length + 60;
        const text = excerpt.content.slice(0, Math.max(0, Math.min(1100, remaining - overhead)));
        excerpts.push({ path: entry.path, reason: entry.reason, text });
        remaining -= text.length + overhead;
        picked.add(entry.path);
      } catch (error) {
        if (entry.reason === 'Explicit file mention') throw error;
      }
    }
    this.signal.throwIfAborted();
    return excerpts;
  }

  async command(command) {
    if (this.selection) throw new Error('Commands are unavailable in inline mode.');
    const commands = {
      'git status --short': ['status', '--short'],
      'git diff --stat': ['diff', '--no-ext-diff', '--no-textconv', '--stat']
    };
    const argv = Object.hasOwn(commands, command) ? commands[command] : null;
    if (!argv) throw new Error('Available commands: git status --short, git diff --stat.');
    const result = await git(this.root, argv, this.signal, 16000);
    return { exit_code: result.code, stdout: result.text, truncated: result.truncated,
      note: 'Git sees saved files. Staged review edits are held in memory.' };
  }
}

module.exports = { Workspace, safePath };
