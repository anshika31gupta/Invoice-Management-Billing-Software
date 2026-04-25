/**
 * Email Service Module
 * Sends invoices via email
 */

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // Configure email service (using Gmail/SMTP)
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'your-app-password'
      }
    });
  }

  async sendInvoiceEmail(toEmail, invoiceData, pdfPath = null) {
    try {
      const mailOptions = {
        from: process.env.EMAIL_USER || 'invoiceai@example.com',
        to: toEmail,
        subject: `Invoice #${invoiceData.invoice_number} from ${invoiceData.company_name}`,
        html: this.getInvoiceEmailTemplate(invoiceData),
        attachments: []
      };

      // Attach PDF if provided
      if (pdfPath) {
        mailOptions.attachments.push({
          filename: `invoice-${invoiceData.invoice_number}.pdf`,
          path: pdfPath
        });
      }

      const info = await this.transporter.sendMail(mailOptions);
      console.log('✉️ Email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Email error:', error);
      return { success: false, error: error.message };
    }
  }

  getInvoiceEmailTemplate(invoice) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2>Invoice #${invoice.invoice_number}</h2>
          <p>Dear ${invoice.client_name},</p>
          <p>We have sent you an invoice for services rendered. Please find the details below:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #ddd; padding: 10px; text-align: left;">Description</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">Quantity</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">Rate</th>
              <th style="border: 1px solid #ddd; padding: 10px; text-align: right;">Amount</th>
            </tr>
            ${invoice.items ? invoice.items.map(item => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 10px;">${item.description}</td>
                <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">${item.quantity}</td>
                <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">₹${item.rate.toFixed(2)}</td>
                <td style="border: 1px solid #ddd; padding: 10px; text-align: right;">₹${(item.quantity * item.rate).toFixed(2)}</td>
              </tr>
            `).join('') : ''}
          </table>

          <p><strong>Issue Date:</strong> ${invoice.issue_date}</p>
          <p><strong>Due Date:</strong> ${invoice.due_date}</p>
          <p><strong>Total Amount Due:</strong> ₹${invoice.total_amount || 0}</p>

          <p>Please make payment by the due date. If you have any questions, please reply to this email.</p>

          <p>Thank you for your business!</p>
          <p>Best regards,<br>${invoice.company_name || 'InvoiceAI'}</p>
        </body>
      </html>
    `;
  }

  async sendPaymentReminder(toEmail, invoiceData) {
    try {
      const daysOverdue = Math.floor((new Date() - new Date(invoiceData.due_date)) / (1000 * 60 * 60 * 24));
      
      const mailOptions = {
        from: process.env.EMAIL_USER || 'invoiceai@example.com',
        to: toEmail,
        subject: `Payment Reminder: Invoice #${invoiceData.invoice_number} is ${daysOverdue} days overdue`,
        html: `
          <html>
            <body style="font-family: Arial, sans-serif; color: #333;">
              <h2>Payment Reminder</h2>
              <p>Dear ${invoiceData.client_name},</p>
              <p>This is a friendly reminder that invoice <strong>#${invoiceData.invoice_number}</strong> is now <strong>${daysOverdue} days overdue</strong>.</p>
              <p><strong>Invoice Details:</strong></p>
              <ul>
                <li>Invoice #: ${invoiceData.invoice_number}</li>
                <li>Amount Due: ₹${invoiceData.total_amount || 0}</li>
                <li>Original Due Date: ${invoiceData.due_date}</li>
              </ul>
              <p>Please remit payment at your earliest convenience. Thank you!</p>
              <p>Best regards,<br>${invoiceData.company_name || 'InvoiceAI'}</p>
            </body>
          </html>
        `
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('✉️ Reminder email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Reminder email error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();
