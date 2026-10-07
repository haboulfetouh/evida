#!/bin/sh
# Jibri "finalize_recording_script_path" hook.
# Uploads the finished recording to EVIDA's private bucket under <orgId>/recordings/<uuid>.mp4
# and notifies EVIDA with an HMAC-signed event. EVIDA discards the file unless recording is enabled
# for the organisation and interview AND the candidate consented.
#
# Required env on the Jibri host: EVIDA_URL, EVIDA_WEBHOOK_SECRET (= JITSI_WEBHOOK_SECRET),
# EVIDA_ORG_ID, S3_BUCKET and S3 credentials for the aws CLI.
set -eu
DIR="$1"                                   # Jibri passes the recording directory
FILE=$(ls "$DIR"/*.mp4 | head -n1)
ROOM=$(basename "$FILE" | sed -E 's/_[0-9-]+_[0-9-]+\.mp4$//')
# Room → organisation mapping is deliberately not exposed by EVIDA. Run one Jibri pool per tenant
# (or per dedicated deployment) and set EVIDA_ORG_ID; EVIDA rejects keys outside the room's tenant prefix.
KEY="${EVIDA_ORG_ID}/recordings/$(cat /proc/sys/kernel/random/uuid).mp4"
aws s3 cp "$FILE" "s3://${S3_BUCKET}/${KEY}" --sse AES256 --only-show-errors
SIZE=$(stat -c %s "$FILE")
BODY=$(printf '{"event":"recording.uploaded","roomName":"%s","storageKey":"%s","sizeBytes":%s}' "$ROOM" "$KEY" "$SIZE")
TS=$(date +%s)
SIG="v1=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$EVIDA_WEBHOOK_SECRET" -hex | awk '{print $2}')"
curl -fsS -X POST "${EVIDA_URL}/api/v1/integrations/jitsi/events" \
  -H 'content-type: application/json' -H "x-evida-timestamp: ${TS}" -H "x-evida-signature: ${SIG}" --data "$BODY"
rm -f "$FILE"                              # never keep local copies on the recorder
