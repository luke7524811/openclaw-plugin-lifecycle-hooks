#!/usr/bin/env bash
# Focus Update Hook (turn:post)
# Updates .focus/context.md Progress section with latest activity

set -euo pipefail

FOCUS_DIR="/root/.openclaw/workspace/.focus"
CONTEXT_FILE="$FOCUS_DIR/context.md"
PROJECT_FILE="/root/.openclaw/workspace/projects/openclaw-plugin-lifecycle-hooks/PROJECT.md"

# Exit silently if no active focus
[[ -d "$FOCUS_DIR" ]] || exit 0

# Get turn content from env (summarized by hook engine)
TURN_SUMMARY="${HOOK_SUMMARY:-${HOOK_RESPONSE:-}}"
[[ -z "$TURN_SUMMARY" ]] && exit 0

# Extract action, result, and details using simple heuristics
# Look for tool calls, success/failure indicators, etc.
ACTION=""
RESULT="🔄 In Progress"
DETAILS=""

# Parse action from tool calls or main activity
if echo "$TURN_SUMMARY" | grep -qi "tool.*exec\|running\|executing"; then
  ACTION=$(echo "$TURN_SUMMARY" | grep -oP '(?<=exec|running|executing).*' | head -1 | sed 's/^[: ]*//;s/  */ /g' | cut -c1-80)
elif echo "$TURN_SUMMARY" | grep -qi "writing\|creating\|updating"; then
  ACTION=$(echo "$TURN_SUMMARY" | grep -oiP '(writing|creating|updating).*' | head -1 | cut -c1-80)
elif echo "$TURN_SUMMARY" | grep -qi "reading\|analyzing"; then
  ACTION=$(echo "$TURN_SUMMARY" | grep -oiP '(reading|analyzing).*' | head -1 | cut -c1-80)
else
  # Default: first meaningful line
  ACTION=$(echo "$TURN_SUMMARY" | grep -v '^$' | head -1 | cut -c1-80)
fi

# Detect result status
if echo "$TURN_SUMMARY" | grep -qiE "success|✅|done|completed|passed"; then
  RESULT="✅ Success"
elif echo "$TURN_SUMMARY" | grep -qiE "error|failed|❌|blocked"; then
  RESULT="❌ Failed"
fi

# Extract details (first error or meaningful output line)
if [[ "$RESULT" == "❌ Failed" ]]; then
  DETAILS=$(echo "$TURN_SUMMARY" | grep -iE "error|fail" | head -1 | cut -c1-100)
else
  DETAILS=$(echo "$TURN_SUMMARY" | grep -v '^$' | tail -1 | cut -c1-100)
fi

# Update .focus/context.md Progress section
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M UTC")
PROGRESS_UPDATE="**Latest:** $TIMESTAMP — $RESULT — ${ACTION:-Activity}"

# Update the Progress section in context.md (replace "Latest:" line or add after "## Progress")
if grep -q "^\*\*Latest:\*\*" "$CONTEXT_FILE" 2>/dev/null; then
  sed -i "s|^\*\*Latest:\*\*.*|$PROGRESS_UPDATE|" "$CONTEXT_FILE"
else
  # Add after "## Progress" line
  sed -i "/^## Progress/a $PROGRESS_UPDATE" "$CONTEXT_FILE"
fi

# Also log to action log (call the action logger)
export HOOK_SUMMARY="$TURN_SUMMARY"
/root/.openclaw/workspace/scripts/hooks/log-action.sh

# Update Active Work table in PROJECT.md if it exists
if [[ -f "$PROJECT_FILE" ]]; then
  # Extract current branch and update Active Work table
  BRANCH=$(cd /root/.openclaw/workspace/projects/openclaw-plugin-lifecycle-hooks && git branch --show-current 2>/dev/null || echo "unknown")
  FEATURE=$(echo "$ACTION" | cut -c1-40)
  
  # Only update if this is actual work (not just reading)
  if ! echo "$ACTION" | grep -qiE "^reading|^analyzing|^checking"; then
    # Simple update: replace the (none currently) row or add new row
    TIMESTAMP_SHORT=$(date -u +"%m-%d %H:%M")
    RESULT_SHORT=$(echo "$RESULT" | sed 's/ Success//;s/ Failed//;s/ In Progress//')
    
    # Check if there's a "none currently" placeholder
    if grep -q "| (none currently) |" "$PROJECT_FILE"; then
      sed -i "s|^| (none currently) .*|^| $FEATURE | $BRANCH | 🔄 | $TIMESTAMP_SHORT | $TIMESTAMP_SHORT | $RESULT_SHORT |" "$PROJECT_FILE"
    fi
  fi
fi

exit 0
