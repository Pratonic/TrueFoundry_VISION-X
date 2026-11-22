# Truforgery

Truforgery is a VS Code extension for proposing and reviewing code edits. TrueForge runs the model and tool loop locally. The extension reads the project, renders the diffs, and puts the accepted edits into editor buffers when you click Apply.

## Start from a clean checkout

1. Install VS Code 1.99 or later, Node.js 22.14 or later, and Git. The extension has no dependencies to install or build.
2. In PowerShell, start TrueForge with the loopback host allowed for the editor's MCP connection.

   ```powershell
   $env:HOST = '127.0.0.1'
   $env:OUTBOUND_URL_ALLOWED_HOSTS = '["127.0.0.1"]'
   npx.cmd @truefoundry/trueforge@0.185.1
   ```

   In Bash, run `HOST=127.0.0.1 OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1"]' npx @truefoundry/trueforge@0.185.1`. Open `http://127.0.0.1:8790`, go to Settings, and add a tool-capable model. Enter any provider key in TrueForge. Use `127.0.0.1` as the hostname if you are configuring a local model endpoint.
3. Open this project in VS Code and press **F5** using the **Run Truforgery** launch configuration.
4. In the Extension Development Host, open the project you want to edit. Use a trusted local folder. In **User Settings**, search for `Truforgery: Model` and paste the model ID shown in TrueForge, in `provider/model` form. `model-settings.example.json` shows the equivalent JSON keys. You can also set `Truforgery: Fallback Model`.
5. Open the Command Palette and run **Truforgery: Open Agent**. For an inline edit, select a region of code and press **Ctrl+Alt+I** on Windows or Linux or **Cmd+Alt+I** on macOS.

`agent.json` is the agent definition. The extension loads it directly when it creates a TrueForge session and inserts the selected model and the name of a temporary connector. The connector is local to the run.

## Review and apply

- Use `@file:src/module.py`, `@file:"docs/with spaces.rst"`, or `@symbol:load_config` in a request. The panel lists the excerpts that were selected and why.
- When TrueForge pauses, review every hunk using **Accept** or **Reject**. **Open diff** shows that hunk in VS Code's diff editor. **Finish review** sends the decisions back to the turn.
- **Apply reviewed edits** updates the editor buffers in one operation. Use **File → Save All** before running a check that reads from disk. If VS Code Auto Save is enabled, it may save the applied buffers automatically.
- **Truforgery: Undo Applied Run** reverses the most recent applied run if each affected buffer still matches the applied version. Save again to persist that undo.
- **Cancel** discards a running or paused turn. **Discard** clears a completed review before Apply. **Open TrueForge session** opens the turn history and tool calls.

## Round 1 rehearsal

Clone `https://github.com/pallets/flask` outside this project and check out `3.1.3` (`22d92470`). Create and activate a Python virtual environment in the Flask checkout. Install the checkout and compatible test dependencies with `python -m pip install -e ".[dotenv]" "pytest==8.3.5" "click==8.1.8"`.

1. **Task A.** In `src/flask/helpers.py`, select `get_debug_flag`. Ask the extension to treat `off` and `n` as false case-insensitively and update the docstring to list the false values. Review, Apply, and save. In PowerShell run `$env:FLASK_DEBUG = 'off'` and `python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"`. The expected output is `False`. Remove the variable with `Remove-Item Env:FLASK_DEBUG`.
2. **Task B.** In the agent panel, request a built-in `flask config` command that prints loaded configuration as JSON and masks any key containing `SECRET`, `PASSWORD`, `TOKEN`, or `KEY` with `***`. Ask for the help entry, a test, and documentation alongside the built-in commands. Keep filenames out of the prompt. Show the context list and the TrueForge session. Review changes to at least three files, Apply, and save. Run `python -m pytest tests/test_cli.py -q`, `python -m flask --help`, and `python -m flask --app YOUR_APP config`. Use a small app with dummy values in the keys you want to show.
3. **Task C.** Open a separate clean checkout at the same tag. Configure a TrueForge model with an unreachable local endpoint or an invalid key. Repeat Task A. Show a clear error, or the optional fallback starting, and run `git status --short` before applying anything. You can also cancel during generation to demonstrate that reviewed content remains staged.

The agent's command tool accepts `git status --short` or `git diff --stat`. Run pytest yourself after Apply and Save All so it sees the reviewed version.

## Development

Run `npm test` with Node 22. The workspace tools support existing text files and cap search output, read ranges, and edit size. Automatic retrieval uses Git-tracked files. Explicit file mentions work for ordinary local text files that pass the path filter. A run is limited to one folder. Undo history lives in the extension host's memory.

Truforgery was built from scratch. It uses VS Code's extension API and the TrueForge HTTP API. See the [technical report](WRITEUP.pdf) or its [editable source](WRITEUP.md). The [video walkthrough](Truforgery-demo.mp4) shows the VS Code checks with a scripted local endpoint and the separate Flask CLI verification.

Sources: [TrueForge documentation](https://trueforge.dev/api/overview), [Techfest competition brief](https://techfest.org/competitions/forge-a-thon).
