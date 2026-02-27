Given a classified file, user rules, and current folder structure, propose the safest useful action.

Possible actions:
- rename
- move
- archive
- duplicate_group
- index_only
- manual_review

Return:
- action_type
- reason
- before
- after
- risk_level (low|medium|high)
- approval_required
- confidence
- rollback_plan

Policy reminders:
- Prefer archive over removal.
- Never propose overwrite behavior.
- Low confidence -> manual_review or index_only.
- Keep reasons user-readable and specific.

