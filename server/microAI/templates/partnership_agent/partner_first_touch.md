---
name: Partner first touch
agent: partnership_agent
trigger: New partner prospect identified
slots: [partner_name, partner_company, partnership_type, mutual_benefit, our_angle, sender_name, sender_role]
output: markdown
---

Subject: Partnership opportunity — Eendigo × {{partner_company}}

Hi {{partner_name}},

I'm reaching out because I see a strong potential for collaboration between {{partner_company}} and Eendigo around {{partnership_type}}.

{{mutual_benefit}}

{{our_angle}}

Would you be open to a brief exploratory conversation? I'd love to understand your current priorities and see if there's a fit.

{{sender_name}}
{{sender_role}}, Eendigo
