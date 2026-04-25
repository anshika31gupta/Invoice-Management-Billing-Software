/**
 * Recurring Invoices Module
 * Handles automatic recurring invoice generation
 */

class RecurringInvoiceService {
  constructor(db) {
    this.db = db;
  }

  async createRecurringTemplate(data) {
    const query = `
      CREATE TABLE IF NOT EXISTS recurring_invoices (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        company_id INTEGER,
        client_id INTEGER,
        template_name TEXT,
        frequency TEXT,
        amount REAL,
        tax_rate REAL,
        description TEXT,
        items TEXT,
        start_date TEXT,
        end_date TEXT,
        is_active BOOLEAN DEFAULT 1,
        last_generated_date TEXT,
        next_due_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.run(query, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async addRecurringInvoice(recurringData) {
    const query = `
      INSERT INTO recurring_invoices 
      (user_id, company_id, client_id, template_name, frequency, amount, tax_rate, description, items, start_date, end_date, next_due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const nextDueDate = this.calculateNextDueDate(recurringData.start_date, recurringData.frequency);

    return new Promise((resolve, reject) => {
      this.db.run(query, [
        recurringData.user_id,
        recurringData.company_id,
        recurringData.client_id,
        recurringData.template_name,
        recurringData.frequency,
        recurringData.amount,
        recurringData.tax_rate,
        recurringData.description,
        JSON.stringify(recurringData.items || []),
        recurringData.start_date,
        recurringData.end_date,
        nextDueDate
      ], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  }

  calculateNextDueDate(startDate, frequency) {
    const date = new Date(startDate);

    switch(frequency) {
      case 'daily':
        date.setDate(date.getDate() + 1);
        break;
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'quarterly':
        date.setMonth(date.getMonth() + 3);
        break;
      case 'yearly':
        date.setFullYear(date.getFullYear() + 1);
        break;
      default:
        date.setMonth(date.getMonth() + 1);
    }

    return date.toISOString().split('T')[0];
  }

  async generateDueRecurringInvoices() {
    const query = `
      SELECT * FROM recurring_invoices 
      WHERE is_active = 1 
      AND next_due_date <= date('now')
      AND (end_date IS NULL OR end_date >= date('now'))
    `;

    return new Promise((resolve, reject) => {
      this.db.all(query, async (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        for (const recurring of rows) {
          try {
            // Create invoice from recurring template
            const invoiceQuery = `
              INSERT INTO invoices 
              (user_id, company_id, client_id, invoice_number, issue_date, due_date, tax_rate, notes, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const today = new Date().toISOString().split('T')[0];
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);

            const invoiceNumber = `REC-${Date.now()}`;

            await new Promise((resolveInv, rejectInv) => {
              this.db.run(invoiceQuery, [
                recurring.user_id,
                recurring.company_id,
                recurring.client_id,
                invoiceNumber,
                today,
                dueDate.toISOString().split('T')[0],
                recurring.tax_rate,
                `Recurring: ${recurring.template_name}`,
                'draft'
              ], function(err) {
                if (err) rejectInv(err);
                else {
                  // Add items
                  const items = JSON.parse(recurring.items || '[]');
                  items.forEach(item => {
                    const itemQuery = `
                      INSERT INTO invoice_items (invoice_id, description, quantity, rate, tax_rate)
                      VALUES (?, ?, ?, ?, ?)
                    `;
                    this.db.run(itemQuery, [
                      this.lastID,
                      item.description,
                      item.quantity,
                      item.rate,
                      recurring.tax_rate
                    ]);
                  });
                  
                  resolveInv({ id: this.lastID, number: invoiceNumber });
                }
              });
            });

            // Update next due date
            const updateQuery = `
              UPDATE recurring_invoices 
              SET last_generated_date = ?, next_due_date = ?
              WHERE id = ?
            `;

            const nextDueDate = this.calculateNextDueDate(today, recurring.frequency);

            await new Promise((resolveUpd, rejectUpd) => {
              this.db.run(updateQuery, [today, nextDueDate, recurring.id], (err) => {
                if (err) rejectUpd(err);
                else resolveUpd();
              });
            });

            console.log(`✅ Recurring invoice generated: ${invoiceNumber}`);
          } catch (error) {
            console.error('Error generating recurring invoice:', error);
          }
        }

        resolve(rows.length);
      });
    });
  }

  async getRecurringInvoices(companyId) {
    const query = `SELECT * FROM recurring_invoices WHERE company_id = ? ORDER BY created_at DESC`;

    return new Promise((resolve, reject) => {
      this.db.all(query, [companyId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async deleteRecurringInvoice(id) {
    const query = `DELETE FROM recurring_invoices WHERE id = ?`;

    return new Promise((resolve, reject) => {
      this.db.run(query, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = RecurringInvoiceService;
