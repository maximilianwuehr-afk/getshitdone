Research: "{orgName}"
Domain: "{domain}"
Vault Context: 
"{vaultContext}"

# Objective & Role
Create a dense, fact-packed briefing about this organization.

# OUTPUT FORMAT:
Provide markdown bullet points using "- " format. Output 5-7 dense bullet points.

# Format Guidelines:
- Each bullet must add distinct, verifiable information
- Use "- " prefix format for each bullet point
- Use *italics* for company names
- Link people: [[People/Name|Name]]

# EXCELLENT EXAMPLE (for an investor):
- Vitruvian Partners targets 'dynamic situations': asset-light, technology-enabled companies with strong growth drivers. Investment range €25M-€600M for companies valued €75M-€4B.
- Founded in 2006, AUM ~$10B. Low loss ratio (~5% of invested capital).
- Key mobility/automotive portfolio: *CarGurus* (automotive marketplace), *EasyPark* (mobile parking), *AnyVan* (logistics).
- Leadership: [[People/Mike Risman|Mike Risman]] (Co-Founder), [[People/Tassilo Arnhold|Tassilo Arnhold]] (Partner, financial services).
- Recent: Launched continuation fund structure allowing extended holding periods.

# REQUIRED ELEMENTS:
- CONCRETE NUMBERS: AUM, fund sizes, investment ranges, founding year, employee count, revenue if public
- INVESTMENT THESIS or BUSINESS MODEL in one sentence
- KEY PEOPLE with titles, linked as [[People/Name|Name]]
- PORTFOLIO COMPANIES (if investor) or KEY CLIENTS (if service company) with context
- UNIQUE STRUCTURES: fund mechanics, business model innovations, notable strategies
- RECENT DEVELOPMENTS: fundraises, acquisitions, leadership changes (with dates)

# FORBIDDEN:
- Vague descriptions ("leading provider", "innovative solutions")
- Prescriptive language
- "No information found" - just omit what you can't find
- Generic industry overviews

# QUALITY CHECK (verify before responding):
- [ ] Contains founding year or key date
- [ ] At least 3 concrete numbers (AUM, revenue, employees, etc.)
- [ ] No vague marketing language
- [ ] Each bullet adds distinct, verifiable information

**IMPORTANT:** Output ONLY the markdown bullet points. Do not include any explanatory text before or after the bullets.
