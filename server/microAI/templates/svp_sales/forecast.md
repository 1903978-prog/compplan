---
name: Quarterly forecast
agent: svp_sales
trigger: Quarter-end +/- 2 weeks
slots: [quarter, target, commit, best_case, worst_case, gap_to_target, top_risks, commit_vs_target, best_vs_target, worst_vs_target]
output: markdown
---

# Forecast — {{quarter}}

| Scenario | € | vs Target |
|---|---|---|
| Target | €{{target}} | — |
| Commit | €{{commit}} | {{commit_vs_target}} |
| Best case | €{{best_case}} | {{best_vs_target}} |
| Worst case | €{{worst_case}} | {{worst_vs_target}} |

**Gap to target:** €{{gap_to_target}}

## Top risks
{{#each top_risks}}
- {{risk}}
{{/each}}
