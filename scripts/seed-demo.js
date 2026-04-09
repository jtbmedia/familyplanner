/**
 * Demo Seed Script - Oikos
 * Fills the database with realistic English demo content for screenshots/mockups.
 * Usage: node scripts/seed-demo.js [--db /path/to/oikos.db]
 *
 * Creates:
 *   - 2 users (admin: alex / member: sam)
 *   - Tasks (varied priorities, statuses, due dates)
 *   - Calendar events (appointments, activities, recurring)
 *   - Meals (full week, all slots)
 *   - Contacts (family, medical, school, services)
 *   - Budget entries (income + expenses, current month)
 *   - Notes (pinned + regular)
 *   - Shopping list with items
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dbIdx = args.indexOf('--db');
const DB_PATH = dbIdx !== -1 ? args[dbIdx + 1] : resolve(__dirname, '..', 'data', 'oikos.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateTimeFromNow(days, hour, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString().slice(0, 16);
}

function thisMonthDate(day) {
  const d = new Date();
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

function lastMonthDate(day) {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

// ── Wipe existing demo data ──────────────────────────────────────────────────

console.log('Clearing existing data…');
db.prepare('DELETE FROM shopping_items').run();
db.prepare('DELETE FROM shopping_lists').run();
db.prepare('DELETE FROM budget_entries').run();
db.prepare('DELETE FROM contacts').run();
db.prepare('DELETE FROM notes').run();
db.prepare('DELETE FROM meal_ingredients').run();
db.prepare('DELETE FROM meals').run();
db.prepare('DELETE FROM calendar_events').run();
db.prepare('DELETE FROM tasks').run();
db.prepare('DELETE FROM users').run();
db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users','tasks','calendar_events','meals','contacts','notes','budget_entries','shopping_lists','shopping_items')").run();

// ── Users ────────────────────────────────────────────────────────────────────

console.log('Creating users…');
const pw = bcrypt.hashSync('demo1234', 12);

const insertUser = db.prepare(`
  INSERT INTO users (username, display_name, password_hash, role, avatar_color)
  VALUES (?, ?, ?, ?, ?)
`);

const alexId = insertUser.run('alex', 'Alex Johnson', pw, 'admin', '#2563EB').lastInsertRowid;
const samId  = insertUser.run('sam',  'Sam Johnson',  pw, 'member', '#16A34A').lastInsertRowid;

console.log(`  alex (id=${alexId}), sam (id=${samId})`);

// ── Tasks ────────────────────────────────────────────────────────────────────

console.log('Inserting tasks…');
const insertTask = db.prepare(`
  INSERT INTO tasks (title, description, category, priority, status, due_date, assigned_to, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

[
  ['Book dentist appointment',     'Annual check-up for the whole family',  'health',    'high',   'open',      daysFromNow(3),   alexId, alexId],
  ['Pay electricity bill',         'Due end of month - online banking',     'finance',   'urgent', 'open',      daysFromNow(2),   alexId, alexId],
  ['Renew car insurance',          'Compare quotes on check24.de first',    'finance',   'high',   'open',      daysFromNow(10),  alexId, alexId],
  ['Fix leaking bathroom faucet',  'Replace washer, tools in basement',     'home',      'medium', 'open',      daysFromNow(7),   samId,  alexId],
  ['Order birthday cake',          "Emma's 8th birthday - chocolate cake",  'family',    'high',   'open',      daysFromNow(5),   samId,  samId ],
  ['Clean out garage',             'Donate old stuff to charity',           'home',      'low',    'open',      daysFromNow(14),  alexId, alexId],
  ['Sign school permission slip',  'Field trip to the science museum',      'school',    'urgent', 'open',      daysFromNow(1),   samId,  samId ],
  ['Renew library cards',          'All three cards expired last month',    'admin',     'low',    'open',      daysFromNow(20),  alexId, alexId],
  ['Plan summer holiday',          'Italy or Croatia - check flights',      'family',    'medium', 'open',      daysFromNow(30),  alexId, alexId],
  ['Tax return 2025',              'Documents ready in the folder',         'finance',   'high',   'open',      daysFromNow(18),  alexId, alexId],
  ['Grocery run',                  'See shopping list for details',         'home',      'medium', 'done',      daysFromNow(-1),  samId,  samId ],
  ['Call insurance about claim',   'Reference: CLM-2025-0492',             'finance',   'high',   'done',      daysFromNow(-3),  alexId, alexId],
  ['Oil change - VW Golf',         'Every 15 000 km / 12 months',          'home',      'medium', 'open',      daysFromNow(6),   alexId, alexId],
  ['Buy birthday gift for Mum',    'Amazon wishlist or book voucher',       'family',    'medium', 'open',      daysFromNow(8),   samId,  samId ],
  ['Update home inventory',        'For insurance purposes',                'admin',     'low',    'open',      daysFromNow(25),  alexId, alexId],
].forEach(row => insertTask.run(...row));

// ── Calendar Events ──────────────────────────────────────────────────────────

console.log('Inserting calendar events…');
const insertEvent = db.prepare(`
  INSERT INTO calendar_events (title, description, start_datetime, end_datetime, all_day, location, color, assigned_to, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

[
  ["Emma's Birthday Party",     'Bouncy castle & cake at home',                     daysFromNow(5)  + 'T14:00', daysFromNow(5)  + 'T17:00', 0, 'Home',                       '#F59E0B', samId,  samId ],
  ['Dentist - Family',          'Dr. Müller, bring insurance cards',                daysFromNow(3)  + 'T10:00', daysFromNow(3)  + 'T11:30', 0, 'Dental Practice Müller',    '#EF4444', alexId, alexId],
  ['Parent-Teacher Evening',    'Room 12, bring report card',                       daysFromNow(9)  + 'T18:30', daysFromNow(9)  + 'T20:00', 0, 'Westpark Primary School',   '#8B5CF6', samId,  samId ],
  ['Science Museum Field Trip', 'Emma - permission slip signed',                    daysFromNow(1)  + 'T08:30', daysFromNow(1)  + 'T15:00', 0, 'Natural History Museum',    '#06B6D4', samId,  samId ],
  ['Family BBQ - Mum & Dad',    'Bring potato salad',                               daysFromNow(12) + 'T13:00', daysFromNow(12) + 'T19:00', 0, "Grandma's Garden",          '#F59E0B', alexId, alexId],
  ['Car Service Appointment',   'VW Golf, oil change + tyre check',                 daysFromNow(6)  + 'T09:00', daysFromNow(6)  + 'T10:30', 0, 'AutoHaus König',            '#6B7280', alexId, alexId],
  ['Yoga Class',                'Weekly - bring mat',                               daysFromNow(2)  + 'T19:00', daysFromNow(2)  + 'T20:00', 0, 'FitLife Studio',            '#10B981', samId,  samId ],
  ['Yoga Class',                'Weekly - bring mat',                               daysFromNow(9)  + 'T19:00', daysFromNow(9)  + 'T20:00', 0, 'FitLife Studio',            '#10B981', samId,  samId ],
  ['Mum\'s Birthday',           '',                                                 daysFromNow(8)  + 'T00:00', daysFromNow(8)  + 'T00:00', 1, '',                           '#EC4899', alexId, alexId],
  ['Company All-Hands',         'Q2 results + roadmap presentation',                daysFromNow(4)  + 'T10:00', daysFromNow(4)  + 'T12:00', 0, 'Office - Conference Room B','#2563EB', alexId, alexId],
  ['Football Training - Leo',   'Boots & water bottle',                             daysFromNow(2)  + 'T17:00', daysFromNow(2)  + 'T18:30', 0, 'Sports Ground West',        '#F97316', samId,  samId ],
  ['Football Training - Leo',   'Boots & water bottle',                             daysFromNow(7)  + 'T17:00', daysFromNow(7)  + 'T18:30', 0, 'Sports Ground West',        '#F97316', samId,  samId ],
  ['Holiday Planning Evening',  'Italy vs Croatia - laptops out',                   daysFromNow(3)  + 'T21:00', daysFromNow(3)  + 'T22:00', 0, 'Home',                      '#14B8A6', alexId, samId ],
  ['GP Appointment - Alex',     'Annual health check',                              daysFromNow(15) + 'T11:00', daysFromNow(15) + 'T11:30', 0, 'Dr. Weber - City Practice', '#EF4444', alexId, alexId],
  ['Weekend City Break',        'Hotel booked - just pack bags!',                   daysFromNow(20) + 'T00:00', daysFromNow(22) + 'T00:00', 1, 'Amsterdam',                 '#0EA5E9', alexId, alexId],
].forEach(row => insertEvent.run(...row));

// ── Meals ────────────────────────────────────────────────────────────────────

console.log('Inserting meals…');
const insertMeal = db.prepare(`
  INSERT INTO meals (date, meal_type, title, notes, created_by)
  VALUES (?, ?, ?, ?, ?)
`);

const mealPlan = [
  // [daysOffset, type, title, notes]
  [-1, 'breakfast', 'Scrambled eggs & toast',       'With smoked salmon'],
  [-1, 'lunch',     'Tomato soup',                   'Served with sourdough bread'],
  [-1, 'dinner',    'Spaghetti Bolognese',            'Kids loved it'],
  [-1, 'snack',     'Apple slices & peanut butter',  ''],
  [ 0, 'breakfast', 'Overnight oats',               'Blueberries & honey'],
  [ 0, 'lunch',     'Caesar salad with chicken',     'Homemade dressing'],
  [ 0, 'dinner',    'Grilled salmon & roasted veg',  'Lemon butter sauce'],
  [ 0, 'snack',     'Hummus with carrot sticks',     ''],
  [ 1, 'breakfast', 'Avocado toast',                'Poached eggs on top'],
  [ 1, 'lunch',     'Lentil soup',                  'With crusty bread'],
  [ 1, 'dinner',    'Chicken tikka masala',          'Basmati rice & naan'],
  [ 2, 'breakfast', 'Pancakes with maple syrup',    'Blueberry compote'],
  [ 2, 'lunch',     'Greek salad & pita',           'Extra feta'],
  [ 2, 'dinner',    'Beef stir-fry',                'Jasmine rice, pak choi'],
  [ 2, 'snack',     'Yoghurt & granola',            ''],
  [ 3, 'breakfast', 'Porridge with banana',         'Cinnamon & honey'],
  [ 3, 'lunch',     'Tuna melt sandwich',           'Toasted ciabatta'],
  [ 3, 'dinner',    'Homemade pizza',               "Emma's favourite night!"],
  [ 4, 'breakfast', 'Granola & mixed berries',      'Greek yoghurt'],
  [ 4, 'lunch',     'Minestrone soup',              'Topped with Parmesan'],
  [ 4, 'dinner',    'Roast chicken & potatoes',     'Sunday roast vibes'],
  [ 4, 'snack',     'Fruit salad',                 ''],
  [ 5, 'breakfast', 'French toast',                'Powdered sugar & berries'],
  [ 5, 'lunch',     'BLT sandwich',                'Wholemeal bread'],
  [ 5, 'dinner',    'Fish & chips',                'Mushy peas, tartare sauce'],
  [ 6, 'breakfast', 'Smoothie bowl',               'Acai, banana, chia seeds'],
  [ 6, 'lunch',     'Caprese salad & focaccia',    'Fresh basil'],
  [ 6, 'dinner',    'Lamb chops & couscous',       'Mint yoghurt dressing'],
];

mealPlan.forEach(([days, type, title, notes]) => {
  insertMeal.run(daysFromNow(days), type, title, notes, alexId);
});

// ── Contacts ─────────────────────────────────────────────────────────────────

console.log('Inserting contacts…');
const insertContact = db.prepare(`
  INSERT INTO contacts (name, category, phone, email, address, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

[
  ['Dr. Anna Weber',        'medical',   '+49 231 445 2210', 'praxis@dr-weber.de',       'Bürgerstraße 12, Dortmund',          'GP - appointments Mon–Thu'],
  ['Dr. Thomas Müller',     'medical',   '+49 231 887 0034', 'info@zahnarzt-mueller.de', 'Hansastraße 55, Dortmund',           'Family dentist'],
  ['Grandma & Grandpa Johnson', 'family','+49 2304 78 221',  'oma.johnson@gmail.com',    'Ahornweg 4, Castrop-Rauxel',         "Emma & Leo's grandparents"],
  ['Westpark Primary School','school',   '+49 231 556 8810', 'office@westpark-grundschule.de', 'Westparkstraße 20, Dortmund', "Emma's school - Mrs Bauer is class teacher"],
  ['AutoHaus König',        'services',  '+49 231 997 1100', 'service@autohaus-koenig.de','Industriestraße 88, Dortmund',       'VW service partner - Ref: Golf TDI 2021'],
  ['FitLife Studio',        'services',  '+49 231 340 5060', 'hello@fitlife-dortmund.de', 'Rheinlanddamm 14, Dortmund',        "Sam's yoga - Tuesdays 19:00"],
  ['Uncle Mike Johnson',    'family',    '+49 172 3340 551', 'mike.j@outlook.com',        '',                                  'Alex\'s brother - lives in Hamburg'],
  ['Aunt Claire Becker',    'family',    '+49 151 2234 8876','claire.becker@web.de',      'Fichtenweg 7, Bochum',              'Sam\'s sister'],
  ['Leo\'s Football Coach', 'school',    '+49 176 5512 4490','trainer@svwest-dortmund.de','Sportplatz West, Dortmund',         'Training Tues & Sat 17:00'],
  ['City Library',          'services',  '+49 231 502 6600', 'stadtbibliothek@dortmund.de','Königswall 18, Dortmund',          'Family cards - renew every 2 years'],
  ['Landlord - Mr Groß',    'services',  '+49 231 112 7743', 'vermieter.gross@gmail.com', '',                                  'Emergency maintenance: same number'],
  ['Emma\'s Best Friend Lena','family',  '+49 231 774 3309', '',                          '',                                  "Lena Braun - mum is Katrin +49 231 774 3308"],
].forEach(row => insertContact.run(...row));

// ── Budget ───────────────────────────────────────────────────────────────────

console.log('Inserting budget entries…');
const insertBudget = db.prepare(`
  INSERT INTO budget_entries (title, amount, category, date, is_recurring, created_by)
  VALUES (?, ?, ?, ?, ?, ?)
`);

[
  // Income
  ['Alex - Monthly Salary',      3850.00,  'income',     thisMonthDate(1),  1, alexId],
  ['Sam - Part-time Work',       1200.00,  'income',     thisMonthDate(1),  1, alexId],
  ['Child Benefit (Kindergeld)', 250.00,   'income',     thisMonthDate(5),  1, alexId],

  // Fixed expenses
  ['Rent',                      -1450.00,  'housing',    thisMonthDate(1),  1, alexId],
  ['Car Insurance - VW Golf',    -89.50,   'transport',  thisMonthDate(1),  1, alexId],
  ['Health Insurance',          -310.00,   'insurance',  thisMonthDate(1),  1, alexId],
  ['Internet & Phone Bundle',    -49.99,   'utilities',  thisMonthDate(5),  1, alexId],
  ['Electricity Bill',           -78.00,   'utilities',  thisMonthDate(15), 1, alexId],
  ['Netflix',                    -17.99,   'leisure',    thisMonthDate(10), 1, alexId],
  ['Spotify Family',             -16.99,   'leisure',    thisMonthDate(10), 1, alexId],
  ['Gym - FitLife Monthly',      -39.00,   'health',     thisMonthDate(1),  1, alexId],

  // Variable this month
  ['Weekly Groceries - Wk 1',   -142.30,   'food',       thisMonthDate(4),  0, samId ],
  ['Weekly Groceries - Wk 2',   -118.75,   'food',       thisMonthDate(11), 0, samId ],
  ['Weekly Groceries - Wk 3',   -134.20,   'food',       thisMonthDate(18), 0, samId ],
  ['School Trip Payment',        -25.00,   'school',     thisMonthDate(3),  0, samId ],
  ['Birthday Gift - Mum',        -60.00,   'family',     thisMonthDate(7),  0, alexId],
  ['Restaurant - Date Night',    -87.50,   'leisure',    thisMonthDate(9),  0, alexId],
  ['Fuel - VW Golf',             -68.00,   'transport',  thisMonthDate(6),  0, alexId],
  ['Pharmacy',                   -22.40,   'health',     thisMonthDate(8),  0, samId ],
  ['Leo\'s Football Boots',      -54.99,   'school',     thisMonthDate(12), 0, samId ],
  ['Home Improvement - Tools',   -43.00,   'home',       thisMonthDate(14), 0, alexId],
  ['Clothing - Emma',            -38.50,   'clothing',   thisMonthDate(16), 0, samId ],
  ['Weekend Trip Deposit',      -200.00,   'leisure',    thisMonthDate(19), 0, alexId],

  // Last month (for trend comparison)
  ['Alex - Monthly Salary',      3850.00,  'income',     lastMonthDate(1),  0, alexId],
  ['Sam - Part-time Work',       1200.00,  'income',     lastMonthDate(1),  0, alexId],
  ['Rent',                      -1450.00,  'housing',    lastMonthDate(1),  0, alexId],
  ['Weekly Groceries',          -489.00,   'food',       lastMonthDate(10), 0, samId ],
  ['Electricity Bill',           -82.00,   'utilities',  lastMonthDate(15), 0, alexId],
  ['Fuel - VW Golf',             -71.00,   'transport',  lastMonthDate(8),  0, alexId],
].forEach(row => insertBudget.run(...row));

// ── Notes ────────────────────────────────────────────────────────────────────

console.log('Inserting notes…');
const insertNote = db.prepare(`
  INSERT INTO notes (title, content, color, pinned, created_by)
  VALUES (?, ?, ?, ?, ?)
`);

[
  ['Holiday Checklist 🌍',
   'Passports (exp. 2028)\nTravel insurance - check!\nEuro cash - €300\nBook airport parking\nAsk Mike to water plants\nPack sunscreen SPF 50',
   '#0EA5E9', 1, alexId],

  ['WiFi & Smart Home',
   'WiFi: Oikos_Home_5G\nPassword: sunshine2024!\nPhilips Hue app: bridge IP 192.168.1.42\nNest thermostat: eco mode 18°C',
   '#F59E0B', 1, alexId],

  ["Emma's School Info",
   "Class: 3b - Mrs Bauer\nSchool starts: 08:10\nCollection: 13:30 (Tue/Thu 15:00)\nAllergy: mild lactose intolerance\nBest friends: Lena, Sophie, Tim",
   '#EC4899', 1, samId],

  ['Leo\'s Activities',
   'Football: Tues & Sat 17:00 - SV West\nSwimming: Fri 16:00 - Westbad\nNeeds: boots size 35, goggles\nCoach: Herr Krüger +49 176 5512 4490',
   '#F97316', 1, samId],

  ['Emergency Numbers',
   'Police: 110\nFire / Ambulance: 112\nPoison Control: 0800 192 11 10\nLocal GP out-of-hours: 116 117\nNearest A&E: Klinikum Dortmund',
   '#EF4444', 1, alexId],

  ['Car - Important Dates',
   'Next service: June 2025 (60,000 km)\nTÜV due: September 2025\nWinter tyres: stored at AutoHaus König\nInsurance renewal: October 2025',
   '#6B7280', 0, alexId],

  ['Book Recommendations',
   'Currently reading: "Atomic Habits" - James Clear\nWishlist:\n• The Thursday Murder Club\n• Lessons in Chemistry\n• Tomorrow, and Tomorrow, and Tomorrow',
   '#8B5CF6', 0, samId],

  ['Garden To-Do',
   '□ Re-pot herbs (basil, rosemary)\n□ Fix fence panel (3rd from gate)\n□ Order mulch for flower beds\n□ Plant tulip bulbs before Nov',
   '#10B981', 0, alexId],
].forEach(row => insertNote.run(...row));

// ── Shopping List ─────────────────────────────────────────────────────────────

console.log('Inserting shopping list…');
const listId = db.prepare(`
  INSERT INTO shopping_lists (name, created_by) VALUES (?, ?)
`).run('Weekly Shop', alexId).lastInsertRowid;

const insertItem = db.prepare(`
  INSERT INTO shopping_items (list_id, name, quantity, category, is_checked)
  VALUES (?, ?, ?, ?, ?)
`);

[
  ['Whole milk',          '2 l',     'dairy',    0],
  ['Greek yoghurt',       '500 g',   'dairy',    0],
  ['Cheddar cheese',      '300 g',   'dairy',    0],
  ['Free-range eggs',     '12',      'dairy',    0],
  ['Sourdough bread',     '1 loaf',  'bakery',   0],
  ['Wholemeal bread',     '1 loaf',  'bakery',   0],
  ['Croissants',          '4',       'bakery',   0],
  ['Chicken breast',      '800 g',   'meat',     0],
  ['Minced beef',         '500 g',   'meat',     0],
  ['Salmon fillets',      '2',       'fish',     0],
  ['Smoked salmon',       '100 g',   'fish',     1],
  ['Broccoli',            '1 head',  'veg',      0],
  ['Cherry tomatoes',     '250 g',   'veg',      0],
  ['Avocados',            '3',       'veg',      0],
  ['Baby spinach',        '150 g',   'veg',      1],
  ['Bananas',             '6',       'fruit',    0],
  ['Blueberries',         '125 g',   'fruit',    0],
  ['Lemons',              '4',       'fruit',    0],
  ['Pasta - spaghetti',  '500 g',   'pantry',   0],
  ['Basmati rice',        '1 kg',    'pantry',   0],
  ['Olive oil',           '500 ml',  'pantry',   0],
  ['Tomato passata',      '2 × 500 g','pantry',  0],
  ['Oat milk',            '1 l',     'dairy',    0],
  ['Orange juice',        '1 l',     'drinks',   0],
  ['Sparkling water',     '6 × 1 l', 'drinks',   1],
  ['Children\'s vitamins','1 pack',  'health',   0],
].forEach(([name, qty, cat, checked]) => insertItem.run(listId, name, qty, cat, checked));

// ── Done ─────────────────────────────────────────────────────────────────────

db.close();
console.log('\n✓ Demo data inserted successfully!');
console.log('  Login: alex / demo1234  (admin)');
console.log('  Login: sam  / demo1234  (member)');
