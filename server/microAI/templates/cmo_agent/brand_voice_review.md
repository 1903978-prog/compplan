---
name: Brand voice review report
agent: cmo_agent
trigger: Any external content draft
slots: [content_type, overall_score, voice_issues, terminology_flags, claim_flags, recommendation]
output: markdown
---

# Brand voice review — {{content_type}}

**Overall score:** {{overall_score}}/100

## Voice issues
{{#each voice_issues}}
- {{issue}} → suggest: {{fix}}
{{/each}}

## Terminology flags
{{#each terminology_flags}}
- "{{term_used}}" → use "{{preferred_term}}"
{{/each}}

## Unsubstantiated claims
{{#each claim_flags}}
- {{claim}} → needs evidence
{{/each}}

## Recommendation
{{recommendation}}
