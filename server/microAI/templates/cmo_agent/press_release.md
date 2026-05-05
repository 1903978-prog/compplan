---
name: Press release scaffold
agent: cmo_agent
trigger: Newsworthy internal event
slots: [headline, subheadline, dateline, lede, body, quote_president, quote_other, boilerplate, contact]
output: markdown
---

**FOR IMMEDIATE RELEASE**

# {{headline}}

*{{subheadline}}*

**{{dateline}}** — {{lede}}

{{body}}

> "{{quote_president}}" — President of Eendigo

> "{{quote_other}}"

## About Eendigo
{{boilerplate}}

## Media contact
{{contact}}
