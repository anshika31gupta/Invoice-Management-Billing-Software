const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'invoiceai-secret-key-2024';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// ─── Database Setup ───────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || 'invoiceai.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    currency TEXT DEFAULT 'INR',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'India',
    gstin TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    gstin TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    currency TEXT DEFAULT 'INR',
    tax_rate REAL DEFAULT 18,
    discount_amount REAL DEFAULT 0,
    total_paid REAL DEFAULT 0,
    notes TEXT,
    is_recurring INTEGER DEFAULT 0,
    recurring_interval TEXT,
    next_invoice_date TEXT,
    parent_invoice_id INTEGER,
    email_sent INTEGER DEFAULT 0,
    email_sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    rate REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_date TEXT NOT NULL,
    payment_method TEXT DEFAULT 'bank_transfer',
    status TEXT DEFAULT 'completed',
    reference TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
  );
  CREATE TABLE IF NOT EXISTS currency_rates (
    currency TEXT PRIMARY KEY,
    rate_to_inr REAL NOT NULL,
    symbol TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Initialize with sample data
const seedData = () => {
  const currencies = [
    ['INR',1.0,'₹'],['USD',83.5,'$'],['EUR',90.2,'€'],['GBP',105.8,'£'],
    ['AED',22.7,'د.إ'],['SGD',61.9,'S$'],['CAD',61.2,'C$'],['AUD',54.3,'A$'],['JPY',0.56,'¥']
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO currency_rates (currency,rate_to_inr,symbol) VALUES (?,?,?)');
  currencies.forEach(c => ins.run(...c));
  
  // Create demo user with example data (if doesn't exist)
  try {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const userCheck = db.prepare('SELECT id FROM users WHERE email=?').get('test@example.com');
    
    if (!userCheck) {
      const userResult = db.prepare('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)')
        .run('test@example.com', hashedPassword, 'Demo User', 'user');
      const demoUserId = userResult.lastInsertRowid;
      
      // Create demo company
      const companyResult = db.prepare(
        'INSERT INTO companies (user_id, name, email, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(demoUserId, "Demo User's Company", 'demo@company.com', '+91-9876543210', '456 Business Plaza', 'Delhi', 'Delhi');
      const demoCompanyId = companyResult.lastInsertRowid;
      
      // Create multiple clients
      const client1 = db.prepare('INSERT INTO clients (company_id, name, email, phone, city) VALUES (?, ?, ?, ?, ?)')
        .run(demoCompanyId, 'Acme Corporation', 'contact@acme.com', '+91-9999999999', 'Mumbai');
      
      const client2 = db.prepare('INSERT INTO clients (company_id, name, email, phone, city) VALUES (?, ?, ?, ?, ?)')
        .run(demoCompanyId, 'TechStart India', 'hello@techstart.in', '+91-8765432109', 'Bangalore');
      
      const client3 = db.prepare('INSERT INTO clients (company_id, name, email, phone, city) VALUES (?, ?, ?, ?, ?)')
        .run(demoCompanyId, 'Digital Solutions Ltd', 'info@digitalsol.com', '+91-7654321098', 'Hyderabad');
      
      // Create invoice 1 - Sent (₹94,400)
      const inv1 = db.prepare(
        'INSERT INTO invoices (user_id, company_id, client_id, invoice_number, issue_date, due_date, status, tax_rate, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(demoUserId, demoCompanyId, client1.lastInsertRowid, 'INV-001', '2026-04-01', '2026-05-01', 'sent', 18, 'INR');
      
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv1.lastInsertRowid, 'Web Development Services', 40, 1500);
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv1.lastInsertRowid, 'UI/UX Design', 10, 2000);
      
      // Create invoice 2 - Paid (₹212,400)
      const inv2 = db.prepare(
        'INSERT INTO invoices (user_id, company_id, client_id, invoice_number, issue_date, due_date, status, tax_rate, currency, total_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(demoUserId, demoCompanyId, client1.lastInsertRowid, 'INV-002', '2026-03-15', '2026-04-15', 'paid', 18, 'INR', 212400);
      
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv2.lastInsertRowid, 'Mobile App Development', 80, 2000);
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv2.lastInsertRowid, 'Bug Fixes & Support', 20, 1000);
      
      db.prepare('INSERT INTO payments (invoice_id, user_id, amount, payment_date, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(inv2.lastInsertRowid, demoUserId, 212400, '2026-04-10', 'bank_transfer', 'completed');
      
      // Create invoice 3 - Partial Payment (₹156,800 total, 78,400 paid)
      const inv3 = db.prepare(
        'INSERT INTO invoices (user_id, company_id, client_id, invoice_number, issue_date, due_date, status, tax_rate, currency, total_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(demoUserId, demoCompanyId, client2.lastInsertRowid, 'INV-003', '2026-04-05', '2026-05-05', 'partial', 18, 'INR', 78400);
      
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv3.lastInsertRowid, 'API Integration', 32, 1800);
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv3.lastInsertRowid, 'Database Optimization', 16, 2500);
      
      db.prepare('INSERT INTO payments (invoice_id, user_id, amount, payment_date, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(inv3.lastInsertRowid, demoUserId, 78400, '2026-04-12', 'net_banking', 'completed');
      
      // Create invoice 4 - Draft (₹118,100 total, unpaid)
      const inv4 = db.prepare(
        'INSERT INTO invoices (user_id, company_id, client_id, invoice_number, issue_date, due_date, status, tax_rate, currency, total_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(demoUserId, demoCompanyId, client3.lastInsertRowid, 'INV-004', '2026-04-15', '2026-05-15', 'draft', 18, 'INR', 0);
      
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv4.lastInsertRowid, 'WordPress Development', 50, 1600);
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv4.lastInsertRowid, 'SEO Optimization', 20, 800);
      db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)')
        .run(inv4.lastInsertRowid, 'Hosting Setup', 10, 500);
    }
  } catch(err) {
    console.error('Demo data seed error:', err.message);
  }
};
seedData();
console.log('✅ Database initialized successfully');

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const computeTotal = (invoiceId) => {
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(invoiceId);
  const subtotal = items.reduce((s,i) => s + i.quantity * i.rate, 0);
  const inv = db.prepare('SELECT tax_rate,discount_amount FROM invoices WHERE id=?').get(invoiceId);
  const tax = subtotal * (inv?.tax_rate || 0) / 100;
  const discount = inv?.discount_amount || 0;
  return { subtotal, tax, discount, total: subtotal + tax - discount, items };
};

const generateInvoiceNumber = (companyId) => {
  const cnt = db.prepare('SELECT COUNT(*) as c FROM invoices WHERE company_id=?').get(companyId).c;
  return `INV-${String(cnt+1).padStart(4,'0')}`;
};

const calculateNextDate = (fromDate, interval) => {
  const d = new Date(fromDate);
  switch (interval) {
    case 'weekly':    d.setDate(d.getDate()+7); break;
    case 'monthly':   d.setMonth(d.getMonth()+1); break;
    case 'quarterly': d.setMonth(d.getMonth()+3); break;
    case 'yearly':    d.setFullYear(d.getFullYear()+1); break;
    default:          d.setMonth(d.getMonth()+1);
  }
  return d.toISOString().split('T')[0];
};

// ─── Claude AI Helper ─────────────────────────────────────────────────────────
const callClaude = (messages, systemPrompt) => {
  return new Promise((resolve) => {
    if (!CLAUDE_API_KEY) { resolve(null); return; }
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt || 'You are InvoiceAI, a smart billing assistant. Be concise and practical.',
      messages: Array.isArray(messages) ? messages : [{ role:'user', content: messages }]
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': CLAUDE_API_KEY,
        'anthropic-version':'2023-06-01', 'Content-Length': Buffer.byteLength(body) }
    };
    const r = https.request(options, (res2) => {
      let data = '';
      res2.on('data', c => data += c);
      res2.on('end', () => {
        try { resolve(JSON.parse(data).content?.[0]?.text || null); } catch { resolve(null); }
      });
    });
    r.on('error', () => resolve(null));
    r.setTimeout(15000, () => { r.destroy(); resolve(null); });
    r.write(body); r.end();
  });
};

// ─── PDF HTML Generator ───────────────────────────────────────────────────────
const generateInvoiceHTML = (invoice, company, client, items, totals) => {
  const sym = db.prepare('SELECT symbol FROM currency_rates WHERE currency=?').get(invoice.currency)?.symbol || '₹';
  const fmt = n => `${sym}${Number(n).toLocaleString('en-IN',{minimumFractionDigits:2})}`;
  const rows = items.map(i => `<tr><td>${i.description}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${fmt(i.rate)}</td><td style="text-align:right">${fmt(i.quantity*i.rate)}</td></tr>`).join('');
  const statusColors = { paid:'#dcfce7;color:#16a34a', sent:'#dbeafe;color:#2563eb', draft:'#f1f5f9;color:#64748b', overdue:'#fee2e2;color:#dc2626', partial:'#fef9c3;color:#ca8a04' };
  const sc = statusColors[invoice.status] || statusColors.draft;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${invoice.invoice_number}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1e293b;padding:40px;background:#fff}
.hdr{display:flex;justify-content:space-between;margin-bottom:36px}.co-name{font-size:26px;font-weight:700;color:#4f46e5}.co-meta{font-size:12px;color:#64748b;margin-top:4px;line-height:1.6}
.inv-label{background:#4f46e5;color:#fff;padding:6px 18px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px}.inv-num{font-size:20px;font-weight:700;margin-top:6px;text-align:right}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}.bill-box{background:#f8fafc;padding:14px;border-radius:8px;border-left:4px solid #4f46e5}
.label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:3px}.val{font-weight:600}
.dates{display:flex;gap:16px;margin-bottom:28px}.date-box{flex:1;text-align:center;background:#f1f5f9;padding:10px;border-radius:8px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#4f46e5;color:#fff;padding:9px 11px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
th:last-child,td:last-child{text-align:right}td{padding:9px 11px;border-bottom:1px solid #f1f5f9}
.tot{margin-left:auto;width:260px}.tr{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9}
.tr.grand{font-size:15px;font-weight:700;color:#4f46e5;border-top:2px solid #4f46e5;border-bottom:none;padding-top:10px}
.notes{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px;margin-top:20px}
.footer{text-align:center;color:#94a3b8;font-size:11px;margin-top:36px;padding-top:16px;border-top:1px solid #f1f5f9}
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;background:${sc.split(';')[0]};${sc.split(';')[1]}}
@media print{body{padding:20px}}</style></head><body>
<div class="hdr">
  <div><div class="co-name">${company?.name||'Your Company'}</div>
  <div class="co-meta">${company?.address||''}<br>${company?.city||''}${company?.state?', '+company.state:''}<br>${company?.email||''}${company?.phone?' · '+company.phone:''}</div>
  ${company?.gstin?`<div style="font-size:11px;color:#64748b;margin-top:3px">GSTIN: ${company.gstin}</div>`:''}</div>
  <div style="text-align:right"><div class="inv-label">INVOICE</div><div class="inv-num">${invoice.invoice_number}</div>
  <div style="margin-top:6px"><span class="badge">${invoice.status}</span></div></div>
</div>
<div class="grid2">
  <div class="bill-box"><div class="label">Bill To</div><div class="val">${client?.name||'Client'}</div>
  <div style="font-size:12px;color:#64748b;margin-top:3px">${client?.email||''}${client?.phone?'<br>'+client.phone:''}${client?.city?'<br>'+client.city:''}</div>
  ${client?.gstin?`<div style="font-size:11px;color:#64748b">GSTIN: ${client.gstin}</div>`:''}</div>
  <div><div class="dates">
    <div class="date-box"><div class="label">Issue Date</div><div class="val">${invoice.issue_date}</div></div>
    <div class="date-box"><div class="label">Due Date</div><div class="val">${invoice.due_date}</div></div>
    <div class="date-box"><div class="label">Currency</div><div class="val">${invoice.currency}</div></div>
  </div></div>
</div>
<table><thead><tr><th style="width:50%">Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="tot">
  <div class="tr"><span>Subtotal</span><span>${fmt(totals.subtotal)}</span></div>
  ${totals.discount>0?`<div class="tr"><span>Discount</span><span>-${fmt(totals.discount)}</span></div>`:''}
  <div class="tr"><span>GST (${invoice.tax_rate}%)</span><span>${fmt(totals.tax)}</span></div>
  ${invoice.total_paid>0?`<div class="tr"><span>Paid</span><span>-${fmt(invoice.total_paid)}</span></div>`:''}
  <div class="tr grand"><span>Total Due</span><span>${fmt(totals.total-(invoice.total_paid||0))}</span></div>
</div>
${invoice.notes?`<div class="notes"><strong>Notes:</strong> ${invoice.notes}</div>`:''}
<div class="footer">Thank you for your business! · InvoiceAI · ${new Date().toLocaleDateString('en-IN')}</div>
</body></html>`;
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════
app.post('/api/v1/auth/signup', (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Email, password, and name are required' });

    const hashedPassword = bcrypt.hashSync(password, 10);
    
    const result = db.prepare(
      'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)'
    ).run(email, hashedPassword, name, 'user');
    
    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id=?').get(result.lastInsertRowid);
    
    // Create example company
    const companyResult = db.prepare(
      'INSERT INTO companies (user_id, name, email, phone, address, city, state, gstin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, name + "'s Company", email, '+91-9999999999', '123 Tech Park', 'Bangalore', 'Karnataka', '36AABCT1234H1Z0');
    const companyId = companyResult.lastInsertRowid;
    
    // Create example client
    const clientResult = db.prepare(
      'INSERT INTO clients (company_id, name, email, phone, city) VALUES (?, ?, ?, ?, ?)'
    ).run(companyId, 'Acme Corporation', 'contact@acme.com', '+91-9876543210', 'Mumbai');
    const clientId = clientResult.lastInsertRowid;
    
    // Create example invoice 1 - Sent
    const invoice1Result = db.prepare(
      'INSERT INTO invoices (user_id, company_id, client_id, invoice_number, issue_date, due_date, status, tax_rate, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, companyId, clientId, 'INV-001', '2026-04-01', '2026-05-01', 'sent', 18, 'INR');
    const invoiceId1 = invoice1Result.lastInsertRowid;
    
    // Add items to invoice 1
    db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)').run(invoiceId1, 'Web Development Services', 40, 1500);
    db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)').run(invoiceId1, 'UI/UX Design', 10, 2000);
    
    // Create example invoice 2 - Paid
    const invoice2Result = db.prepare(
      'INSERT INTO invoices (user_id, company_id, client_id, invoice_number, issue_date, due_date, status, tax_rate, currency, total_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, companyId, clientId, 'INV-002', '2026-03-15', '2026-04-15', 'paid', 18, 'INR', 88200);
    const invoiceId2 = invoice2Result.lastInsertRowid;
    
    // Add items to invoice 2
    db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)').run(invoiceId2, 'Mobile App Development', 80, 2000);
    db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, rate) VALUES (?, ?, ?, ?)').run(invoiceId2, 'Bug Fixes & Support', 20, 1000);
    
    // Add payment record for invoice 2
    db.prepare('INSERT INTO payments (invoice_id, user_id, amount, payment_date, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)').run(invoiceId2, user.id, 88200, '2026-04-10', 'bank_transfer', 'completed');
    
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch(err) {
    console.error('Signup error:', err);
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/v1/auth/profile', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, name, role, currency, created_at FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Google OAuth endpoints
app.get('/api/v1/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;
  const scope = 'openid email profile';
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  res.redirect(googleAuthUrl);
});

app.get('/api/v1/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No authorization code' });

    // Exchange code for token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_CALLBACK_URL
      })
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) throw new Error('No access token');

    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?access_token=' + tokenData.access_token);
    const googleUser = await userResponse.json();

    // Check if user exists, else create
    let user = db.prepare('SELECT * FROM users WHERE email=?').get(googleUser.email);
    if (!user) {
      db.prepare('INSERT INTO users (email,name,password,role) VALUES (?,?,?,?)').run(
        googleUser.email,
        googleUser.name,
        bcrypt.hashSync('google-oauth-' + googleUser.id, 10),
        'user'
      );
      user = db.prepare('SELECT * FROM users WHERE email=?').get(googleUser.email);
    }

    // Create JWT token
    const jwtToken = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    // Redirect to frontend with token
    res.redirect(`http://localhost:3000?token=${jwtToken}&user=${encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, name: user.name }))}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// COMPANIES & CLIENTS
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/companies', authenticate, (req,res) => {
  try {
    const result = db.prepare('SELECT * FROM companies WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/v1/companies', authenticate, (req, res) => {
  try {
    const { name,email,phone,address,city,state,country,gstin } = req.body;
    if (!name) return res.status(400).json({ error:'Company name is required' });
    const result = db.prepare(
      'INSERT INTO companies (user_id,name,email,phone,address,city,state,country,gstin) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(req.user.id, name, email||null, phone||null, address||null, city||null, state||null, country||'India', gstin||null);
    res.status(201).json(db.prepare('SELECT * FROM companies WHERE id=?').get(result.lastInsertRowid));
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/v1/companies/:id', authenticate, (req,res) => {
  try {
    const result = db.prepare('SELECT * FROM companies WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!result) return res.status(404).json({ error:'Company not found' });
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/v1/companies/:id/clients', authenticate, (req,res) => {
  try {
    const result = db.prepare('SELECT id FROM companies WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!result) return res.status(403).json({ error:'Access denied' });
    const clients = db.prepare('SELECT * FROM clients WHERE company_id=? ORDER BY created_at DESC').all(req.params.id);
    res.json(clients);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/v1/companies/:id/clients', authenticate, (req,res) => {
  try {
    const result = db.prepare('SELECT id FROM companies WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!result) return res.status(403).json({ error:'Access denied' });
    const { name,email,phone,address,city,state,country,gstin } = req.body;
    if (!name) return res.status(400).json({ error:'Client name is required' });
    const inserted = db.prepare(
      'INSERT INTO clients (company_id,name,email,phone,address,city,state,country,gstin) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(req.params.id, name, email||null, phone||null, address||null, city||null, state||null, country||null, gstin||null);
    res.status(201).json(db.prepare('SELECT * FROM clients WHERE id=?').get(inserted.lastInsertRowid));
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// INVOICES
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/companies/:id/invoices', authenticate, (req,res) => {
  try {
    const c = db.prepare('SELECT id FROM companies WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!c) return res.status(403).json({ error:'Access denied' });
    const invoices = db.prepare('SELECT i.*,cl.name as client_name,cl.email as client_email FROM invoices i LEFT JOIN clients cl ON i.client_id=cl.id WHERE i.company_id=? ORDER BY i.created_at DESC').all(req.params.id);
    res.json(invoices.map(inv => ({ ...inv, ...computeTotal(inv.id) })));
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/v1/companies/:id/invoices', authenticate, (req,res) => {
  try {
    const c = db.prepare('SELECT id FROM companies WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!c) return res.status(403).json({ error:'Access denied' });
    const { client_id,issue_date,due_date,tax_rate,discount_amount,notes,items,currency,is_recurring,recurring_interval } = req.body;
    if (!client_id||!issue_date||!due_date||!items?.length) return res.status(400).json({ error:'client_id, issue_date, due_date, and items are required' });
    const invoice_number = generateInvoiceNumber(req.params.id);
    const next_invoice_date = is_recurring ? calculateNextDate(due_date,recurring_interval) : null;
    const id = db.prepare('INSERT INTO invoices (user_id,company_id,client_id,invoice_number,issue_date,due_date,tax_rate,discount_amount,notes,currency,is_recurring,recurring_interval,next_invoice_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.user.id,req.params.id,client_id,invoice_number,issue_date,due_date,tax_rate??18,discount_amount??0,notes||null,currency||'INR',is_recurring?1:0,recurring_interval||null,next_invoice_date).lastInsertRowid;
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id,description,quantity,rate,tax_rate) VALUES (?,?,?,?,?)');
    for (const item of items) ins.run(id,item.description,item.quantity,item.rate,item.tax_rate??0);
    res.status(201).json({ ...db.prepare('SELECT * FROM invoices WHERE id=?').get(id), ...computeTotal(id) });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/v1/invoices/:id', authenticate, (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(404).json({ error:'Invoice not found' });
    res.json({ ...inv, ...computeTotal(inv.id) });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/v1/invoices/:id', authenticate, (req,res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!inv) return res.status(404).json({ error:'Invoice not found' });
  const { due_date,tax_rate,discount_amount,notes,status,items,currency } = req.body;
  db.prepare('UPDATE invoices SET due_date=COALESCE(?,due_date),tax_rate=COALESCE(?,tax_rate),discount_amount=COALESCE(?,discount_amount),notes=COALESCE(?,notes),status=COALESCE(?,status),currency=COALESCE(?,currency) WHERE id=?')
    .run(due_date||null,tax_rate??null,discount_amount??null,notes||null,status||null,currency||null,req.params.id);
  if (items?.length) {
    db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id,description,quantity,rate,tax_rate) VALUES (?,?,?,?,?)');
    for (const item of items) ins.run(req.params.id,item.description,item.quantity,item.rate,item.tax_rate??0);
  }
  const u = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  res.json({ ...u, ...computeTotal(u.id) });
});

app.delete('/api/v1/invoices/:id', authenticate, (req,res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!inv) return res.status(404).json({ error:'Invoice not found' });
  db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(req.params.id);
  db.prepare('DELETE FROM payments WHERE invoice_id=?').run(req.params.id);
  db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id);
  res.json({ message:'Invoice deleted successfully' });
});

app.post('/api/v1/invoices/:id/send', authenticate, (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(404).json({ error:'Invoice not found' });
    db.prepare("UPDATE invoices SET status='sent',email_sent=1,email_sent_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
    res.json({ message:'Invoice marked as sent', invoice_number:inv.invoice_number });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/v1/invoices/:id/mark-paid', authenticate, (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(404).json({ error:'Invoice not found' });
    const { total } = computeTotal(inv.id);
    db.prepare("UPDATE invoices SET status='paid',total_paid=? WHERE id=?").run(total,req.params.id);
    res.json({ message:'Invoice marked as paid', amount:total });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PDF Export ───────────────────────────────────────────────────────────────
app.get('/api/v1/invoices/:id/pdf', authenticate, (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(404).json({ error:'Invoice not found' });
    const company = db.prepare('SELECT * FROM companies WHERE id=?').get(inv.company_id);
    const client  = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id);
    const totals  = computeTotal(inv.id);
    const html = generateInvoiceHTML(inv, company, client, totals.items, { ...totals, paid: inv.total_paid||0 });
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Disposition',`inline; filename="${inv.invoice_number}.html"`);
    res.send(html + `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),600));</script>`);
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Email Invoice ────────────────────────────────────────────────────────────
app.post('/api/v1/invoices/:id/email', authenticate, async (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(404).json({ error:'Invoice not found' });
    const client  = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id);
    const company = db.prepare('SELECT * FROM companies WHERE id=?').get(inv.company_id);
    const { total } = computeTotal(inv.id);
    const toEmail = req.body.to || client?.email;

    let emailBody = `Dear ${client?.name},\n\nPlease find your invoice ${inv.invoice_number} for ₹${total.toLocaleString('en-IN')} attached.\n\nDue Date: ${inv.due_date}\n\nThank you,\n${company?.name}`;

    if (CLAUDE_API_KEY) {
      const aiBody = await callClaude(
        `Write a professional, friendly 3-sentence payment request email for invoice ${inv.invoice_number} to ${client?.name} for ₹${total.toLocaleString('en-IN')} due on ${inv.due_date} from ${company?.name}. No subject line.`
      );
      if (aiBody) emailBody = aiBody;
    }

    db.prepare("UPDATE invoices SET email_sent=1,email_sent_at=CURRENT_TIMESTAMP,status='sent' WHERE id=?").run(req.params.id);

    res.json({
      success: true,
      to: toEmail,
      subject: `Invoice ${inv.invoice_number} from ${company?.name} — ₹${total.toLocaleString('en-IN')}`,
      body: emailBody,
      pdf_url: `/api/v1/invoices/${inv.id}/pdf`,
      note: 'To actually send emails, add SMTP_HOST, SMTP_USER, SMTP_PASS to .env and integrate nodemailer. Email content is ready above.',
      ai_powered: !!CLAUDE_API_KEY
    });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RECURRING INVOICES
// ═════════════════════════════════════════════════════════════════════════════

// Setup recurring invoice
app.post('/api/v1/invoices/:id/recurring', authenticate, (req, res) => {
  try {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { frequency } = req.body;
    if (!frequency) return res.status(400).json({ error: 'Frequency required' });

    const nextDate = calculateNextDate(invoice.due_date || new Date().toISOString().split('T')[0], frequency);
    db.prepare('UPDATE invoices SET is_recurring = 1, recurring_interval = ?, next_invoice_date = ? WHERE id = ?')
      .run(frequency, nextDate, req.params.id);

    res.json({ success: true, message: 'Recurring invoice setup successfully', frequency, nextDate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/v1/recurring', authenticate, (req,res) => {
  const recurring = db.prepare('SELECT i.*,c.name as client_name,comp.name as company_name FROM invoices i LEFT JOIN clients c ON i.client_id=c.id LEFT JOIN companies comp ON i.company_id=comp.id WHERE i.user_id=? AND i.is_recurring=1 ORDER BY i.next_invoice_date ASC').all(req.user.id);
  res.json(recurring.map(inv => ({ ...inv, ...computeTotal(inv.id) })));
});

app.post('/api/v1/recurring/:id/generate', authenticate, (req,res) => {
  const parent = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=? AND is_recurring=1').get(req.params.id,req.user.id);
  if (!parent) return res.status(404).json({ error:'Recurring invoice not found' });
  const today = new Date().toISOString().split('T')[0];
  const newDue = calculateNextDate(today, parent.recurring_interval);
  const num = generateInvoiceNumber(parent.company_id);
  const newId = db.prepare('INSERT INTO invoices (user_id,company_id,client_id,invoice_number,issue_date,due_date,tax_rate,discount_amount,notes,currency,parent_invoice_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(parent.user_id,parent.company_id,parent.client_id,num,today,newDue,parent.tax_rate,parent.discount_amount,parent.notes,parent.currency,parent.id).lastInsertRowid;
  const parentItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(parent.id);
  const ins = db.prepare('INSERT INTO invoice_items (invoice_id,description,quantity,rate,tax_rate) VALUES (?,?,?,?,?)');
  for (const item of parentItems) ins.run(newId,item.description,item.quantity,item.rate,item.tax_rate);
  db.prepare('UPDATE invoices SET next_invoice_date=? WHERE id=?').run(newDue,parent.id);
  res.status(201).json({ ...db.prepare('SELECT * FROM invoices WHERE id=?').get(newId), ...computeTotal(newId) });
});

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/invoices/:id/payments', authenticate, (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(403).json({ error:'Access denied' });
    res.json(db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY payment_date DESC').all(req.params.id));
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/v1/invoices/:id/payments', authenticate, (req,res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!inv) return res.status(404).json({ error:'Invoice not found' });
    const { amount,payment_date,payment_method,reference } = req.body;
    if (!amount||!payment_date) return res.status(400).json({ error:'Amount and payment_date are required' });
    const r = db.prepare('INSERT INTO payments (invoice_id,user_id,amount,payment_date,payment_method,reference) VALUES (?,?,?,?,?,?)')
      .run(req.params.id,req.user.id,amount,payment_date,payment_method||'bank_transfer',reference||null);
    const newPaid = (inv.total_paid||0) + amount;
    const { total } = computeTotal(inv.id);
    db.prepare('UPDATE invoices SET total_paid=?,status=? WHERE id=?').run(newPaid,newPaid>=total?'paid':'partial',req.params.id);
    res.status(201).json(db.prepare('SELECT * FROM payments WHERE id=?').get(r.lastInsertRowid));
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-CURRENCY
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/currencies', authenticate, (req,res) => res.json(db.prepare('SELECT * FROM currency_rates ORDER BY currency').all()));

app.get('/api/v1/currencies/convert', authenticate, (req,res) => {
  const { amount,from,to } = req.query;
  if (!amount||!from||!to) return res.status(400).json({ error:'amount, from, to required' });
  const fr = db.prepare('SELECT rate_to_inr FROM currency_rates WHERE currency=?').get(from);
  const to_ = db.prepare('SELECT rate_to_inr,symbol FROM currency_rates WHERE currency=?').get(to);
  if (!fr||!to_) return res.status(400).json({ error:'Unknown currency' });
  const converted = (parseFloat(amount)*fr.rate_to_inr)/to_.rate_to_inr;
  res.json({ from,to,amount:parseFloat(amount),converted:Math.round(converted*100)/100,symbol:to_.symbol });
});

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD + ANALYTICS
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/dashboard', authenticate, (req,res) => {
  const companies = db.prepare('SELECT id FROM companies WHERE user_id=?').all(req.user.id);
  const ids = companies.map(c=>c.id);
  if (!ids.length) return res.json({ total_invoices:0,total_revenue:0,pending:0,overdue:0 });
  const ph = ids.map(()=>'?').join(',');
  const invoices = db.prepare(`SELECT * FROM invoices WHERE company_id IN (${ph})`).all(...ids);
  const today = new Date().toISOString().split('T')[0];
  let totalRevenue=0,pending=0,overdue=0,paid=0;
  for (const inv of invoices) {
    const { total } = computeTotal(inv.id);
    if (inv.status==='paid') { totalRevenue+=total; paid++; }
    else if (inv.status==='sent'&&inv.due_date<today) overdue++;
    else if (['draft','sent'].includes(inv.status)) pending++;
  }
  res.json({ total_invoices:invoices.length,total_revenue:totalRevenue,pending,overdue,paid,
    total_clients:db.prepare(`SELECT COUNT(*) as cnt FROM clients WHERE company_id IN (${ph})`).get(...ids).cnt });
});

app.get('/api/v1/analytics/advanced', authenticate, (req,res) => {
  const companies = db.prepare('SELECT id FROM companies WHERE user_id=?').all(req.user.id);
  if (!companies.length) return res.json({});
  const ph = companies.map(()=>'?').join(',');
  const ids = companies.map(c=>c.id);
  const invoices = db.prepare(`SELECT * FROM invoices WHERE company_id IN (${ph})`).all(...ids);
  const today = new Date().toISOString().split('T')[0];
  const monthly={}, byClient={}, byCurrency={}, statusCount={draft:0,sent:0,paid:0,partial:0,overdue:0};
  for (const inv of invoices) {
    const { total } = computeTotal(inv.id);
    const m = inv.issue_date?.substring(0,7)||'unknown';
    monthly[m] = (monthly[m]||0)+total;
    byCurrency[inv.currency] = (byCurrency[inv.currency]||0)+total;
    const cname = db.prepare('SELECT name FROM clients WHERE id=?').get(inv.client_id)?.name||'Unknown';
    byClient[cname] = (byClient[cname]||0)+total;
    if (inv.status==='sent'&&inv.due_date<today) statusCount.overdue++;
    else if (statusCount[inv.status]!==undefined) statusCount[inv.status]++;
  }
  const topClients = Object.entries(byClient).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,revenue])=>({name,revenue}));
  const collectionRate = invoices.length ? ((statusCount.paid/invoices.length)*100).toFixed(1) : 0;
  res.json({ monthly_revenue:monthly,revenue_by_client:byClient,top_clients:topClients,revenue_by_currency:byCurrency,status_breakdown:statusCount,collection_rate:collectionRate,total_invoices:invoices.length });
});

// ═════════════════════════════════════════════════════════════════════════════
// BACKUP / EXPORT
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/export/invoices', authenticate, (req,res) => {
  const { format='json', company_id } = req.query;
  const companies = company_id
    ? [db.prepare('SELECT id FROM companies WHERE id=? AND user_id=?').get(company_id,req.user.id)].filter(Boolean)
    : db.prepare('SELECT id FROM companies WHERE user_id=?').all(req.user.id);
  if (!companies.length) return res.status(404).json({ error:'No companies found' });
  const ph = companies.map(()=>'?').join(',');
  const ids = companies.map(c=>c.id);
  const invoices = db.prepare(`SELECT i.*,c.name as client_name,comp.name as company_name FROM invoices i LEFT JOIN clients c ON i.client_id=c.id LEFT JOIN companies comp ON i.company_id=comp.id WHERE i.company_id IN (${ph}) AND i.user_id=? ORDER BY i.created_at DESC`).all(...ids,req.user.id);
  const full = invoices.map(inv=>({ ...inv, ...computeTotal(inv.id) }));
  if (format==='csv') {
    const headers = ['invoice_number','client_name','issue_date','due_date','status','currency','subtotal','tax','total'];
    const rows = full.map(inv=>headers.map(h=>JSON.stringify(inv[h]??'')).join(','));
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="invoices.csv"');
    return res.send([headers.join(','),...rows].join('\n'));
  }
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition','attachment; filename="invoices-backup.json"');
  res.json({ exported_at:new Date().toISOString(), count:full.length, invoices:full });
});

app.get('/api/v1/export/full-backup', authenticate, (req,res) => {
  const user = db.prepare('SELECT id,email,name,role FROM users WHERE id=?').get(req.user.id);
  const companies = db.prepare('SELECT * FROM companies WHERE user_id=?').all(req.user.id);
  const ids = companies.map(c=>c.id);
  const ph = ids.map(()=>'?').join(',');
  const clients   = ids.length ? db.prepare(`SELECT * FROM clients WHERE company_id IN (${ph})`).all(...ids) : [];
  const invoices  = ids.length ? db.prepare(`SELECT * FROM invoices WHERE company_id IN (${ph})`).all(...ids) : [];
  const invIds = invoices.map(i=>i.id);
  const iph = invIds.map(()=>'?').join(',');
  const items    = invIds.length ? db.prepare(`SELECT * FROM invoice_items WHERE invoice_id IN (${iph})`).all(...invIds) : [];
  const payments = invIds.length ? db.prepare(`SELECT * FROM payments WHERE invoice_id IN (${iph})`).all(...invIds) : [];
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition',`attachment; filename="invoiceai-backup-${Date.now()}.json"`);
  res.json({ exported_at:new Date().toISOString(),version:'2.0',user,companies,clients,invoices,invoice_items:items,payments });
});

// ═════════════════════════════════════════════════════════════════════════════
// AI — CLAUDE POWERED
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/ai/features', authenticate, (req,res) => {
  res.json({
    ai_powered: !!CLAUDE_API_KEY,
    model: CLAUDE_API_KEY ? 'claude-sonnet-4-20250514' : 'rule-based-fallback',
    setup_url: 'https://console.anthropic.com',
    features:[
      { name:'AI Chat Assistant',      status:'active', endpoint:'POST /api/v1/ai/chat' },
      { name:'Auto-Generate Invoice',  status:'active', endpoint:'POST /api/v1/companies/:id/invoices/generate-from-description' },
      { name:'Smart Description',      status:'active', endpoint:'POST /api/v1/ai/smart-description' },
      { name:'Payment Prediction',     status:'active', endpoint:'GET /api/v1/invoices/:id/predict-payment' },
      { name:'Fraud Detection',        status:'active', endpoint:'GET /api/v1/invoices/:id/detect-fraud' },
      { name:'AI Analytics',           status:'active', endpoint:'GET /api/v1/ai/analytics' },
      { name:'Invoice Summary',        status:'active', endpoint:'GET /api/v1/invoices/:id/summarize' },
      { name:'Email AI Drafting',      status:'active', endpoint:'POST /api/v1/invoices/:id/email' }
    ]
  });
});

// ─── AI Chat ─────────────────────────────────────────────────────────────────
app.post('/api/v1/ai/chat', authenticate, async (req,res) => {
  const { message, session_id } = req.body;
  if (!message) return res.status(400).json({ error:'Message is required' });
  let sessionId = session_id;
  if (!sessionId) sessionId = db.prepare('INSERT INTO chat_sessions (user_id) VALUES (?)').run(req.user.id).lastInsertRowid;
  db.prepare('INSERT INTO chat_messages (session_id,role,content) VALUES (?,?,?)').run(sessionId,'user',message);

  const history = db.prepare('SELECT role,content FROM chat_messages WHERE session_id=? ORDER BY created_at DESC LIMIT 12').all(sessionId).reverse();
  let reply;

  if (CLAUDE_API_KEY) {
    const system = `You are InvoiceAI, a smart billing assistant. You help with invoices, payments, clients, recurring billing, PDF exports, multi-currency, and analytics. Be concise and practical. Current date: ${new Date().toLocaleDateString('en-IN')}.`;
    reply = await callClaude(history.map(m=>({ role:m.role, content:m.content })), system);
  }

  if (!reply) {
    const msg = message.toLowerCase();
    if (msg.includes('hello')||msg.includes('hi')||msg.includes('hey')) reply = "Hello! 👋 I'm InvoiceAI. I can help with invoices, PDF generation, recurring billing, email, multi-currency, analytics, and exports. What do you need?";
    else if (msg.includes('pdf')) reply = "To get a PDF: open any invoice → click the 🖨️ PDF button. The invoice opens in print format — press Ctrl+P → Save as PDF. That's it!";
    else if (msg.includes('email')) reply = "Email invoices: open invoice → click Email. The API returns a ready email body. Add SMTP_HOST + SMTP_USER + SMTP_PASS to .env and use nodemailer to auto-send.";
    else if (msg.includes('recurring')) reply = "Recurring invoices: when creating, check 'Recurring' and pick interval (weekly/monthly/quarterly/yearly). Use the Recurring tab to generate the next invoice anytime.";
    else if (msg.includes('currency')||msg.includes('usd')||msg.includes('eur')||msg.includes('dollar')) reply = "Multi-currency support: INR, USD, EUR, GBP, AED, SGD, CAD, AUD, JPY. Select currency when creating invoices. Convert with /api/v1/currencies/convert?amount=100&from=USD&to=INR";
    else if (msg.includes('export')||msg.includes('backup')||msg.includes('csv')) reply = "Export options:\n• CSV: GET /api/v1/export/invoices?format=csv\n• JSON: GET /api/v1/export/invoices\n• Full backup: GET /api/v1/export/full-backup (includes all data)";
    else if (msg.includes('analytics')||msg.includes('report')) reply = "Analytics: /api/v1/analytics/advanced shows monthly revenue, top clients, currency breakdown, collection rate. AI insights at /api/v1/ai/analytics.";
    else if (msg.includes('api key')||msg.includes('claude')) reply = "To enable real AI: get your key at console.anthropic.com (free tier available) → add CLAUDE_API_KEY=sk-ant-... to your .env file → restart server. All AI features will upgrade automatically!";
    else if (msg.includes('overdue')) reply = "Overdue invoices show in red on dashboard. Click Email on the invoice to send a payment reminder. AI payment prediction shows risk level per invoice.";
    else if (msg.includes('gst')||msg.includes('tax')) reply = "GST/Tax: set per invoice (default 18%). Your company and client GSTIN is stored and printed on PDF invoices automatically.";
    else reply = "I can help with: invoices, PDFs, email, recurring billing, multi-currency, analytics, payments, exports. Ask me anything! (Add CLAUDE_API_KEY to .env for smarter AI responses)";
  }

  db.prepare('INSERT INTO chat_messages (session_id,role,content) VALUES (?,?,?)').run(sessionId,'assistant',reply);
  res.json({ session_id:sessionId, reply, ai_powered:!!CLAUDE_API_KEY, timestamp:new Date().toISOString() });
});

// ─── Smart Description ────────────────────────────────────────────────────────
app.post('/api/v1/ai/smart-description', authenticate, async (req,res) => {
  const { service_type, hours, rate } = req.body;
  if (CLAUDE_API_KEY) {
    const aiDesc = await callClaude(`Write a professional 1-sentence invoice line item description for: "${service_type}". Under 15 words. Just the description text, nothing else.`);
    if (aiDesc) return res.json({ description:aiDesc.trim(), suggested_rate:rate||1500, suggested_hours:hours||8, ai_powered:true });
  }
  const templates = {
    'web development':'Professional web development services including frontend, backend API, and deployment',
    'android':'Android mobile app development using Kotlin, Jetpack Compose, and MVVM architecture',
    'design':'UI/UX design including wireframing, prototyping, and final visual asset delivery',
    'consulting':'Technical consulting, architecture review, and strategic planning sessions',
    'testing':'QA and testing services including manual and automated test execution',
    'seo':'Search engine optimization including on-page, off-page, and technical SEO',
    'content':'Content writing and copywriting for website, blog, and marketing materials'
  };
  const key = Object.keys(templates).find(k=>service_type?.toLowerCase().includes(k))||'consulting';
  res.json({ description:templates[key], suggested_rate:rate||1500, suggested_hours:hours||8, ai_powered:false });
});

// ─── Auto-Generate Invoice ────────────────────────────────────────────────────
app.post('/api/v1/companies/:id/invoices/generate-from-description', authenticate, async (req,res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error:'Description is required' });

  if (CLAUDE_API_KEY) {
    const prompt = `Parse this work description into invoice data: "${description}"\nReturn valid JSON only (no markdown): {"service":"name","quantity":number,"rate":number,"unit":"hours/items","notes":"extra info if any"}\nUse reasonable Indian market rates if not mentioned.`;
    const aiResp = await callClaude(prompt, 'Return only valid JSON. No markdown, no explanation.');
    if (aiResp) {
      try {
        const parsed = JSON.parse(aiResp.replace(/```json|```/g,'').trim());
        const today = new Date(); const due = new Date(today.getTime()+30*864e5);
        return res.json({ suggested_invoice:{ issue_date:today.toISOString().split('T')[0], due_date:due.toISOString().split('T')[0], tax_rate:18, items:[{ description:parsed.service, quantity:parsed.quantity||1, rate:parsed.rate||1500 }] }, parsed, message:`AI: ${parsed.service} — ${parsed.quantity||1} ${parsed.unit||'unit(s)'} × ₹${parsed.rate}`, ai_powered:true });
      } catch {}
    }
  }

  // Rule-based fallback
  const words = description.toLowerCase();
  let hours=0, rate=1000, service='Professional Services';
  const hm = words.match(/(\d+)\s*hour/), rm = words.match(/(\d+)\s*(per hour|\/hr|\/hour)/);
  const kw = {'web development':1500,'mobile':2000,'design':1200,'consulting':2500,'testing':800,'backend':1800,'frontend':1400,'android':1600,'api':1300};
  if (hm) hours=parseInt(hm[1]); if (rm) rate=parseInt(rm[1]);
  for (const [k,r] of Object.entries(kw)) { if (words.includes(k)) { service=k.split(' ').map(w=>w[0].toUpperCase()+w.slice(1)).join(' '); if(!rm) rate=r; break; } }
  const qty = hours||1; const today=new Date(); const due=new Date(today.getTime()+30*864e5);
  res.json({ suggested_invoice:{ issue_date:today.toISOString().split('T')[0], due_date:due.toISOString().split('T')[0], tax_rate:18, items:[{ description:service,quantity:qty,rate }] }, parsed:{ service,hours:qty,rate,total_before_tax:qty*rate }, message:`Generated: ${service} — ${qty} unit(s) × ₹${rate}`, ai_powered:false });
});

// ─── Payment Prediction ───────────────────────────────────────────────────────
app.get('/api/v1/invoices/:id/predict-payment', authenticate, (req,res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!inv) return res.status(404).json({ error:'Invoice not found' });
  const days = Math.ceil((new Date(inv.due_date)-new Date())/864e5);
  const { total } = computeTotal(inv.id);
  let prob=0.85, risk='low', dtp=Math.max(days,3);
  if (days<0) { prob=0.45; risk='high'; dtp=7; }
  else if (days<7) { prob=0.70; risk='medium'; dtp=days+2; }
  if (total>100000) { prob-=0.10; risk=risk==='low'?'medium':'high'; }
  res.json({ invoice_id:inv.id, invoice_number:inv.invoice_number, probability:Math.max(0.1,prob), days_to_pay:dtp, risk_level:risk, total_amount:total, days_until_due:days,
    recommendation:risk==='high'?'Send payment reminder immediately':risk==='medium'?'Follow up within 2 days':'On track for timely payment' });
});

// ─── Fraud Detection ──────────────────────────────────────────────────────────
app.get('/api/v1/invoices/:id/detect-fraud', authenticate, (req,res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!inv) return res.status(404).json({ error:'Invoice not found' });
  const { total,items } = computeTotal(inv.id);
  const flags=[]; let score=0;
  if (total>500000) { flags.push('High value (>₹5 Lakh)'); score+=20; }
  if (items.length>10) { flags.push('Too many line items'); score+=15; }
  if ((new Date(inv.due_date)-new Date(inv.issue_date))/864e5<3) { flags.push('Very short payment window'); score+=25; }
  const dups=db.prepare('SELECT COUNT(*) as c FROM invoices WHERE client_id=? AND issue_date=? AND id!=?').get(inv.client_id,inv.issue_date,inv.id);
  if (dups.c>0) { flags.push('Duplicate invoice on same date'); score+=40; }
  res.json({ invoice_id:inv.id,invoice_number:inv.invoice_number,risk_score:Math.min(score,100),flags,recommended_action:score>50?'review':score>25?'monitor':'approve',total_amount:total });
});

// ─── AI Analytics ─────────────────────────────────────────────────────────────
app.get('/api/v1/ai/analytics', authenticate, async (req,res) => {
  const companies = db.prepare('SELECT id FROM companies WHERE user_id=?').all(req.user.id);
  if (!companies.length) return res.json({ insights:[],summary:'No data available' });
  const ph=companies.map(()=>'?').join(','); const ids=companies.map(c=>c.id);
  const invoices=db.prepare(`SELECT * FROM invoices WHERE company_id IN (${ph})`).all(...ids);
  const today=new Date().toISOString().split('T')[0];
  let rev=0,paid=0,overdue=0; const monthly={};
  for (const inv of invoices) {
    const { total }=computeTotal(inv.id);
    if (inv.status==='paid') { rev+=total; paid++; const m=inv.issue_date?.substring(0,7); if(m) monthly[m]=(monthly[m]||0)+total; }
    if (inv.status==='sent'&&inv.due_date<today) overdue++;
  }
  const rate = invoices.length?((paid/invoices.length)*100).toFixed(1):0;
  let insights=[];
  if (CLAUDE_API_KEY) {
    const aiStr = await callClaude(`Business stats: ${invoices.length} invoices, ₹${rev.toLocaleString('en-IN')} revenue, ${rate}% collection rate, ${overdue} overdue. Monthly trend: ${JSON.stringify(monthly)}. Give 3 actionable business insights as JSON array: [{"type":"success|warning|info","message":"..."}]. JSON only.`,
      'Return only a valid JSON array. No markdown.');
    if (aiStr) { try { insights=JSON.parse(aiStr.replace(/```json|```/g,'').trim()); } catch {} }
  }
  if (!insights.length) {
    if (overdue>0) insights.push({ type:'warning',message:`${overdue} overdue invoice(s) — follow up to recover revenue` });
    if (parseFloat(rate)>80) insights.push({ type:'success',message:`Great ${rate}% collection rate — keep it up!` });
    else if (parseFloat(rate)<50) insights.push({ type:'warning',message:`Low ${rate}% collection — consider stricter payment terms` });
    insights.push({ type:'info',message:`₹${rev.toLocaleString('en-IN')} collected from ${paid} paid invoices` });
  }
  res.json({ insights,monthly_revenue:monthly,payment_rate:rate,total_revenue:rev,ai_powered:!!CLAUDE_API_KEY });
});

// ─── Invoice Summary ──────────────────────────────────────────────────────────
app.get('/api/v1/invoices/:id/summarize', authenticate, async (req,res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!inv) return res.status(404).json({ error:'Invoice not found' });
  const client=db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id);
  const { total,items }=computeTotal(inv.id);
  let summary;
  if (CLAUDE_API_KEY) {
    summary = await callClaude(`Summarize in 2 sentences: Invoice ${inv.invoice_number} for ${client?.name}, ₹${total.toLocaleString('en-IN')}, status: ${inv.status}, due: ${inv.due_date}, items: ${items.map(i=>i.description).join(', ')}.`);
  }
  res.json({ invoice_number:inv.invoice_number, summary:summary||`Invoice ${inv.invoice_number} for ${client?.name||'client'} totaling ₹${total.toLocaleString('en-IN')} is ${inv.status}, due ${inv.due_date}.`, total,status:inv.status,client:client?.name,ai_powered:!!CLAUDE_API_KEY });
});

// ═════════════════════════════════════════════════════════════════════════════
// CHAT HISTORY
// ═════════════════════════════════════════════════════════════════════════════
app.get('/api/v1/chat/sessions', authenticate, (req,res) => res.json(db.prepare('SELECT * FROM chat_sessions WHERE user_id=? ORDER BY created_at DESC').all(req.user.id)));
app.get('/api/v1/chat/sessions/:id/messages', authenticate, (req,res) => {
  const s=db.prepare('SELECT * FROM chat_sessions WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if (!s) return res.status(403).json({ error:'Access denied' });
  res.json(db.prepare('SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at ASC').all(req.params.id));
});

// ═════════════════════════════════════════════════════════════════════════════
// MISC
// ═════════════════════════════════════════════════════════════════════════════
app.get('/health', (req,res) => res.json({ status:'ok', ai_enabled:!!CLAUDE_API_KEY, version:'2.0.0', timestamp:new Date().toISOString() }));
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'frontend','index.html')));

app.listen(PORT, () => {
  console.log('\n🚀 InvoiceAI v2.0 → http://localhost:' + PORT);
  console.log('🔑 Login: test@example.com / password123');
  console.log('🤖 AI: ' + (CLAUDE_API_KEY ? 'Claude API ✅ ACTIVE' : '⚠️  Rule-based mode — add CLAUDE_API_KEY to .env'));
  console.log('📄 PDF: GET /api/v1/invoices/:id/pdf');
  console.log('📧 Email: POST /api/v1/invoices/:id/email');
  console.log('🔁 Recurring: GET /api/v1/recurring');
  console.log('💱 Currencies: GET /api/v1/currencies');
  console.log('📦 Export: GET /api/v1/export/invoices?format=csv\n');
});

module.exports = app;