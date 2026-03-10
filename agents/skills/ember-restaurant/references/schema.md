# Ember Database Schema Reference

Complete PostgreSQL schema for the Ember restaurant management platform.

## Core Tables

### restaurants
```sql
CREATE TABLE restaurants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  share_code VARCHAR(50) UNIQUE,
  enabled_features JSONB,  -- ["opening","closing","sidework","notes"] or null for all
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### staff_users
```sql
CREATE TABLE staff_users (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  pin_hash VARCHAR(255),
  role VARCHAR(20) DEFAULT 'cook',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Checklists (Opening/Closing)

### checklist_templates (sections)
```sql
CREATE TABLE checklist_templates (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,  -- 'opening' | 'closing'
  section_name VARCHAR(255) NOT NULL,
  icon VARCHAR(10),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### checklist_template_items
```sql
CREATE TABLE checklist_template_items (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  task VARCHAR(255) NOT NULL,
  standard TEXT,
  sort_order INTEGER DEFAULT 0
);
```

### checklist_item_completions
```sql
CREATE TABLE checklist_item_completions (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  checklist_type VARCHAR(20) NOT NULL,
  log_date DATE NOT NULL,
  template_item_id INTEGER NOT NULL REFERENCES checklist_template_items(id) ON DELETE CASCADE,
  completed_by VARCHAR(255),
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (restaurant_id, checklist_type, log_date, template_item_id)
);
```

### checklist_logs (sign-offs)
```sql
CREATE TABLE checklist_logs (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  log_date DATE NOT NULL,
  manager_name VARCHAR(255),
  pct INTEGER,
  completed INTEGER,
  total INTEGER,
  signed_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Recipes

### recipes
```sql
CREATE TABLE recipes (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  storage VARCHAR(100),
  icon VARCHAR(10),
  yield VARCHAR(100),
  note TEXT,
  ingredients JSONB DEFAULT '[]',  -- Array of strings
  steps JSONB DEFAULT '[]',        -- Array of strings
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Plating Guides

### plating_guides
```sql
CREATE TABLE plating_guides (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  price VARCHAR(50),
  components JSONB DEFAULT '[]',     -- Array of component strings
  plating TEXT,                      -- Plating instructions
  photo_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Prep Lists

### prep_sections
```sql
CREATE TABLE prep_sections (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section_name VARCHAR(255) NOT NULL,
  sort_order INTEGER DEFAULT 0
);
```

### prep_items
```sql
CREATE TABLE prep_items (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES prep_sections(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(50),
  par NUMERIC,
  sort_order INTEGER DEFAULT 0
);
```

### prep_logs
```sql
CREATE TABLE prep_logs (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  amount NUMERIC,
  checked BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (restaurant_id, log_date, item_name)
);
```

## Sidework

### sidework_sections
```sql
CREATE TABLE sidework_sections (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section_name VARCHAR(255) NOT NULL,
  icon VARCHAR(10),
  sort_order INTEGER DEFAULT 0
);
```

### sidework_items
```sql
CREATE TABLE sidework_items (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sidework_sections(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  task VARCHAR(255) NOT NULL,
  sort_order INTEGER DEFAULT 0
);
```

### sidework_logs
```sql
CREATE TABLE sidework_logs (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  task_key VARCHAR(255) NOT NULL,
  checked BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (restaurant_id, log_date, task_key)
);
```

## Temperature Logs

### temp_units
```sql
CREATE TABLE temp_units (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(10),
  safe_range VARCHAR(50),  -- e.g., "32-40°F"
  sort_order INTEGER DEFAULT 0
);
```

### temperature_logs
```sql
CREATE TABLE temperature_logs (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  readings JSONB NOT NULL,  -- Array of {unit_name, temp_value}
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 86 Board

### eightysix_items
```sql
CREATE TABLE eightysix_items (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  added_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Waste Tracking

### waste_logs
```sql
CREATE TABLE waste_logs (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item VARCHAR(255) NOT NULL,
  qty VARCHAR(50),
  reason VARCHAR(20) CHECK (reason IN ('spoiled','overcooked','dropped','expired','other')),
  log_date DATE,
  log_time TIME,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Staff Notes

### staff_notes
```sql
CREATE TABLE staff_notes (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tag VARCHAR(20) CHECK (tag IN ('callout','equipment','general','urgent')),
  note_date DATE,
  note_time TIME,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Team Chat

### posts
```sql
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  author VARCHAR(255),
  role VARCHAR(20),
  pinned BOOLEAN DEFAULT false,
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### post_replies
```sql
CREATE TABLE post_replies (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  author VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Schedules

### schedules
```sql
CREATE TABLE schedules (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  day_assignments JSONB DEFAULT '{}',
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  UNIQUE (restaurant_id, week_start_date)
);
```

## Events & Ops

### events
```sql
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255),
  event_type VARCHAR(50),  -- 'live-music', 'trivia', 'private', etc.
  event_date DATE,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ops_blocks
```sql
CREATE TABLE ops_blocks (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  block_name VARCHAR(255),
  time_range VARCHAR(100),
  sort_order INTEGER DEFAULT 0
);
```

### ops_tasks
```sql
CREATE TABLE ops_tasks (
  id SERIAL PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES ops_blocks(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  task VARCHAR(255),
  sort_order INTEGER DEFAULT 0
);
```

## Orders Config

### order_sections
```sql
CREATE TABLE order_sections (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section_name VARCHAR(255),
  sort_order INTEGER DEFAULT 0
);
```

### order_items
```sql
CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES order_sections(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name VARCHAR(255),
  par NUMERIC,
  pack VARCHAR(50),
  unit VARCHAR(50),
  sort_order INTEGER DEFAULT 0
);
```

## API Endpoints Reference

```
POST   /api/auth/signup                    → Create restaurant + manager account
POST   /api/auth/login                     → Manager login
POST   /api/auth/staff-access/:code        → Staff share link access

GET    /api/checklists/templates/:type     → Opening/closing template sections
GET    /api/checklists/completions/:type/:date → Per-item completions
POST   /api/checklists/completions         → Complete item
DELETE /api/checklists/completions/:type/:date/:itemId → Uncomplete
POST   /api/checklists/logs                → Manager sign-off

GET    /api/recipes                        → All recipes
GET    /api/plating                        → All plating guides
GET    /api/prep/templates                 → Prep sections + items
GET    /api/sidework/templates             → Sidework sections + items
GET    /api/temps/units                    → Temperature units
GET    /api/temps/logs                     → Temperature log history
POST   /api/temps/logs                     → Record temperatures
GET    /api/orders-config                  → Order guide config
GET    /api/eightysix                      → Current 86'd items
POST   /api/eightysix                      → 86 an item
DELETE /api/eightysix/:id                  → Un-86 an item
GET    /api/waste                          → Waste log history
POST   /api/waste                          → Log waste
GET    /api/posts                          → Team chat posts
POST   /api/posts                          → Create post
GET    /api/staff-notes                    → Staff notes
POST   /api/staff-notes                    → Create note
GET    /api/schedules                      → Staff schedules
GET    /api/events                         → Events
GET    /api/ops                            → Ops blocks + tasks
```
