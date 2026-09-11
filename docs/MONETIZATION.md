# PawLine — Monetization & Partnership Recommendation

*Based on the research pass of July 2026. This is the part only a human can
execute: relationships, emails, meetings. The app-side infrastructure
(sponsor/partner strip, admin management) is already built.*

## The one-paragraph conclusion

PawLine should not try to make money from users, rescuers, or vets in year
one — every comparable platform that did so before reaching critical mass
died, and this category runs on trust. The realistic, non-trust-eroding
model is **layered**: (1) corporate sponsorship from pet-adjacent and
CSR-motivated brands, which already fund animal welfare in both countries;
(2) grants and NGO partnership money, including Turkey's state Animal
Welfare Fund channel once operating there; (3) later, optional paid
convenience features for vet clinics — never gatekeeping rescue itself.
Realistic year-one ceiling in Azerbaijan alone: **roughly $5–20k/year** —
enough to cover infrastructure many times over and fund modest promotion,
not a salary. The strategic asset you're actually building is *the verified
rescue-coordination network and its data* (response times, hotspots,
outcomes), which is what larger organizations and municipalities will
eventually pay for or partner around.

## Why (what the research showed)

- **Precedents that fund this exact ecosystem already exist locally.**
  BakuPAWS has funded street-animal work for years through corporate
  partnerships where companies donate and get publicized as supporters.
  You are not inventing a market; you're offering companies a better,
  measurable version of something they already buy.
- **Pet-industry CSR is a real, structured budget line**, not charity
  vibes: Purina/Mars-scale programs, and dozens of smaller brands, fund
  shelters and welfare tech for brand association. Their stated criteria:
  transparency, measurable impact, year-round presence — all things
  PawLine's public case history provides natively ("X animals reached a
  vet this month via PawLine, supported by ___").
- **Cause-driven apps that monetized users failed or stalled**; the ones
  that survived (Nextdoor et al.) monetized *organizations* wanting access
  to an engaged local audience — and only after liquidity. The hyperlocal
  graveyard (Patch etc.) died replicating city-by-city liquidity, not from
  lack of ad formats.
- **Turkey specifically**: the 2021 law created a state **Animal Welfare
  Fund** that finances municipalities and *nonprofits/activists* for
  animal-welfare work, and HAYTAP federates ~70 provincial organizations.
  Entering Turkey through partnership (offering PawLine as infrastructure
  to those organizations) is both the growth strategy and the funding
  strategy — the same conversation.

## Who to approach (concrete, in order)

**Tier 1 — credibility partners (free, do first).** Baku Street Dog Rescue,
BakuPAWS, BARS, GWARP, ASPA/AARC. Offer: verified organization presence,
their clinics/contacts in the vet directory, the "Partners" strip, and
their cases amplified. Ask: they announce PawLine to their followers and
route "we're at capacity" reports through it. Value: this is what makes the
app *work* (supply of rescuers), and sponsor conversations become 10×
easier with recognizable partner logos already on screen.

**Tier 2 — sponsors (the actual money).** In rough order of fit:
1. **Pet retail & food**: pet shop chains and pet-food importers/distributors
   in Baku (they have marketing budgets and perfect audience alignment).
2. **Vet pharma/supply distributors** — the vets on the platform are their
   customers; sponsoring the vet directory is direct B2B marketing.
3. **Banks/telecoms with CSR programs** (Azerbaijani banks and mobile
   operators run visible CSR): a "supported by" placement plus a co-branded
   campaign ("every rescue this month powered by ___").
4. **International**: SPCA International's shelter-support fund already
   funds Azerbaijani orgs (GWARP) — a grant application route, plus pet
   brands' global giving programs once there's traction data.

**The pitch (one paragraph you can adapt):** "PawLine is the app people in
Baku use to get injured street animals to a vet — every rescue is public,
timestamped, and photographed from report to recovery. Sponsorship puts
your brand on every one of those moments: a 'Supported by' placement in
the app, named in our monthly impact post (X animals helped, Y rescuers,
Z clinics). Packages from ₼X/month." Offer 3 tiers; anchor the top tier
around what a month of local social-media advertising costs them.

**Realistic numbers**: local sponsorships in a market this size typically
land at the equivalent of **$100–500/month per sponsor** early on; 2–4
sponsors is a sane year-one target ($3–15k/yr), plus one grant application
(SPCA International shelter fund / EU civil-society small grants for the
Caucasus) which can add $2–10k. Infrastructure costs are ~$300–600/yr
(Supabase Pro + domain), so break-even is one small sponsor.

## What NOT to do (trust red lines)

- No ads inside case pages, chats, or notifications — sponsor presence
  stays in the strip and the vet directory only.
- No paid priority for cases, ever. An animal's visibility must never
  depend on money.
- No platform-handled donations (already out of scope) — the moment money
  flows through you, you inherit financial liability and trust risk that
  kills exactly the neutrality that makes sponsors comfortable.
- Don't sell data. Aggregate, anonymized impact stats (for sponsors'
  reports and municipal conversations) are fine; user data is not.

## Sequencing

1. **Now → launch**: sign 2–3 Tier-1 partners. Populate the Partners strip.
2. **Month 1–3**: publish a monthly impact number (the DB already has it:
   resolved cases, median time-to-rescue). This is your sales asset.
3. **Month 3–6**: pitch 5–10 Tier-2 sponsors with that data. Close 2.
4. **Turkey entry (when ready)**: approach HAYTAP-affiliated associations
   as infrastructure partner, not competitor; explore Animal Welfare Fund
   eligibility with a local nonprofit co-applicant.
5. **Later (only after liquidity)**: optional paid vet features (clinic
   profile enhancements, multi-staff accounts) — never core rescue flow.
