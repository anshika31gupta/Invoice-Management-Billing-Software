/**
 * Advanced Analytics Module
 * Provides comprehensive business insights
 */

class AnalyticsService {
  constructor(db) {
    this.db = db;
  }

  async getDashboardMetrics(companyId) {
    try {
      const metrics = {};

      // Total Revenue
      metrics.totalRevenue = await this.getTotalRevenue(companyId);

      // Invoices Status
      metrics.invoicesStatus = await this.getInvoicesStatus(companyId);

      // Top Clients
      metrics.topClients = await this.getTopClients(companyId);

      // Monthly Revenue Trend
      metrics.monthlyTrend = await this.getMonthlyRevenueTrend(companyId);

      // Outstanding Amount
      metrics.outstanding = await this.getOutstandingAmount(companyId);

      // Collection Metrics
      metrics.collectionRate = await this.getCollectionRate(companyId);

      // Average Invoice Value
      metrics.avgInvoiceValue = await this.getAverageInvoiceValue(companyId);

      // Payment Time Analysis
      metrics.avgPaymentTime = await this.getAveragePaymentTime(companyId);

      // Invoice Overdue Analysis
      metrics.overdueAnalysis = await this.getOverdueAnalysis(companyId);

      return metrics;
    } catch (error) {
      console.error('Analytics error:', error);
      return {};
    }
  }

  getTotalRevenue(companyId) {
    return new Promise((resolve, reject) => {
      const query = `SELECT SUM(total_paid) as total FROM invoices WHERE company_id = ? AND status = 'paid'`;
      this.db.get(query, [companyId], (err, row) => {
        if (err) reject(err);
        else resolve(row?.total || 0);
      });
    });
  }

  getInvoicesStatus(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          status,
          COUNT(*) as count,
          SUM(total_paid) as amount
        FROM invoices 
        WHERE company_id = ?
        GROUP BY status
      `;
      this.db.all(query, [companyId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  getTopClients(companyId, limit = 5) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          c.id,
          c.name,
          COUNT(i.id) as invoice_count,
          SUM(i.total_paid) as total_paid
        FROM clients c
        LEFT JOIN invoices i ON c.id = i.client_id
        WHERE c.company_id = ?
        GROUP BY c.id
        ORDER BY total_paid DESC
        LIMIT ?
      `;
      this.db.all(query, [companyId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  getMonthlyRevenueTrend(companyId, months = 12) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          strftime('%Y-%m', issue_date) as month,
          SUM(total_paid) as revenue,
          COUNT(*) as invoice_count
        FROM invoices
        WHERE company_id = ? AND status = 'paid'
        GROUP BY strftime('%Y-%m', issue_date)
        ORDER BY month DESC
        LIMIT ?
      `;
      this.db.all(query, [companyId, months], (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []).reverse());
      });
    });
  }

  getOutstandingAmount(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as count,
          SUM(COALESCE(total_paid, 0)) as pending_amount
        FROM invoices
        WHERE company_id = ? AND status IN ('sent', 'draft')
      `;
      this.db.get(query, [companyId], (err, row) => {
        if (err) reject(err);
        else resolve(row || { count: 0, pending_amount: 0 });
      });
    });
  }

  getCollectionRate(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          SUM(CASE WHEN status = 'paid' THEN total_paid ELSE 0 END) as collected,
          SUM(total_paid) as total
        FROM invoices
        WHERE company_id = ?
      `;
      this.db.get(query, [companyId], (err, row) => {
        if (err) reject(err);
        else {
          const collected = row?.collected || 0;
          const total = row?.total || 1;
          const rate = (collected / total) * 100;
          resolve(Math.round(rate));
        }
      });
    });
  }

  getAverageInvoiceValue(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT AVG(total_paid) as average
        FROM invoices
        WHERE company_id = ? AND status = 'paid'
      `;
      this.db.get(query, [companyId], (err, row) => {
        if (err) reject(err);
        else resolve(Math.round(row?.average || 0));
      });
    });
  }

  getAveragePaymentTime(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT AVG(
          julianday(p.payment_date) - julianday(i.issue_date)
        ) as avg_days
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        WHERE i.company_id = ?
      `;
      this.db.get(query, [companyId], (err, row) => {
        if (err) reject(err);
        else resolve(Math.round(row?.avg_days || 0));
      });
    });
  }

  getOverdueAnalysis(companyId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as count,
          SUM(total_paid) as amount,
          MAX(julianday('now') - julianday(due_date)) as days_overdue
        FROM invoices
        WHERE company_id = ? AND due_date < date('now') AND status != 'paid'
      `;
      this.db.get(query, [companyId], (err, row) => {
        if (err) reject(err);
        else resolve(row || { count: 0, amount: 0, days_overdue: 0 });
      });
    });
  }

  async getDetailedReport(companyId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          i.invoice_number,
          i.issue_date,
          i.due_date,
          i.status,
          i.total_paid,
          c.name as client_name,
          COUNT(p.id) as payment_count,
          SUM(p.amount) as payment_amount
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN payments p ON i.id = p.invoice_id
        WHERE i.company_id = ? 
        AND i.issue_date >= ? 
        AND i.issue_date <= ?
        GROUP BY i.id
        ORDER BY i.issue_date DESC
      `;
      this.db.all(query, [companyId, startDate, endDate], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = AnalyticsService;
