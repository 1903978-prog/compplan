---
name: AR reminder — T+0 gentle
agent: ar_agent
trigger: Invoice due date reached, not yet paid
slots: [client_name, contact_name, invoice_number, invoice_date, amount, due_date, payment_details, sender_name]
output: markdown
---

Subject: Invoice {{invoice_number}} — due today

Hi {{contact_name}},

A quick note to flag that invoice {{invoice_number}} ({{amount}}, dated {{invoice_date}}) is due today.

If payment is already in process, please disregard this message. Otherwise, details are below:

{{payment_details}}

Thank you — please don't hesitate to reach out with any questions.

{{sender_name}}
Eendigo
