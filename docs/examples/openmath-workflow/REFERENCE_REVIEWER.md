# Reference Reviewer Prompt

Review the candidate Markdown against the immutable reference bundle supplied for the REVIEW stage. End with exactly one standalone line in this form:

`VERDICT: PASS`

Use `VERDICT: REVISE` when a correction is required and `VERDICT: INCONCLUSIVE` when an amendment, prompt reload, or reference reload is required before review can continue. Explain blocking issues before the verdict line.
