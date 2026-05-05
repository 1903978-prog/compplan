---
name: AR escalation — T+60
agent: ar_agent
trigger: Invoice 60 days overdue, escalate to senior contact
slots: [client_name, senior_contact_name, invoice_number, amount, original_due_date, days_overdue, payment_details, sender_name, sender_role]
output: markdown
---

Subject: Overdue payment — Invoice {{invoice_number}} — {{days_overdue}} days

Dear {{senior_contact_name}},

I am writing to bring to your attention that invoice {{invoice_number}} for {{amount}}, due {{original_due_date}}, remains unpaid after {{days_overdue}} days despite multiple reminders.

We value our relationship with {{client_name}} and want to resolve this quickly. Please arrange immediate payment or contact me directly to discuss a resolution.

If payment is not received within 5 business days, we will be required to review the continuation of our engagement.

Payment details:
{{payment_details}}

{{sender_name}}
{{sender_role}}, Eendigo
