---
name: Process redesign proposal
agent: coo_agent
trigger: Manual work pattern detected ≥3 times in 30 days
slots: [process_name, current_state, pain_points, proposed_state, expected_savings, agents_affected]
output: markdown
---

# Process redesign: {{process_name}}

## Current state
{{current_state}}

## Pain points
{{#each pain_points}}
- {{pain}}
{{/each}}

## Proposed state
{{proposed_state}}

## Expected savings
{{expected_savings}}

## Agents affected
{{agents_affected}}
