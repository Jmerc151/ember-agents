---
name: ember-restaurant
description: >
  Domain knowledge for building restaurant kitchen management SaaS software (Ember).
  Use this skill whenever working on restaurant-related features: menus, recipes, checklists,
  prep lists, inventory, scheduling, sidework, 86 boards, temperature logs, waste tracking,
  staff management, or kitchen workflows. Also use when designing UI for kitchen/restaurant
  staff (mobile-first, touch-friendly, works with greasy hands in bright or dim lighting).
  Triggers on any restaurant, kitchen, food service, hospitality, or BOH/FOH terminology.
  If the task involves a restaurant SaaS product, this skill applies.
---

# Ember Restaurant — Domain Knowledge for Kitchen Management SaaS

This skill encodes deep restaurant industry knowledge for building kitchen management software. It covers data modeling, kitchen workflows, staff access patterns, and UX considerations specific to restaurant environments.

## Restaurant Operations Model

A restaurant's daily operation follows a predictable rhythm. Understanding this rhythm is essential for building software that fits into it rather than fighting against it.

### The Daily Cycle

```
5:00 AM   Manager arrives, reviews prep list
6:00 AM   Opening checklist begins (equipment on, stations set, mise en place)
7:00 AM   Prep cooks start working through prep par levels
10:30 AM  Pre-service meeting, 86 board review
11:00 AM  Service begins — tickets flow, temps logged, waste tracked
2:30 PM   Lunch service winds down, midday sidework
4:30 PM   Dinner prep, shift change
5:00 PM   Dinner service
10:00 PM  Closing checklist (equipment off, cleaning, food storage)
10:30 PM  Manager sign-off, daily review
```

Software should align with this cycle. Checklists appear at opening/closing time. Prep lists are morning-focused. The 86 board is most active during service. Temperature logs happen at regular intervals throughout the day.

### Core Kitchen Concepts

**Opening/Closing Checklists** — Sequential tasks that must be completed to start or end a shift. Each restaurant customizes these. Items are grouped by station or area (e.g., "Grill Station", "Walk-in Cooler", "Front of House"). Completion is tracked per-item with who did it and when. A manager typically signs off on the full checklist.

**Prep Lists** — Items that need to be prepared before service, with par levels (target quantities). A prep cook checks current stock, compares to par, and preps the difference. Organized by station or category. Par levels change by day of week (weekends need more).

**86 Board** — Real-time list of items that are sold out or unavailable. Critically time-sensitive — the moment something runs out, the entire team needs to know. Items are added during service and cleared at the start of next service. The name "86" is restaurant slang for "out of" or "remove."

**Sidework** — Non-cooking tasks assigned to staff: cleaning, restocking, organizing. Typically divided into sections and rotated among staff. Tracked daily.

**Temperature Logs** — Food safety requirement. Staff record temperatures of refrigeration units, hot-holding equipment, and food items at regular intervals. Must be within safe ranges (below 40°F for cold, above 140°F for hot). Health departments audit these.

**Waste Tracking** — Recording food that's thrown away, categorized by reason (spoiled, overcooked, dropped, expired, customer return). Used for cost control and identifying problems.

**Recipes** — Standardized instructions including ingredients with quantities, preparation steps, plating instructions, and allergen information. Stored as structured data (ingredients as arrays, steps as ordered lists). Often include photos.

**Plating Guides** — Visual references for how finished dishes should look. Include component placement, garnish, and portion references. Photo-heavy.

**Schedule** — Weekly staff schedules organized by day. Restaurant scheduling is complex because of split shifts, varying covers by day, and staff availability. Published by managers, viewed by all staff.

**Staff Notes / Kitchen Board** — Quick communications between shifts or from management. Tagged by urgency (callout, equipment issue, general, urgent). Replace physical whiteboards.

## Data Modeling Patterns

### Multi-Tenant Architecture

Every restaurant is a tenant. All data MUST be scoped by `restaurant_id`. This is non-negotiable — a query that doesn't filter by `restaurant_id` is a bug.

```sql
-- Every table follows this pattern
CREATE TABLE feature_items (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  -- ... feature-specific columns
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Every query filters by restaurant
SELECT * FROM feature_items WHERE restaurant_id = $1;
```

### Template + Log Pattern

Most kitchen features follow a two-layer pattern:

1. **Templates** — The structure/configuration (created by managers, rarely changes)
2. **Logs** — Daily instances of completing the template (created by staff, daily)

```
Templates (static)              Logs (daily)
┌─────────────────┐            ┌──────────────────┐
│ checklist_       │            │ checklist_logs    │
│ templates        │───────────│   log_date        │
│   name, type     │           │   manager_name    │
│   sort_order     │           │   pct_complete    │
│                  │           │   completed_items  │
│ checklist_       │           │                    │
│ template_items   │           │ checklist_item_    │
│   label, station │           │ completions       │
│                  │           │   completed_by     │
└─────────────────┘            │   completed_at     │
                               └──────────────────┘
```

This pattern repeats for: checklists, prep lists, sidework, temperature monitoring.

### Section → Item Hierarchy

Restaurant data is naturally hierarchical. Most features organize into sections containing items:

```
Section: "Grill Station"
  ├── Item: "Clean grill grates"
  ├── Item: "Check propane level"
  └── Item: "Verify meat temps"

Section: "Walk-in Cooler"
  ├── Item: "Check temperature"
  ├── Item: "Rotate stock (FIFO)"
  └── Item: "Clean shelves"
```

Model this with two tables and nest items under sections in API responses:

```javascript
// Controller pattern: fetch sections, nest items
const sections = await pool.query('SELECT * FROM sections WHERE restaurant_id = $1 ORDER BY sort_order', [restaurantId])
const items = await pool.query('SELECT * FROM items WHERE restaurant_id = $1 ORDER BY sort_order', [restaurantId])

const result = sections.rows.map(section => ({
  ...section,
  items: items.rows.filter(item => item.section_id === section.id)
}))
```

### JSONB for Flexible Structures

Use JSONB columns for data that varies significantly between restaurants or has complex nested structure:

- `recipes.ingredients` — Array of `{name, quantity, unit, notes}`
- `recipes.steps` — Array of `{order, instruction, duration_minutes}`
- `schedules.day_assignments` — Object keyed by day with staff arrays
- `posts.reactions` — Object for emoji reactions

Don't use JSONB for data you need to query/filter on. Use regular columns for those.

### Daily Log Upsert Pattern

Staff actions are tracked per-day. Use upsert (ON CONFLICT) to handle the "check/uncheck" pattern:

```sql
-- Mark item complete
INSERT INTO completions (restaurant_id, type, log_date, item_id, completed_by, completed_at)
VALUES ($1, $2, $3, $4, $5, NOW())
ON CONFLICT (restaurant_id, type, log_date, item_id) DO UPDATE
SET completed_by = $5, completed_at = NOW();

-- Uncheck item
DELETE FROM completions
WHERE restaurant_id = $1 AND type = $2 AND log_date = $3 AND item_id = $4;
```

## Staff Access Patterns

### Two-Tier Access

Restaurants have a clear hierarchy that maps to two access levels:

**Managers** — Full CRUD access. Can edit templates, view analytics, manage staff, configure features. Authenticated with email + password. JWT expires in 7 days.

**Staff** — Read-only on templates + write on daily logs. Can view recipes, complete checklists, add notes. Don't need individual accounts — they access via share link.

### Share Link Pattern

Staff shouldn't need to create accounts. They access the "Kitchen Bible" (read-only reference + daily checklists) via a share link:

```
https://app.example.com/join/HONEYBELLY
```

Flow:
1. Staff opens share link on their phone
2. Enters their name (no password, no email)
3. Gets a JWT with `{ restaurant_id, role: 'staff', name }` (30-day expiry)
4. Can view Kitchen Bible tabs and complete daily tasks

The share code is a human-readable identifier per restaurant (e.g., restaurant name in caps). This is intentionally low-friction — kitchen staff have high turnover, limited tech comfort, and need instant access.

### Feature Flags

Not every restaurant needs every feature. Use an `enabled_features` array on the restaurant record:

```javascript
// Restaurant record
{ id: 1, name: "Honey Belly", enabled_features: ["opening", "closing", "sidework", "notes"] }

// Filter UI based on features
const tabs = ALL_TABS.filter(tab => restaurant.enabled_features.includes(tab.id))
```

This lets you onboard restaurants gradually and customize the experience per customer.

## Kitchen-First UX Design

### The Kitchen Environment

Design for these realities:
- **Greasy/wet hands** — Large touch targets (minimum 48px, prefer 56px+). No hover states that matter. No small checkboxes.
- **Bright overhead lighting + screen glare** — High contrast. Dark backgrounds with light text work well in kitchens. Avoid subtle grays.
- **Noise** — No audio cues. Visual feedback only (color changes, checkmarks, animations).
- **Speed** — Staff are in a rush during service. Minimize taps to complete actions. One tap to check off an item.
- **Shared devices** — Multiple people may use the same phone/tablet. Keep the UI stateless where possible.
- **Messy pockets** — Phones get pulled out and shoved back constantly. The app should resume exactly where they left it.

### Mobile-First Patterns

The Kitchen Bible is primarily used on phones. Design mobile-first:

```
┌─────────────────────┐
│  🔥 Kitchen Bible    │
│  ─────────────────── │
│                      │
│  ☐ Clean grill       │  ← Big tap targets
│    ── Alex, 8:02am   │  ← Who completed it
│                      │
│  ☐ Check walk-in     │
│                      │
│  ☑ Stock line        │  ← Clear completion state
│    ── Maria, 7:45am  │
│                      │
│  ────────────────── │
│  ┌──┐┌──┐┌──┐┌──┐  │  ← Bottom tab bar
│  │📋││📝││🌡️││📊│  │    (thumb-reachable)
│  └──┘└──┘└──┘└──┘  │
└─────────────────────┘
```

Key patterns:
- **Bottom navigation** — Tabs at the bottom for thumb reach
- **Optimistic updates** — Check off items instantly, sync in background. Roll back on error.
- **Pull to refresh** — Natural gesture for "what's new"
- **Completion attribution** — Show who completed each item and when (builds accountability)

### Color System for Kitchen

Use a color system that communicates status clearly in kitchen lighting:

- **Green** — Complete, safe, good
- **Red** — Urgent, out of range, 86'd
- **Orange/Gold** — Warning, attention needed
- **Neutral dark** — Background (reduces eye strain)
- **Cream/off-white** — Text (easier to read than pure white)

Avoid blue for status — it doesn't register as "urgent" in a kitchen context.

### Manager Dashboard vs Staff View

Two completely different experiences:

**Manager Dashboard** — Desktop-first, data-dense, CRUD-heavy
- Card grid for feature areas
- Admin forms for template editing
- Analytics and completion tracking
- Settings and configuration

**Staff Kitchen Bible** — Mobile-first, read-optimized, action-minimal
- Tabbed interface for different reference areas
- Checklists with one-tap completion
- Read-only recipes and plating guides
- Daily notes and 86 board

## API Design Patterns

### RESTful Resource Routes

Follow this consistent pattern for all features:

```
GET    /api/feature              → List all (filtered by restaurant_id from JWT)
GET    /api/feature/:id          → Get one
POST   /api/feature              → Create
PUT    /api/feature/:id          → Update
DELETE /api/feature/:id          → Delete

# For section→item hierarchies:
GET    /api/feature/templates              → Get all sections with nested items
POST   /api/feature/templates              → Create section
POST   /api/feature/templates/:id/items    → Add item to section
PUT    /api/feature/templates/items/:id    → Update item
DELETE /api/feature/templates/items/:id    → Delete item
DELETE /api/feature/templates/:id          → Delete section (cascade items)

# For daily logs:
GET    /api/feature/logs/:date   → Get log for date
PUT    /api/feature/logs         → Upsert log entry
```

### Auth Middleware Pattern

Every route (except auth) should be protected:

```javascript
const router = express.Router()
router.use(authMiddleware) // Verify JWT, set req.restaurantId

// All routes below automatically scoped to restaurant
router.get('/', controller.list)
```

### Response Patterns

```javascript
// Success with data
res.json(data)                    // 200
res.status(201).json(created)     // 201 for POST

// Errors
res.status(400).json({ error: 'Missing required field: name' })
res.status(401).json({ error: 'Authentication required' })
res.status(403).json({ error: 'Manager access required' })
res.status(404).json({ error: 'Item not found' })
res.status(500).json({ error: 'Server error' })
```

## Common Feature Requests

When building new restaurant features, these are the typical asks:

1. **Inventory tracking** — Par levels, order guides, vendor management, cost tracking
2. **Menu costing** — Recipe costs rolled up to menu prices, food cost percentage
3. **Labor scheduling** — Shift management, availability, labor cost forecasting
4. **Health inspection readiness** — HACCP logs, cleaning schedules, inspection checklists
5. **Training modules** — Onboarding checklists, recipe quizzes, certification tracking
6. **Multi-location support** — Restaurant groups sharing templates across locations
7. **Analytics dashboard** — Completion rates, waste trends, labor vs revenue
8. **POS integration** — Sync menu items, pull sales data for prep forecasting
9. **Vendor ordering** — Generate orders from prep pars, email to suppliers
10. **Customer feedback routing** — Connect reviews to kitchen actions

When implementing any of these, always start with the template + log pattern and the section → item hierarchy. They apply to almost everything in restaurant ops.
