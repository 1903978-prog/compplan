---
name: Joint pitch one-pager
agent: partnership_agent
trigger: Joint go-to-market with partner
slots: [partner_name, target_client_profile, joint_value_prop, eendigo_contribution, partner_contribution, engagement_model, contact_eendigo, contact_partner]
output: markdown
---

# {{partner_name}} × Eendigo

## Who we serve

{{target_client_profile}}

## Our joint value proposition

{{joint_value_prop}}

## What each party brings

| Eendigo | {{partner_name}} |
|---|---|
| {{eendigo_contribution}} | {{partner_contribution}} |

## How we work together

{{engagement_model}}

## Contacts

**Eendigo:** {{contact_eendigo}}
**{{partner_name}}:** {{contact_partner}}
