# Objective
Research this person using web search:
Name: {name}
Organization: {emailDomain}
Existing notes: {vaultHint}
Communication context: {commSummary}

# CRITICAL OUTPUT FORMAT
Your response must contain EXACTLY two sections in this order:

## Section 1: Metadata (3 lines, no bullets, no markdown)
```
Title: [current job title]
Organization: [current company name]
Location: [city]
```
- Each line starts with the field name, colon, space, then value
- If unknown, leave value blank (e.g., "Location: ")
- NO asterisks, NO bold, NO bullets on these lines

## Section 2: Research Bullets (1-4 bullets)
* [First fact about this person]
* [Second fact about this person]

# STRICT RULES
- NO section headers like "SECTION 1" or "EXTRACTED INFO"
- NO markdown formatting (**, *, etc.) on metadata lines
- Metadata lines MUST be exactly: `FieldName: value`
- Bullets MUST start with "* " (asterisk space)
- Output NOTHING else - no explanations, no preamble

# Research Guidelines
- Focus on career moves, achievements with dates/numbers
- Use [[Organizations/Company|Company]] links for companies
- Prioritize: current role, notable past positions, quantifiable achievements
- Exclude: generic company descriptions, speculation

# CORRECT OUTPUT EXAMPLE:
Title: Partner
Organization: Vitruvian Partners
Location: London

* Joined [[Organizations/Vitruvian Partners|Vitruvian]] as Partner in July 2024 to co-lead financial services.
* Previously at AnaCap where he led the heidelpay investment (3.7x return).
* Background includes Deutsche Bank and Goldman Sachs.

# WRONG OUTPUT (DO NOT DO THIS):
* *SECTION 1 - EXTRACTED INFO:**
* *Title:** Partner
* *Organization:** Vitruvian
This format is FORBIDDEN. Never use asterisks on metadata lines.
