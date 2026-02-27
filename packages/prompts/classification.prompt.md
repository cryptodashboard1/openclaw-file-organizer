Given file metadata, filename, path hints, extension, and optional lightweight extracted text snippets, classify each file into one of the supported classes.

Return for each file:
- classification
- confidence (0..1)
- generated_label
- rationale
- rename_ok (boolean)
- move_ok (boolean)
- manual_review (boolean)

Rules:
- Do not infer sensitive meaning without evidence in the signals.
- If signals are weak or ambiguous, lower confidence and prefer manual_review.
- Keep rationale short and concrete.

