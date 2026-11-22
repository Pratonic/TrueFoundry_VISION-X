# Truforgery

VISION-X · PES University · TrueFoundry Forge-a-thon

## 1. Team

- Pratyush Bhatia | Electronics and Communication Engineering (ECE)
- Amogh Sharma | Computer Science and Engineering (CSE)
- Adarsh Rajesh | Computer Science and Engineering (CSE)
- Ananya Kulgod | Electronics and Communication Engineering (ECE)

All four members are in their third year at PES University.

## 2. Starting point

Built from scratch as a JavaScript VS Code extension. Flask 3.1.3, commit `22d92470`, is the reference checkout used to verify the workflow.

## 3. Architecture on TrueForge

VS Code loads `agent.json` and opens a TrueForge session over HTTP. A loopback MCP connector exposes four tools. Search and line-range reads are available immediately. TrueForge loads edit proposals and read-only Git commands on demand, then pauses for editor approval.

Each hunk carries the exact text it expects to replace. Ambiguous matches go back to the agent. Accepted edits stay in memory while the turn runs. Apply checks every affected buffer again, then sends one `WorkspaceEdit` to VS Code. Cancel drops the staged edits and stops the turn. Undo restores the last applied buffers if they still match the applied version.

## 4. How context is selected

An early Flask search surfaced generic configuration files ahead of the CLI. The revised ranking gives matches in source, tests and documentation a slot each. On Task B, `src/flask/cli.py`, `tests/test_cli.py` and `docs/cli.rst` ranked first, second and third without filenames in the prompt.

File mentions take precedence. Symbol mentions favour definitions and then references. The initial bundle allows up to eight excerpts of 1,100 characters each within a 9,600-character pool. The panel shows the paths and reasons. Inline mode starts with the selected text and limits edits to that range.

## 5. Model setup

The recorded checks use TrueForge 0.185.1 and a scripted OpenAI-compatible endpoint on loopback. API cost was ₹0. This setup exercises real sessions, MCP approvals and VS Code edits with predetermined model responses. A tool-capable model can be selected using its TrueForge ID in VS Code settings. An optional fallback starts a fresh session if the primary model fails before review.

## 6. Scorecard

Times refer to the accompanying MP4. A separate protocol check covers cancellation while streaming.

| Criterion | Where | Observed evidence |
| --- | --- | --- |
| A1 Inline edit | 0:11–0:29 | Two proposed hunks. After Apply and Save, FLASK_DEBUG=off returned False. |
| A2 Agent mode | 0:39–1:06 | Three files reached the editor’s Apply step. A separate check of the same patch passed 59 Flask CLI tests. |
| A3 Streaming and cancellation | Protocol check | Stream produced text. Cancel ended the turn and disconnected the endpoint. |
| B1 Context assembly | 0:29–0:39 | Eight excerpts shown. The implementation, test and docs came first. |
| B2 Diff safety | 0:39–0:54 | VS Code previewed and staged changes before Apply. The inline run was also applied, saved and undone. |
| B3 Resilience | 1:14–1:23 | Provider returned HTTP 401. The editor reported the failure and Git status was clean. |
| B4 TrueForge integration | 1:06–1:14 | Persisted session events include tool approval and tool response. |
| C1 Video | 0:00–1:23 | Captioned VS Code walkthrough follows Tasks A, B and C in order. |
| C2 Write-up | Page 2 | This table maps each claim to the recording or test that supports it. |

## 7. Tools used

VS Code, Git, Node.js, Python, pytest and TrueForge. OpenAI Codex assisted with implementation, tests, the report and the walkthrough.

## 8. Known limitations and what you would do with another month

The scripted walkthrough does not measure how well a live model discovers fixes. Search is lexical, so a request can miss a symbol that the code names differently. I would add language-server references to retrieval and run tests in a disposable checkout of the staged changes before Apply.
