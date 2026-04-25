/**
 * Backup & Export Module
 * Handles data backup and export to various formats
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-stringify');

class BackupExportService {
  constructor(db, dataDir = './backups') {
    this.db = db;
    this.dataDir = dataDir;
    
    // Create backups directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Export invoices to CSV
   */
  async exportInvoicesCSV(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          invoice_number,
          issue_date,
          due_date,
          status,
          total_paid,
          tax_rate
        FROM invoices
        WHERE company_id = ?
        ORDER BY issue_date DESC
      `;

      this.db.all(query, [companyId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const filename = path.join(this.dataDir, `invoices-${Date.now()}.csv`);
        
        csv.stringify(rows, {
          header: true,
          columns: ['invoice_number', 'issue_date', 'due_date', 'status', 'total_paid', 'tax_rate']
        }, (err, output) => {
          if (err) {
            reject(err);
            return;
          }

          fs.writeFile(filename, output, (err) => {
            if (err) reject(err);
            else resolve({ filename, path: filename, size: output.length });
          });
        });
      });
    });
  }

  /**
   * Export invoices to JSON
   */
  async exportInvoicesJSON(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM invoices WHERE company_id = ? ORDER BY created_at DESC
      `;

      this.db.all(query, [companyId], (err, invoices) => {
        if (err) {
          reject(err);
          return;
        }

        const filename = path.join(this.dataDir, `invoices-${Date.now()}.json`);
        const data = {
          exportDate: new Date().toISOString(),
          companyId,
          invoiceCount: invoices.length,
          invoices
        };

        fs.writeFile(filename, JSON.stringify(data, null, 2), (err) => {
          if (err) reject(err);
          else resolve({ filename, path: filename, invoiceCount: invoices.length });
        });
      });
    });
  }

  /**
   * Create complete database backup
   */
  async createDatabaseBackup(companyId) {
    return new Promise((resolve, reject) => {
      const backupData = {
        exportDate: new Date().toISOString(),
        companyId,
        tables: {}
      };

      const tables = ['invoices', 'clients', 'payments', 'invoice_items', 'chat_messages'];
      let completedTables = 0;

      tables.forEach(table => {
        this.db.all(`SELECT * FROM ${table} WHERE company_id = ? OR company_id IS NULL`, [companyId], (err, rows) => {
          if (err) {
            console.error(`Error backing up ${table}:`, err);
          } else {
            backupData.tables[table] = rows || [];
          }

          completedTables++;
          if (completedTables === tables.length) {
            const filename = path.join(this.dataDir, `backup-${Date.now()}.json`);
            fs.writeFile(filename, JSON.stringify(backupData, null, 2), (err) => {
              if (err) reject(err);
              else resolve({
                filename,
                path: filename,
                size: JSON.stringify(backupData).length,
                tablesCount: tables.length
              });
            });
          }
        });
      });
    });
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupFile) {
    return new Promise((resolve, reject) => {
      fs.readFile(backupFile, 'utf8', (err, data) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          const backupData = JSON.parse(data);
          let restoredCount = 0;

          Object.entries(backupData.tables).forEach(([table, rows]) => {
            rows.forEach(row => {
              const keys = Object.keys(row);
              const placeholders = keys.map(() => '?').join(',');
              const values = Object.values(row);
              const query = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
              
              this.db.run(query, values, (err) => {
                if (err) console.error(`Error restoring to ${table}:`, err);
                else restoredCount++;
              });
            });
          });

          resolve({
            success: true,
            restoredCount,
            backupDate: backupData.exportDate
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Export to Excel (basic)
   */
  async exportToExcel(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          invoice_number as 'Invoice #',
          issue_date as 'Issue Date',
          due_date as 'Due Date',
          status as 'Status',
          total_paid as 'Amount',
          tax_rate as 'Tax %'
        FROM invoices
        WHERE company_id = ?
        ORDER BY issue_date DESC
      `;

      this.db.all(query, [companyId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const filename = path.join(this.dataDir, `invoices-${Date.now()}.xlsx`);
        
        // Create simple Excel file (using JSON export as fallback)
        const xlsxData = JSON.stringify(rows, null, 2);
        
        fs.writeFile(filename.replace('.xlsx', '.json'), xlsxData, (err) => {
          if (err) reject(err);
          else resolve({
            filename,
            path: filename,
            format: 'JSON (Excel format not available - use JSON or CSV)',
            rowCount: rows.length
          });
        });
      });
    });
  }

  /**
   * List all backups
   */
  listBackups() {
    return new Promise((resolve, reject) => {
      fs.readdir(this.dataDir, (err, files) => {
        if (err) {
          reject(err);
          return;
        }

        const backups = files
          .filter(f => f.startsWith('backup-'))
          .map(f => {
            const filepath = path.join(this.dataDir, f);
            const stats = fs.statSync(filepath);
            return {
              filename: f,
              path: filepath,
              size: stats.size,
              createdAt: stats.birthtime
            };
          })
          .sort((a, b) => b.createdAt - a.createdAt);

        resolve(backups);
      });
    });
  }

  /**
   * Delete old backups
   */
  async deleteOldBackups(daysOld = 30) {
    return new Promise((resolve, reject) => {
      fs.readdir(this.dataDir, (err, files) => {
        if (err) {
          reject(err);
          return;
        }

        const now = Date.now();
        const maxAge = daysOld * 24 * 60 * 60 * 1000;
        let deletedCount = 0;

        files.forEach(f => {
          const filepath = path.join(this.dataDir, f);
          const stats = fs.statSync(filepath);
          
          if (now - stats.birthtime.getTime() > maxAge) {
            fs.unlinkSync(filepath);
            deletedCount++;
          }
        });

        resolve({ deletedCount });
      });
    });
  }

  /**
   * Export detailed financial report
   */
  async exportFinancialReport(companyId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          i.invoice_number,
          i.issue_date,
          i.due_date,
          c.name as client_name,
          i.total_paid as amount,
          i.status,
          COUNT(p.id) as payment_count,
          SUM(p.amount) as total_paid_amount
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN payments p ON i.id = p.invoice_id
        WHERE i.company_id = ? 
        AND i.issue_date BETWEEN ? AND ?
        GROUP BY i.id
        ORDER BY i.issue_date DESC
      `;

      this.db.all(query, [companyId, startDate, endDate], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const filename = path.join(this.dataDir, `financial-report-${Date.now()}.json`);
        const report = {
          reportDate: new Date().toISOString(),
          period: { startDate, endDate },
          companyId,
          invoiceCount: rows.length,
          totalAmount: rows.reduce((sum, r) => sum + (r.amount || 0), 0),
          totalPaid: rows.reduce((sum, r) => sum + (r.total_paid_amount || 0), 0),
          data: rows
        };

        fs.writeFile(filename, JSON.stringify(report, null, 2), (err) => {
          if (err) reject(err);
          else resolve({
            filename,
            path: filename,
            summary: {
              invoiceCount: rows.length,
              totalAmount: report.totalAmount,
              totalPaid: report.totalPaid,
              outstanding: report.totalAmount - report.totalPaid
            }
          });
        });
      });
    });
  }
}

module.exports = BackupExportService;
