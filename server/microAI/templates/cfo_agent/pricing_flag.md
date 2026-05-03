---
name: Pricing governance flag
agent: cfo_agent
trigger: Discount > threshold OR fee below corridor
slots: [proposal_id, client, fee_proposed, corridor_min, corridor_max, deviation_pct, justification_required]
output: markdown
---

# Pricing flag — Proposal #{{proposal_id}}

**Client:** {{client}}
**Fee proposed:** €{{fee_proposed}}
**Corridor:** €{{corridor_min}} – €{{corridor_max}}
**Deviation:** {{deviation_pct}}%

## Required justification
{{justification_required}}

## Approval level: L1 if <10% off / L2 if 10–25% / L3 if >25%
