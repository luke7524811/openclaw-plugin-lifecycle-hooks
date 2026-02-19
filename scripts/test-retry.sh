#!/bin/bash
# Test script: fails twice, succeeds on 3rd attempt
COUNTER_FILE="/tmp/test-retry-counter"
LOGFILE="/tmp/retry-test.log"

COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
echo "${TIMESTAMP} | attempt=${COUNT} | tool=${HOOK_TOOL:-none}" >> "$LOGFILE"

if [ "$COUNT" -lt 3 ]; then
  echo "${TIMESTAMP} | attempt=${COUNT} | FAILED (intentional)" >> "$LOGFILE"
  exit 1
else
  echo "${TIMESTAMP} | attempt=${COUNT} | SUCCESS" >> "$LOGFILE"
  # Reset counter for next test
  rm -f "$COUNTER_FILE"
  exit 0
fi
