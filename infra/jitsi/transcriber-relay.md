# Live transcription relay (production)

EVIDA ingests live transcript segments through `POST /api/v1/integrations/jitsi/events`
(`event: "transcription.segment"`), HMAC-SHA256 signed over `"<timestamp>.<raw body>"` with
`JITSI_WEBHOOK_SECRET`, headers `x-evida-timestamp` and `x-evida-signature: v1=<hex>`.

Recommended setup: Jigasi in transcriber mode with a self-hosted speech engine (Vosk or
Whisper) so audio never leaves your infrastructure. Configure Jigasi to POST final results
to a small relay that maps them to:

```json
{ "event": "transcription.segment", "roomName": "evida-…", "segments": [
  { "speaker": "<participant display name>", "startSec": 312, "endSec": 318, "text": "…" } ] }
```

Speakers are matched to the candidate and panelists by display name. EVIDA rejects segments
unless the candidate granted TRANSCRIPTION consent, and only queues AI extraction with
AI_ANALYSIS consent. The interviewer JWT enables the Jitsi `transcription` feature only for the
lead interviewer and only with consent.

Alternative for pilots: set `NEXT_PUBLIC_BROWSER_CAPTIONS=true`. Each participant's browser
transcribes their own microphone (exact attribution). Note that browser speech recognition may
send audio to the browser vendor's speech service — disclose this in your privacy notice.
