---
name: Strategic deal one-pager
agent: svp_sales
trigger: Deals >€100k or strategic accounts
slots: [client, why_strategic, value, decision_makers, our_angle, competitive, asks_from_president]
output: markdown
---

# {{client}} — Strategic Deal One-Pager

## Why strategic
{{why_strategic}}

## Value at stake
€{{value}}

## Decision makers
{{decision_makers}}

## Our angle
{{our_angle}}

## Competitive
{{competitive}}

## What we need from the President
{{asks_from_president}}
