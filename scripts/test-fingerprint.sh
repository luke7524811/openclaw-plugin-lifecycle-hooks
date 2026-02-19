#!/bin/bash
LOGFILE="/tmp/test-harness-fingerprints.log"
ENTRY="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ) | session=${HOOK_SESSION:-unknown} | point=${HOOK_POINT:-unknown} | tool=${HOOK_TOOL:-none} | topic=${HOOK_TOPIC:-none}"
HASH=$(echo -n "$ENTRY" | sha256sum | cut -d' ' -f1)
echo "${ENTRY} | sha256=${HASH}" >> "$LOGFILE"
