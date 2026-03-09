# Ember — Launch Plan

## Where We Are (Current State)

**Product Readiness: ~52%**

### What's Working
- 15 kitchen ops tabs (opening, closing, prep, sidework, temps, waste, recipes, etc.)
- JWT auth with manager/staff roles
- Share link staff access (HONEYBELLY code, name capture)
- Per-line checklist completion tracking with attribution
- Admin dashboard with CRUD for all features
- Frontend deployed on Vercel, backend on Railway
- 1 paying customer: Honey Belly Korean BBQ

### Critical Gaps
- **0% test coverage** — no tests at all
- **Security vulnerabilities** — no input validation, no rate limiting, exposed credentials
- **No billing/payments** — can't charge customers
- **No self-serve onboarding** — requires manual setup per restaurant
- **No error monitoring** — no Sentry, no logging
- **No mobile optimization** — kitchen staff use phones
- **No analytics/reporting** — managers can't see completion rates
- **No legal docs** — no ToS, privacy policy, or food safety disclaimers

---

## Competitive Position

Ember sits in a unique spot:
- **Simpler than** MarketMan/Apicbase/Galley (inventory-heavy, $200-500/mo)
- **More operational than** meez (recipe-focused)
- **Our niche**: Daily kitchen execution — checklists, shift ops, staff communication
- **Key differentiator**: Share link access (zero friction for staff, no app install)

---

## Pricing Strategy

| Tier | Price | Target | Features |
|------|-------|--------|----------|
| **Starter** | $49/mo per location | Independent restaurants, 1-3 locations | Checklists, Kitchen Bible, staff access, basic reporting, up to 15 staff |
| **Professional** | $99/mo per location | Multi-unit, 3-20 locations | + Advanced reporting, custom checklists, manager hierarchy, API, priority support |
| **Enterprise** | Custom ($200+/mo) | 20+ location chains | + SSO, dedicated support, custom integrations, SLA, audit logs |

Annual billing: 20% discount. Free trial: 14 days, no credit card.

---

## Launch Phases

### Phase 1: Foundation (Weeks 1-2) — "Make it solid"
Security hardening, input validation, error monitoring, mobile responsiveness.
**Goal**: A product you're not embarrassed to show to 10 restaurants.

### Phase 2: Monetization (Weeks 3-4) — "Make it a business"
Stripe billing, self-serve onboarding, pricing page, legal docs.
**Goal**: A restaurant can sign up, set up, and start paying without your help.

### Phase 3: Growth Features (Weeks 5-8) — "Make it sticky"
Reporting dashboard, notifications, photo verification, prep lists.
**Goal**: Features that make restaurants rely on Ember daily and never leave.

### Phase 4: Distribution (Weeks 9-12) — "Get customers"
Toast marketplace, content marketing, referral program, case study from Honey Belly.
**Goal**: 10-20 paying restaurants.

### Phase 5: Scale (Months 4-6) — "Grow the business"
Multi-unit features, integrations (7shifts, Square), enterprise features.
**Goal**: 50+ locations, $5K+ MRR.

---

## Phase 1 Tasks (Foundation)

### Security (Forge — Backend)
1. Add input validation with Zod on all API endpoints
2. Add rate limiting middleware (express-rate-limit) on auth endpoints
3. Add security headers (helmet.js — HTTPS, CSP, HSTS, XSS protection)
4. Rotate production database credentials and remove from .env file history
5. Add proper error handling with try-catch on all route handlers
6. Ensure restaurant_id data isolation on all queries (row-level security)

### Error Monitoring (Atlas — DevOps)
7. Set up Sentry for both frontend and backend error tracking
8. Set up uptime monitoring (UptimeRobot or Better Uptime)
9. Configure automated database backups on Railway
10. Set up basic request/response logging

### Mobile Experience (Phoenix — Frontend)
11. Mobile-first responsive redesign of Kitchen Bible tabs
12. Large tap targets (44px+) for kitchen use (greasy hands)
13. High-contrast mode for bright/dim kitchen lighting
14. Offline-capable checklist completion (service worker)

### Quality (Sentinel — QA)
15. Write E2E tests for core auth flow (login, staff join via share link)
16. Write E2E tests for checklist completion flow
17. Write E2E tests for admin CRUD operations
18. Accessibility audit of Kitchen Bible interface

### Design (Prism — Design)
19. Review and polish Kitchen Bible mobile layout
20. Design system audit — ensure consistent tokens, spacing, typography
21. Loading states and skeleton screens for all data-fetching views

## Phase 2 Tasks (Monetization)

### Billing (Forge — Backend)
22. Integrate Stripe — create subscription plans matching pricing tiers
23. Build webhook handler for Stripe events (subscription created, payment failed, canceled)
24. Add subscription status check middleware (block access if unpaid after trial)
25. Build trial tracking (14-day free trial, countdown, upgrade prompts)

### Onboarding (Phoenix — Frontend)
26. Build self-serve sign-up flow (restaurant name, owner email, password)
27. Build onboarding wizard: create first checklist → invite staff → see Kitchen Bible
28. Build billing/subscription management page (current plan, upgrade, cancel)
29. Build pricing page component for the app

### Landing Page (Phoenix — Frontend)
30. Redesign landing page with Honey Belly case study
31. Add pricing section with tier comparison
32. Add demo video embed (60-90 seconds)
33. Add Calendly integration for demo booking

### Legal (Manual — Not Agent Tasks)
34. Generate Terms of Service via Termly/iubenda
35. Generate Privacy Policy (CCPA-compliant)
36. Add food safety disclaimer ("Ember is not a food safety compliance tool")
37. Add cookie consent banner
38. Have attorney review (~$2-3K)

## Phase 3 Tasks (Growth Features)

### Reporting (Forge — Backend)
39. Build analytics API: completion rates by day/shift/person
40. Build activity log API: who did what, when, across all operations
41. Add staff performance metrics endpoint

### Reporting UI (Phoenix — Frontend)
42. Build reporting dashboard page with charts (completion rates, trends)
43. Build activity feed component (recent actions across all staff)
44. Add export to CSV/PDF for reports

### Notifications (Forge — Backend)
45. Add email notification system (SendGrid/Resend)
46. Incomplete task reminders (configurable per restaurant)
47. Daily summary email to managers

### Enhanced Ops (Phoenix — Frontend)
48. Photo verification for task completion (upload proof photo)
49. Dynamic prep lists based on expected covers
50. Training checklists for new hires with sign-off tracking
51. Shift notes / digital log book

## Phase 4 Tasks (Distribution)

### Integrations (Forge — Backend)
52. Build Toast POS integration (apply to marketplace first)
53. Build Square for Restaurants integration
54. Build Zapier integration (basic triggers/actions)

### Marketing (Manual + Atlas)
55. Set up email marketing (welcome sequence, onboarding drip)
56. Create content marketing calendar (kitchen ops tips)
57. Set up referral program (free month for referrals)
58. Apply to Toast App Marketplace

### Growth (Phoenix — Frontend)
59. Add in-app feedback widget
60. Add NPS survey at 30-day mark
61. Build referral system UI (share link, track referrals)

## Phase 5 Tasks (Scale)

### Multi-Unit (Forge + Phoenix)
62. Multi-location dashboard (compare locations, roll-up metrics)
63. Location groups and manager hierarchy
64. Template checklists that sync across locations
65. Centralized recipe management across locations

### Enterprise (Forge + Atlas)
66. SSO integration (Google Workspace, Okta)
67. API documentation (OpenAPI/Swagger)
68. Audit logging for all data changes
69. Custom SLA monitoring
70. SOC 2 preparation

---

## Key Metrics to Track

| Metric | Target (3 months) | Target (6 months) |
|--------|-------------------|-------------------|
| Paying locations | 10-20 | 50+ |
| MRR | $500-1,500 | $5,000+ |
| Daily active users | 50+ | 200+ |
| Checklist completion rate | 80%+ | 90%+ |
| Churn rate | <10%/month | <5%/month |
| NPS score | 30+ | 50+ |

---

## Go-to-Market Playbook

### First 10 Customers (Personal)
1. Get quantified case study from Honey Belly (hours saved, tasks tracked)
2. Ask Jun Kim for 3-5 introductions to other restaurant owners
3. Walk into 10 restaurants per week in your area with an iPad demo
4. Offer 30-day free pilot with white-glove onboarding
5. Join local restaurant association, attend their events

### 10-100 Customers (Systematic)
6. List on Toast App Marketplace
7. Launch content marketing (Instagram/TikTok kitchen ops tips)
8. Partner with local restaurant consultants
9. Attend regional restaurant trade shows
10. Build referral program (free month per referral)

### 100-1000 Customers (Scalable)
11. Hire 1-2 SDRs for outbound to multi-unit operators
12. National Restaurant Association Show booth
13. Channel partnerships (food service distributors, POS resellers)
14. Self-serve growth (product-led, frictionless onboarding)

---

## Budget Estimate (First 6 Months)

| Item | Cost |
|------|------|
| Railway hosting (backend + DB) | $50-100/mo |
| Vercel (frontend) | Free-$20/mo |
| Stripe fees (2.9% + $0.30) | ~3% of revenue |
| Sentry (error tracking) | Free tier initially |
| SendGrid (email) | Free tier initially |
| Legal (ToS, Privacy, review) | $2,000-3,000 one-time |
| Domain + SSL | $15-50/year |
| Business insurance | $500-1,500/year |
| Trademark search + filing | $500-1,000 |
| **Total first 6 months** | **~$4,000-6,000** |

Revenue target at 6 months: $5,000+/month MRR → profitable.
