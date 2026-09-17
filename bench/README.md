# The harness tax, measured on Radiant

Arena's *HarnessTax* (2026-09-16) ran one model through three coding harnesses on
the same SWE-bench Lite tasks and found the harness moved cost by up to 5× while
moving success by a couple of points. Radiant is a harness. This folder runs the
same experiment with Radiant as a row.

    node scripts/bench-harness.mjs plan                                  # 30 tasks, seeded, gold-checked
    node scripts/bench-harness.mjs run --harness radiant --model gpt-5.6-sol
    node scripts/bench-harness.mjs run --harness codex   --model gpt-5.6-sol
    node scripts/bench-harness.mjs run --harness claude  --model claude-sonnet-5
    node scripts/bench-harness.mjs grade --harness radiant --model gpt-5.6-sol
    node scripts/bench-harness.mjs report

One-time setup: `uv venv --python 3.11 bench/.venv && uv pip install --python
bench/.venv/bin/python swebench`. The dataset is fetched on first use.

## What is held equal

- **Tasks.** 30, drawn in a fixed seeded order (`data/sample-order.json`, seed
  2026) from the 239 Lite tasks in pure-Python repositories, each proven first
  with the dataset's own fix (`data/gold-check.json`). One was dropped because
  its reference fix does not pass natively on macOS.
- **Working copy.** The repository at the task's base commit with its
  dependencies installed in `.venv`, so every harness can run the tests.
- **Prompt.** Identical text; the issue only — no hints, no test patch.
- **Cap.** 100 model calls per attempt. **Effort:** each harness's `high`.
- **Runs.** 3 per task; success and cost are averaged per task, then across
  tasks, as in the paper.
- **Cost.** List price for the model, applied to each harness's own token
  counts: uncached input, cache writes, cache reads and output separately.
- **Grading.** swebench's own test lists, eval script, log parsers and grading
  code (`grade_native.py` imports them). The tests run in a uv virtualenv on
  this Mac rather than in swebench's x86_64 Docker image — the only deviation,
  forced by the machine (Apple silicon, pre-release macOS, no container
  runtime) and bounded by the gold check.

## What is not equal

Every harness runs "as installed" on this Mac: Claude Code reads Tony's
`CLAUDE.md`, Codex its `config.toml`, Radiant its memory. None is told anything
about SWE-bench. Radiant is measured with its MCP servers off (`radiant`) — the
coding harness on its own — and, on a subset, exactly as installed (`radiant+mcp`).

## What running it found before it finished

Radiant's ChatGPT sign-in path never hit OpenAI's prompt cache: it sent a fresh
random `session_id` on every model call and no `prompt_cache_key`. The first
attempt read 286k input tokens with 0 cached on a 13-round task. Fixed the same
day (`server/providers.js`, `chatgptRound`), and gated in `scripts/test-caching.mjs`.
The Anthropic path reported the cached share to nobody, so a Claude
subscription never showed "% cached"; also fixed. And one enabled MCP server
(Linear) was 69 tool schemas — 16.6k tokens — on every model call of every chat,
which is now a per-chat choice (`mcp: false` on a session).
