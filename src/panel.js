'use strict';

const vscode = require('vscode');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

class Panel {
  constructor(extensionUri, onMessage, onClose) {
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.previewFiles = new Map();
    this.sequence = 0;
    this.provider = vscode.workspace.registerTextDocumentContentProvider('truforgery-preview', {
      provideTextDocumentContent: uri => this.previewFiles.get(uri.toString()) ?? ''
    });
    this.extensionUri = extensionUri;
    this.reset();
  }

  reset() {
    this.state = { phase: 'idle', status: 'Ready', mode: 'agent', prompt: '', output: '', context: [],
      session: '', proposal: null, staged: [], canUndo: this.state?.canUndo ?? false };
  }

  open() {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn, false);
      return;
    }
    const source = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('truforgery', 'Truforgery', vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [source]
    });
    this.reset();
    this.panel = panel;
    panel.webview.onDidReceiveMessage(async message => {
      if (message?.kind === 'ready') this.update({});
      else await this.onMessage(message);
    });
    panel.onDidDispose(() => {
      this.panel = null;
      this.onClose();
    });
    const nonce = randomBytes(24).toString('hex');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(source, 'panel.js'));
    const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(source, 'panel.css'));
    panel.webview.html = [
      '<!doctype html><html lang="en"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' +
        panel.webview.cspSource + '; script-src \'nonce-' + nonce + '\';">',
      '<link rel="stylesheet" href="' + css + '"><title>Truforgery</title></head><body>',
      '<header><h1>Truforgery</h1><span id="mode"></span></header>',
      '<form id="form"><label for="prompt">What should change?</label>',
      '<textarea id="prompt" rows="4" maxlength="12000" required></textarea>',
      '<div class="actions"><button id="run" type="submit">Run agent</button>',
      '<span class="hint"><code>@file:path</code> <code>@symbol:name</code></span></div></form>',
      '<section class="status" aria-label="Run controls"><p id="status" role="status"></p>',
      '<div class="actions"><button id="cancel" type="button">Cancel</button>',
      '<button id="apply" type="button">Apply reviewed edits</button>',
      '<button id="discard" type="button">Discard</button>',
      '<button id="undo" type="button">Undo applied run</button>',
      '<button id="session" type="button">Open TrueForge session</button></div></section>',
      '<section id="review" hidden aria-label="Review tool proposal"></section>',
      '<details id="context" open hidden><summary>Context sent to TrueForge</summary><ul></ul></details>',
      '<details id="staged" open hidden><summary>Reviewed files</summary><ul></ul></details>',
      '<section id="transcript" hidden><h2>Output</h2><pre id="output"></pre></section>',
      '<script nonce="' + nonce + '" src="' + script + '"></script></body></html>'
    ].join('\n');
  }

  update(fields) {
    Object.assign(this.state, fields);
    void this.panel?.webview.postMessage(this.state);
  }

  stream(text) {
    this.state.output = (this.state.output + text).slice(-24000);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.update({});
    }, 55);
  }

  async diff(title, before, after) {
    const uri = side => vscode.Uri.from({
      scheme: 'truforgery-preview', path: '/' + side + '/' + ++this.sequence + '/' + path.basename(title)
    });
    const original = uri('before');
    const proposed = uri('after');
    this.previewFiles.set(original.toString(), before);
    this.previewFiles.set(proposed.toString(), after);
    while (this.previewFiles.size > 40) this.previewFiles.delete(this.previewFiles.keys().next().value);
    await vscode.commands.executeCommand('vscode.diff', original, proposed, title, {
      preview: true, viewColumn: vscode.ViewColumn.One
    });
  }

  dispose() {
    clearTimeout(this.timer);
    this.provider.dispose();
    this.panel?.dispose();
  }
}

module.exports = { Panel };
