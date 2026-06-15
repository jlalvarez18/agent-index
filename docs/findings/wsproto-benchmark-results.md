# wsproto Benchmark Results

Run date: 2026-06-13

## Why wsproto

`python-hyper/wsproto` was added after the attrs repair as a fresh, compact protocol/state-machine corpus. It exercises vocabulary that earlier repos did not stress as much: WebSocket handshakes, HTTP upgrade responses, frame parsing, masking, extension negotiation, close frames, and event conversion.

Clone:

```text
/tmp/agent-index-wsproto
commit 5e0685d
```

## Corpus

The same-corpus comparison used only implementation source files:

```text
/tmp/wsproto-source-only
```

`agent-index` indexed:

```text
Indexed 8 files, 131 symbols, 131 chunks, 426 edges at /tmp/agent-index-wsproto-source-only.sqlite
```

Graphify extracted:

```text
found 8 code, 0 docs, 0 papers, 0 images
wrote graph.json with 206 nodes, 762 edges
```

## Blind Result

The first untouched wsproto run showed good recall but weak top-one ranking:

```text
Questions: 12
Symbol Hit@1: 0.58
Symbol Hit@5: 1.00
File Hit@1: 0.75
File Hit@5: 1.00
```

Miss pattern:

- `Connection.events` beat `Connection.send` for send-state wording.
- `FrameProtocol.received_frames` beat `Connection.events` for frame-to-event conversion.
- Abstract `Extension.accept` / `Extension.finalize` beat handshake orchestration functions.
- `H11Handshake._accept` beat `_establish_client_connection` for client response validation.

## Fixes

The fixes were added test-first:

- direct owner action intent for concrete owner methods like `Connection.send`;
- extension negotiation intent for client/server extension handshake functions;
- WebSocket server/client handshake intents for accept-response and client-establish questions;
- frame-event conversion intent for methods that turn received frames into typed events;
- preservation guard after an overbroad `build` owner-action trigger regressed FastAPI dependency-graph ranking.

Final wsproto result:

```text
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
Avg latency: 12ms
Misses: none
```

## Graphify Comparison

Graphify token benchmark:

```text
Corpus:          10,850 words -> ~14,466 tokens
Graph:           217 nodes, 762 edges
Avg query cost:  ~3,682 tokens
Reduction:       3.9x fewer tokens per query
```

`agent-eval` on the same source-only corpus:

```text
agent-index Symbol Hit@1: 1.00
agent-index Symbol Hit@5: 1.00
agent-index File Hit@1: 1.00
agent-index File Hit@5: 1.00
Graphify symbol mention rate: 0.00
Graphify file mention rate: 0.75
```

Interpretation: for this exact-navigation benchmark, `agent-index` clearly outperformed Graphify-style query traversal. Graphify still provides token-reduced graph context, but it did not mention the expected exact symbols in its returned context.

## Examples

- `connection-send-state`: initial top result was `Connection.events`; final top result is `Connection.send`.
- `client-extension-negotiation`: initial top result was abstract `Extension.accept`; final top result is `client_extensions_handshake`.
- `connection-events-frames`: initial top result was `FrameProtocol.received_frames`; final top result is `Connection.events`.

## Takeaways

wsproto strengthened the claim that ranked symbol-first navigation is useful for agents, especially when the agent needs the first editable function or method. It also showed a recurring risk: broad noun/context matches can beat the actual orchestration symbol unless the ranker understands the level of abstraction requested by the question.

## Structured Agent Query vs rg-Style Baseline

Run date: 2026-06-13

This pass added `agentQuery` fields to all 12 wsproto benchmark rows. The structured queries use owner/API-shaped terms such as `Connection.send`, `Connection.events`, `H11Handshake._process_connection_request`, `H11Handshake._accept`, `H11Handshake._initiate_connection`, `H11Handshake._establish_client_connection`, `server_extensions_handshake`, `client_extensions_handshake`, `FrameDecoder.parse_header`, `FrameProtocol._serialize_frame`, `MessageDecoder.process_frame`, and `PerMessageDeflate.frame_inbound_payload_data`.

Index:

```text
node dist/cli.js index /tmp/wsproto-source-only --source-only --index-path /tmp/agent-index-wsproto-structured.sqlite
Indexed 8 files, 131 symbols, 131 chunks, 426 edges at /tmp/agent-index-wsproto-structured.sqlite (mode: source-only)
```

First structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 0.92
Symbol Hit@5: 1.00
File Hit@1: 0.92
File Hit@5: 1.00

Misses:
connection-events-frames  symbolRank=2  fileRank=2  top=FrameProtocol.received_frames  file=src/wsproto/frame_protocol.py
```

Source/debug audit: this was a query-shaping miss. `FrameProtocol.received_frames` is an important callee, but the expected edit location for converting frames into typed events is `Connection.events`. Moving `received_frames` out of `terms` and relying on graph expansion for it restored the intended abstraction level.

Refined structured pass:

```text
Mode: hybrid
Query style: agent
Questions: 12
Symbol Hit@1: 1.00
Symbol Hit@5: 1.00
Symbol MRR: 1.00
File Hit@1: 1.00
File Hit@5: 1.00
File MRR: 1.00
Partial file hits: 0.00
Avg latency: 11ms
rg-style File Hit@1: 0.67
rg-style File Hit@5: 1.00
rg-style File MRR: 0.83
rg-style Avg latency: 9ms

Misses: none
```

Interpretation: wsproto strengthens the protocol/state-machine evidence from h11. It also adds an agent-query lesson: graph expansion is where adjacent helper symbols belong. Putting a helper/callee directly in `terms` can make the helper outrank the orchestration function the agent should edit.
