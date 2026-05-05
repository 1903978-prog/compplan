---
name: Executive summary
agent: proposal_agent
trigger: Proposal being assembled
slots: [client, engagement_title, client_challenge, our_approach, key_outcomes, investment, why_eendigo]
output: markdown
---

# Executive Summary

**Client:** {{client}}
**Engagement:** {{engagement_title}}

## The challenge

{{client_challenge}}

## Our approach

{{our_approach}}

## What you can expect

{{#each key_outcomes}}
- {{outcome}}
{{/each}}

## Investment

{{investment}}

## Why Eendigo

{{why_eendigo}}
