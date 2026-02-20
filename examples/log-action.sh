#!/usr/bin/env bash
# Action Log Hook (turn:post + subagent:post)
# Appends action entries to .focus/action-log.md

set -euo pipefail

LOG_FILE="/root/.openclaw/workspace/.focus/action-log.md"
MAX_ENTRIES=50

# Create log file if it doesn't exist
if [[ ! -f "$LOG_FILE" ]]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  cat > "$LOG_FILE" <<'EOF'
# Action Log
> Auto-generated action tracking log. Last 50 entries.

EOF
fi

# Get turn/subagent content from env
TURN_SUMMARY="${HOOK_SUMMARY:-${HOOK_RESPONSE:-}}"
[[ -z "$TURN_SUMMARY" ]] && exit 0

# Parse action and result using heuristics
ACTION="Unknown action"
RESULT="🔄 In Progress"
DETAILS=""

# Extract action type
if echo "$TURN_SUMMARY" | grep -qi "tool.*exec\|executing\|running"; then
  # Extract command if possible
  CMD=$(echo "$TURN_SUMMARY" | grep -oP '(?<=command[: ]).*' | head -1 | cut -c1-60)
  [[ -n "$CMD" ]] && ACTION="Exec: $CMD" || ACTION="Executed command"
elif echo "$TURN_SUMMARY" | grep -qi "writing.*file\|creating.*file"; then
  FILE=$(echo "$TURN_SUMMARY" | grep -oP '(?<=to |file |path )[^ ]+' | head -1)
  [[ -n "$FILE" ]] && ACTION="Write: $FILE" || ACTION="Wrote file"
elif echo "$TURN_SUMMARY" | grep -qi "reading"; then
  FILE=$(echo "$TURN_SUMMARY" | grep -oP '(?<=reading |read )[^ ]+' | head -1)
  [[ -n "$FILE" ]] && ACTION="Read: $FILE" || ACTION="Read file"
elif echo "$TURN_SUMMARY" | grep -qi "editing\|updating"; then
  FILE=$(echo "$TURN_SUMMARY" | grep -oP '(?<=editing |updating )[^ ]+' | head -1)
  [[ -n "$FILE" ]] && ACTION="Edit: $FILE" || ACTION="Edited file"
elif echo "$TURN_SUMMARY" | grep -qi "git.*commit"; then
  ACTION="Git commit"
elif echo "$TURN_SUMMARY" | grep -qi "git.*push"; then
  ACTION="Git push"
elif echo "$TURN_SUMMARY" | grep -qi "test"; then
  ACTION="Running tests"
else
  # Default: use first meaningful line
  ACTION=$(echo "$TURN_SUMMARY" | grep -v '^[[:space:]]*$' | head -1 | cut -c1-60)
fi

# Detect result
if echo "$TURN_SUMMARY" | grep -qiE "success|✅|done|completed|passed"; then
  RESULT="✅ Success"
elif echo "$TURN_SUMMARY" | grep -qiE "error|failed|❌|blocked|failed"; then
  RESULT="❌ Failed"
elif echo "$TURN_SUMMARY" | grep -qiE "warning|⚠️"; then
  RESULT="⚠️ Warning"
fi

# Extract details
if [[ "$RESULT" == "❌ Failed" ]]; then
  DETAILS=$(echo "$TURN_SUMMARY" | grep -iE "error|fail|exception" | head -1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | cut -c1-100)
else
  # For success/progress: use a summary line
  DETAILS=$(echo "$TURN_SUMMARY" | grep -v '^[[:space:]]*$' | sed -n '2p' | cut -c1-100)
fi

[[ -z "$DETAILS" ]] && DETAILS="No details available"

# Generate entry
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
ENTRY=$(cat <<EOF

## [$TIMESTAMP]
- **Action:** $ACTION
- **Result:** $RESULT
- **Details:** $DETAILS
EOF
)

# Append to log
echo "$ENTRY" >> "$LOG_FILE"

# Trim to last MAX_ENTRIES entries (count "## [" lines)
ENTRY_COUNT=$(grep -c "^## \[" "$LOG_FILE" || echo 0)
if [[ $ENTRY_COUNT -gt $MAX_ENTRIES ]]; then
  # Keep header + last MAX_ENTRIES entries
  # Find the line number of the (entry_count - max_entries + 1)th entry
  CUTOFF_LINE=$(grep -n "^## \[" "$LOG_FILE" | sed -n "$((ENTRY_COUNT - MAX_ENTRIES + 1))p" | cut -d: -f1)
  if [[ -n "$CUTOFF_LINE" ]]; then
    # Keep everything from header to cutoff, then from cutoff to end
    HEADER_END=$(grep -n "^# Action Log" "$LOG_FILE" | head -1 | cut -d: -f1)
    HEADER_END=$((HEADER_END + 2))  # Include header + blank line
    {
      head -n "$HEADER_END" "$LOG_FILE"
      tail -n +"$CUTOFF_LINE" "$LOG_FILE"
    } > "$LOG_FILE.tmp"
    mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
fi

exit 0
