# Fixtures

Webhook bodies the replay harness sends. `tests/replay.py` fills in the sender, message ID,
timestamp and text from each scenario event, re-serialises the body the way Meta does
(non-ASCII as `\uXXXX`, `/` as `\/`) and signs the exact bytes it sends.

- `meta/text.json` is hand-written in Meta's documented format, with placeholder numbers.
  Replace it with a redacted capture once P1's captures exist (design file 30).
