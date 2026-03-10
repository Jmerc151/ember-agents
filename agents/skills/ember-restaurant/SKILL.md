---
name: ember-restaurant
description: >
  Domain knowledge for building Ember, a restaurant kitchen management SaaS.
  Use this skill whenever working on restaurant-related features: menus, recipes, checklists,
  prep lists, inventory, scheduling, sidework, 86 boards, temperature logs, waste tracking,
  staff management, or kitchen workflows. Also use when designing UI for kitchen/restaurant
  staff (mobile-first, touch-friendly, works with greasy hands in bright or dim lighting).
  Triggers on any restaurant, kitchen, food service, hospitality, or BOH/FOH terminology.
  If the task involves a restaurant SaaS product, this skill applies. Use it proactively
  even if the user doesn't explicitly say "restaurant" — if they mention prep, par levels,
  86ing, plating, opening/closing procedures, health inspection, or Kitchen Bible, this skill
  is relevant.
---

# Ember Restaurant — Domain Knowledge for Kitchen Management SaaS

Ember is a restaurant kitchen management SaaS. Managers configure features on a web dashboard; kitchen staff access a "Kitchen Bible" (mobile-first reference + daily checklists) via share link. No app install needed — it's a PWA.

## Architecture Overview

- **Frontend:** React 19 + Vite, deployed to Vercel
- **Backend:** Express.js + PostgreSQL, deployed to Railway
- **Auth:** JWT-based, two-tier (manager accounts + staff share links)
- **Multi-tenant:** Every query scoped by `restaurant_id` from JWT
- **Design:** Warm premium aesthetic — cream backgrounds, forest green primary, gold accents

---

## Restaurant Operations Model

### The Daily Cycle

```
5:00 AM   Manager arrives, reviews prep list
6:00 AM   Opening checklist begins (equipment on, stations set, mise en place)
7:00 AM   Prep cooks work through par levels
10:30 AM  Pre-service meeting, 86 board review
11:00 AM  Service — tickets flow, temps logged, waste tracked
2:30 PM   Lunch winds down, midday sidework
4:30 PM   Dinner prep, shift change
5:00 PM   Dinner service
10:00 PM  Closing checklist (equipment off, cleaning, food storage)
10:30 PM  Manager sign-off, daily review
```

Software should align with this cycle. Checklists appear at opening/closing. Prep lists are morning-focused. The 86 board is most active during service. Temperature logs happen at regular intervals.

### Core Kitchen Concepts

**Opening/Closing Checklists** — Sequential tasks that must be completed to start or end a shift. Grouped by station (e.g., "Grill Station", "Walk-in Cooler"). Tracked per-item with who completed it and when. Manager signs off on the full checklist.

**Prep Lists** — Items to prepare before service with par levels (target quantities). Organized by station. Par levels change by day of week (weekends need more).

**86 Board** — Real-time list of sold-out items. Critically time-sensitive. "86" is restaurant slang for "out of" or "remove." Items added during service, cleared at start of next service.

**Sidework** — Non-cooking tasks: cleaning, restocking, organizing. Divided into sections, rotated among staff, tracked daily.

**Temperature Logs** — Food safety requirement. Record temps of coolers, hot-holding, food items at intervals. Must be within safe ranges (below 40°F cold, above 140°F hot). Health departments audit these.

**Waste Tracking** — Recording food thrown away by reason (spoiled, overcooked, dropped, expired). Used for cost control.

**Recipes** — Standardized instructions: ingredients array, steps array, storage info, yield, notes. Often include photos.

**Plating Guides** — Visual references for finished dishes. Component placement, garnish, portions. Photo-heavy.

**Schedule** — Weekly staff schedules by day. Complex due to split shifts and varying covers.

**Staff Notes / Kitchen Board** — Quick shift-to-shift communications. Tagged by urgency (callout, equipment, general, urgent).

**Team Chat** — In-app messaging with reactions, replies, pinning. Manager-only moderation.

---

## Data Modeling Patterns

### Multi-Tenant Architecture

Every restaurant is a tenant. All data MUST be scoped by `restaurant_id`. A query without `restaurant_id` filtering is a bug. Two-layer isolation:

1. **JWT layer:** Token contains `restaurant_id`, extracted by auth middleware into `req.restaurantId`
2. **Query layer:** Every SQL WHERE clause includes `AND restaurant_id = $N`

```sql
CREATE TABLE feature_items (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- feature-specific columns
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Template + Log Pattern

Most kitchen features follow a two-layer pattern:

1. **Templates** — Structure/configuration (created by managers, rarely changes)
2. **Logs** — Daily instances of completing the template (created by staff, daily)

This pattern repeats for: checklists, prep lists, sidework, temperature monitoring.

### Section → Item Hierarchy

Restaurant data is naturally hierarchical — sections containing items:

```
Section: "Grill Station"
  ├── Item: "Clean grill grates"
  ├── Item: "Check propane level"
  └── Item: "Verify meat temps"
```

Model with two tables. Nest items under sections in API responses:

```javascript
const sections = await pool.query(
  'SELECT * FROM sections WHERE restaurant_id = $1 ORDER BY sort_order', [restaurantId]
)
const items = await pool.query(
  'SELECT * FROM items WHERE restaurant_id = $1 ORDER BY sort_order', [restaurantId]
)
const result = sections.rows.map(section => ({
  ...section,
  items: items.rows.filter(item => item.section_id === section.id)
}))
```

### JSONB for Flexible Structures

Use JSONB for data that varies between restaurants or has complex nested structure:
- `recipes.ingredients` — Array of strings or `{name, quantity, unit}`
- `recipes.steps` — Array of strings (ordered instructions)
- `plating_guides.components` — Array of component strings
- `schedules.day_assignments` — Object keyed by day with staff arrays
- `posts.reactions` — Object for emoji reactions
- `temperature_logs.readings` — Object of `{unit_name: temp_value}`

Don't use JSONB for data you need to query/filter on — use regular columns.

### Daily Log Upsert Pattern

Staff actions are tracked per-day. Use upsert (ON CONFLICT) for check/uncheck:

```sql
INSERT INTO completions (restaurant_id, type, log_date, item_id, completed_by)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (restaurant_id, type, log_date, item_id)
DO UPDATE SET completed_by = $5, completed_at = NOW();
```

Unique constraint: `(restaurant_id, type, log_date, item_id)` prevents duplicate entries.

### Database Schema Reference

Read `references/schema.md` for the complete PostgreSQL schema covering all tables.

---

## Staff Access Patterns

### Two-Tier Access

**Managers** — Full CRUD. Edit templates, view analytics, manage staff, configure features. Email + password auth. JWT expires in 7 days.

**Staff** — Read templates + write daily logs. View recipes, complete checklists, add notes. Access via share link — no account needed.

### Share Link Pattern

Staff access the Kitchen Bible via a share link with a human-readable code:

```
https://app.example.com/join/HONEYBELLY
```

Flow:
1. Staff opens link on phone
2. Enters their name (no password, no email)
3. Gets JWT with `{ restaurant_id, role: 'staff', name }` (30-day expiry)
4. Can view Kitchen Bible tabs and complete daily tasks

This is intentionally low-friction — kitchen staff have high turnover, limited tech comfort, and need instant access. The share code is typically the restaurant name in caps.

### Feature Flags

Not every restaurant needs every feature. Use `enabled_features` array on the restaurant record:

```javascript
{ id: 1, name: "Honey Belly", enabled_features: ["opening", "closing", "sidework", "notes"] }

// null means all features enabled
const visibleTabs = restaurant.enabled_features
  ? ALL_TABS.filter(t => restaurant.enabled_features.includes(t.id))
  : ALL_TABS
```

### Auth Implementation

```javascript
// middleware/auth.js — sets req.restaurantId on every request
const decoded = jwt.verify(token, JWT_SECRET)
req.user = decoded
req.restaurantId = decoded.restaurant_id
req.userRole = decoded.role || 'manager'
req.userName = decoded.name || decoded.email

// middleware/roleCheck.js — manager-only routes
function requireManager(req, res, next) {
  if (req.userRole !== 'manager') return res.status(403).json({ error: 'Manager access required' })
  next()
}
```

---

## Kitchen-First UX Design

### The Kitchen Environment

Design for these realities:
- **Greasy/wet hands** — Large touch targets (minimum 48px, prefer 56px+). No hover states that matter. No small checkboxes.
- **Bright overhead lighting + screen glare** — High contrast. Warm dark backgrounds with light text. Avoid subtle grays.
- **Noise** — No audio cues. Visual feedback only (color changes, checkmarks, animations).
- **Speed** — Staff are in a rush during service. Minimize taps. One tap to check off an item.
- **Shared devices** — Multiple people may use the same phone/tablet. Keep UI stateless where possible.
- **Messy pockets** — Phones get pulled out and shoved back. App should resume exactly where they left it.

### Design Token System

Ember uses a warm, premium aesthetic with these design tokens:

```javascript
// Colors
bg0: '#F7F4EF'   // Lightest cream background
bg1: '#F2EDE6'   // Card hover
bg2: '#EDE7DF'   // Input backgrounds
bg3: '#E8E2D9'   // Borders, separators
bg4: '#E4DFD7'   // Disabled states

g0: '#0B2416'    // Deepest forest green (text on light)
g1: '#1C3424'    // Primary buttons, dark panels
g2: '#2D5234'    // Active states
g3: '#3D7A52'    // Success accents
g4: '#3D9968'    // Checkmarks, positive indicators
g5: '#4DAA78'    // Lightest green

gold: '#B8922A'       // Primary accent (active tab, progress bars)
goldDim: '#9A7B24'    // Secondary gold
goldFaint: '#C8A84020' // Gold at 12% opacity

cream: '#F7F4EF'      // Primary text on dark backgrounds
t1: '#1A1C1A'         // Primary text
t2: '#5A6258'         // Secondary text
t3: '#8A948E'         // Tertiary text
t4: '#A8B0AC'         // Disabled text

red: '#C0392B'        // 86'd items, errors, waste
teal: '#1A7A6E'       // Info callouts, status badges
border: '#E8E2D920'   // Subtle borders (12% opacity)
```

```javascript
// Style objects
S.card = { background: '#FFFFFF', border: '1px solid rgba(232,226,217,0.5)', borderRadius: 16 }
S.mono = { fontFamily: "'JetBrains Mono', monospace" }  // Numbers, data
S.serif = { fontFamily: "'Cormorant Garamond', serif" }  // Display headings
```

### Key UI Components

- **Header** — Sticky top bar with blur backdrop, title/subtitle, optional back button and right actions
- **NavBar** — Bottom fixed tab bar with emoji icons, gold underline on active tab, gradient background
- **Row** — Flexible list item (primary/secondary text, left/right slots, onPress handler)
- **Badge** — Status pills in variants: default, gold, green, red, teal
- **Label** — Uppercase monospace labels, gold by default
- **Search** — Magnifying glass icon + input field
- **SectionHead** — Section divider with label and optional right content
- **Avatar** — Deterministic color from name hash, 5-color palette

### Color Semantics for Kitchen

- **Green** — Complete, safe, good (checklist done, temp in range)
- **Red** — Urgent, out of range, 86'd (waste, danger zone temps)
- **Gold** — In progress, attention needed (partial completion, active)
- **Cream/neutral** — Background, default state
- **Teal** — Informational callouts, tips

### Manager Dashboard vs Staff Kitchen Bible

**Manager Dashboard** — Desktop-optimized, data-dense:
- Card grid for feature areas
- Admin pages for CRUD (recipes, plating, temps, checklists, prep, sidework, orders, events, ops)
- Analytics and completion tracking

**Staff Kitchen Bible** — Mobile-first, action-minimal:
- Tabbed interface (bottom nav) with emoji-labeled tabs
- One-tap checklist completion with attribution (who + when)
- Read-only recipes and plating guides
- Real-time 86 board and team chat
- Feature-flagged to show only relevant tabs

### Component Pattern for Tabs

```jsx
export default function FeatureTab() {
  const { user, restaurant } = useAuth()
  const { data, loading, error } = useApiData('/endpoint')
  const [localState, setLocalState] = useState({})

  if (loading) return <ChecklistSkeleton />  // or <SkeletonCard /> for card-based content
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />

  // Derived values
  const progress = calculateProgress(data)

  // Optimistic update handlers
  const handleToggle = async (itemId) => {
    setLocalState(prev => ({ ...prev, [itemId]: !prev[itemId] }))  // Instant UI update
    try {
      await api.post('/endpoint', { itemId })
    } catch {
      setLocalState(prev => ({ ...prev, [itemId]: !prev[itemId] }))  // Revert on error
    }
  }

  return (
    <div>
      <Header title="Feature" subtitle={today} />
      {/* Progress bar, sections, items */}
    </div>
  )
}
```

### Checklist UX Pattern

Checklists are the heart of the app. The interaction pattern:

1. **Section headers** — Collapsible, show icon + name + completion count (e.g., "3/5")
2. **Items** — Full-width tap targets with 24px checkboxes (rounded corners)
3. **Checked state** — Green tint background, strikethrough text, shows "Alex, 8:02am"
4. **Progress** — Large percentage display + gradient progress bar (gold→green at 100%)
5. **Sign-off** — Manager-only button appears at 100%, records sign-off with manager name

---

## API Design Patterns

### RESTful Routes

```
GET    /api/feature              → List all (scoped by restaurant_id from JWT)
GET    /api/feature/:id          → Get one
POST   /api/feature              → Create
PUT    /api/feature/:id          → Update
DELETE /api/feature/:id          → Delete

# Section → Item hierarchies:
GET    /api/feature/templates              → Sections with nested items
POST   /api/feature/templates              → Create section
POST   /api/feature/templates/:id/items    → Add item to section
PUT    /api/feature/templates/items/:id    → Update item
DELETE /api/feature/templates/items/:id    → Delete item

# Daily logs:
GET    /api/feature/completions/:type/:date → Get completions for date
POST   /api/feature/completions             → Complete item
DELETE /api/feature/completions/:type/:date/:itemId → Uncomplete item

GET    /api/feature/logs/:type     → Historical sign-offs
POST   /api/feature/logs           → Create sign-off
```

### Controller Pattern

```javascript
const pool = require('../config/database')

exports.list = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM items WHERE restaurant_id = $1 ORDER BY sort_order',
      [req.restaurantId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
}
```

### Error Handling

Custom error classes for structured responses:

```javascript
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
  }
}
class ValidationError extends AppError { constructor(msg) { super(msg, 400) } }
class NotFoundError extends AppError { constructor(resource) { super(`${resource} not found`, 404) } }
```

### Restaurant-Scoped DB Helper

For defense-in-depth, use the RestaurantScopedDB helper that auto-appends restaurant_id:

```javascript
const RestaurantScopedDB = require('../utils/dbHelper')

// Automatically scopes all queries by restaurant_id
const items = await RestaurantScopedDB.findAll('recipes', req.restaurantId, { orderBy: 'sort_order' })
const item = await RestaurantScopedDB.findById('recipes', id, req.restaurantId)
const created = await RestaurantScopedDB.create('recipes', data, req.restaurantId)
```

---

## Common Feature Requests

When building new restaurant features, these are typical asks. Always start with the template + log pattern and section → item hierarchy — they apply to almost everything:

1. **Inventory tracking** — Par levels, order guides, vendor management
2. **Menu costing** — Recipe costs rolled up to menu prices, food cost %
3. **Labor scheduling** — Shift management, availability, labor cost forecasting
4. **Health inspection readiness** — HACCP logs, cleaning schedules
5. **Training modules** — Onboarding checklists, certification tracking
6. **Multi-location** — Restaurant groups sharing templates across locations
7. **Analytics** — Completion rates, waste trends, labor vs revenue
8. **POS integration** — Sync menu items, pull sales for prep forecasting
9. **Vendor ordering** — Generate orders from prep pars, email to suppliers

---

## Onboarding Flow

New restaurants go through a wizard after signup:

1. **Choose features** — Toggle grid of Kitchen Bible features to enable
2. **Create first checklist** — Opening checklist with custom items
3. **Invite staff** — Copy share link (e.g., `/join/RESTAURANTNAME`)

This gets them to value quickly — the share link lets their staff start using the Kitchen Bible immediately.
