-- Update slide_methodology_configs for slide_id = 'context'
-- Target: "Context & Value at Stake" slide rendered like the reference deck
-- (3 cols: Context bullets | numbered Value Drivers | waterfall bridge).
--
-- Safe to re-run. Uses INSERT ... ON CONFLICT so it works whether the row
-- exists or not. Only touches fields we own; leaves guidance_image / examples
-- / variations alone on updates.

INSERT INTO slide_methodology_configs (
  slide_id, purpose, structure, rules, columns, format, insight_bar, updated_at
) VALUES (
  'context',
  'Establish the business context and quantify the value at stake. A single insight-driven headline ties a specific operational change to a concrete revenue and EBITDA uplift. Three columns tell the story: client situation, numbered value drivers, and a base-case revenue bridge. The reader must walk away with one number and a clear cause.',
  '{"sections":[
    "Eyebrow (CONTEXT & VALUE AT STAKE | [PILOT SCOPE])",
    "Insight title (one sentence tying a specific lever to a euro range of incremental revenue AND EBITDA in a specific region/scope)",
    "Column 1 — Context (5 bullets on business target, commercial priority, pilot scope, portfolio dynamics, segmentation gap)",
    "Column 2 — Value drivers (1 intro bullet + 4 numbered teal-circle drivers with euro ranges in parentheses)",
    "Column 3 — Base-case revenue bridge waterfall (4 uplift bars in teal + grey Total bar, value labels inside each bar, lever names on x-axis, EBITDA footnote row under axis)",
    "Base case assumption footnote (bottom right)",
    "Source line (bottom left)"
  ]}'::jsonb,
  'LAYOUT
- Three columns, left-to-right: Context | Value drivers | Base-case revenue bridge.
- Left two columns each ~25% width with a short teal underline under each column heading; right column ~45% width for the waterfall.
- Insight title is a single bold sentence, two lines max, with a full-width teal rule underneath it.
- Eyebrow sits above the title in small uppercase grey letters, separated by a pipe from the pilot scope.
- Source line in small grey text at bottom-left. Base-case assumption note in small grey text at bottom-right.

TYPOGRAPHY
- Insight title: bold, black, ~32pt equivalent. Exactly one sentence, two lines max, no period at the end.
- Column headings (Context / Value drivers / Base-case revenue bridge): bold teal, small, with short teal underline.
- Body bullets: dark charcoal, regular weight, ~13pt equivalent, tight line height.
- Numbers inside waterfall bars and on EBITDA row: bold, white on teal bars, white on dark grey Total bar.

COLOR PALETTE
- Primary teal: #17A2B8 (value drivers circles, column underlines, waterfall uplift bars, title rule).
- Dark grey total: #4A4A4A for the Total bar.
- Text body: #2A2A2A.
- Secondary grey: #7A7A7A for eyebrow, axis labels, footnotes, source.

BULLET STYLE
- Context column: teal round dot bullets, no numbering, 5 bullets maximum.
- Value drivers column: first bullet is a teal round dot giving the framing (e.g. "Customer-level segmentation can expose where potential margin and whitespace are highest"), followed by 4 numbered drivers. Each numbered driver uses a teal filled circle with a white number (1-4) as the marker. Each driver ends with a euro range in parentheses (e.g. "(€2.5-3.8m)").

WATERFALL (BASE-CASE REVENUE BRIDGE)
- Exactly 5 bars: four teal uplift bars labelled 1/2/3/4 matching the value drivers (Focus, Sales time, Conversion, Coverage), then a dark grey Total bar.
- Each uplift bar sits stacked on top of the prior one (classic rising waterfall). Value label centered inside each bar in bold white.
- X-axis labels below bars: 1 Focus, 2 Sales time, 3 Conversion, 4 Coverage, Total.
- Under the x-axis, a second label row shows EBITDA flow-through for each lever (e.g. "EBITDA +1.3", "EBITDA +1.2", "EBITDA +0.6", "EBITDA +0.4", "EBITDA +3.5"). Same bold teal/dark style as the bar labels but smaller.
- Chart title "Base-case revenue bridge (€m)" in bold teal above the chart.
- No gridlines. No y-axis numbers. The bar value labels carry the precision.

CONTENT RULES
- Title MUST quantify both revenue AND EBITDA as a range (c. €X-Ym rev / c. €A-Bm EBITDA) and MUST name the region or pilot scope explicitly.
- Context bullets must be short (max ~20 words each), factual, and anchored to the actual client situation — no generic language.
- Value driver labels must be crisp operational levers (no buzzwords) and each must carry its own euro range in parentheses so the reader can trace the bar back to the lever.
- The sum of the 4 uplift bars must equal the Total, and the sum of the 4 EBITDA footnotes must equal the Total EBITDA line. Do not publish a chart whose numbers do not reconcile.
- Base case assumption footnote must name the two key assumptions: (1) where the uplift is concentrated (e.g. highest-priority whitespace accounts) and (2) the EBITDA flow-through rate used (e.g. 40%).
- Never leave the source line blank. If unknown, use "Eendigo analysis".',
  '{
    "column_1": "CONTEXT — 5 teal-dot bullets: (1) business target / EBITDA step-up ambition, (2) main commercial priority e.g. cross-sell into installed base, (3) pilot scope rationale (region, countries in scope), (4) portfolio dynamics / legacy default behavior, (5) segmentation maturity gap. Max ~20 words per bullet.",
    "column_2": "VALUE DRIVERS — 1 teal-dot framing bullet, then 4 numbered teal-circle drivers. Each numbered driver = one operational lever + euro range in parentheses. Drivers 1-4 must match the 4 waterfall bars by number and name.",
    "column_3": "BASE-CASE REVENUE BRIDGE — waterfall chart titled 'Base-case revenue bridge (€m)'. Four stacked teal uplift bars (Focus, Sales time, Conversion, Coverage) + dark grey Total bar. Value labels in bold white inside each bar. EBITDA footnote row under x-axis (EBITDA +x.x for each lever and total). Base case assumption note in small grey text below the chart."
  }'::jsonb,
  'A',
  1,
  now()::text
)
ON CONFLICT (slide_id) DO UPDATE SET
  purpose = EXCLUDED.purpose,
  structure = EXCLUDED.structure,
  rules = EXCLUDED.rules,
  columns = EXCLUDED.columns,
  format = EXCLUDED.format,
  insight_bar = EXCLUDED.insight_bar,
  updated_at = EXCLUDED.updated_at;

-- Verify
SELECT slide_id, purpose, format, insight_bar, left(rules, 120) AS rules_preview
FROM slide_methodology_configs
WHERE slide_id = 'context';
