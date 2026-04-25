/**
 * PDF Generation Module
 * Generates professional PDF invoices
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFGenerator {
  static generateInvoicePDF(invoiceData, outputPath) {
    return new Promise((resolve, reject) => {
      try {
        // Create PDF document
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);

        doc.pipe(stream);

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', 50, 50);
        doc.fontSize(10).font('Helvetica').text(`Invoice #: ${invoiceData.invoice_number}`, 50, 80);
        doc.text(`Date: ${invoiceData.issue_date}`, 50, 95);
        doc.text(`Due Date: ${invoiceData.due_date}`, 50, 110);

        // Company Info
        doc.fontSize(12).font('Helvetica-Bold').text('From:', 50, 140);
        doc.fontSize(10).font('Helvetica')
          .text(invoiceData.company_name || 'Your Company', 50, 160)
          .text(invoiceData.company_email || 'email@company.com', 50, 175)
          .text(invoiceData.company_phone || 'Phone', 50, 190);

        // Client Info
        doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', 350, 140);
        doc.fontSize(10).font('Helvetica')
          .text(invoiceData.client_name || 'Client Name', 350, 160)
          .text(invoiceData.client_email || 'client@example.com', 350, 175)
          .text(invoiceData.client_phone || 'Phone', 350, 190);

        // Items Table
        const tableTop = 250;
        const col1 = 50, col2 = 280, col3 = 400, col4 = 500;

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Description', col1, tableTop);
        doc.text('Qty', col2, tableTop);
        doc.text('Rate', col3, tableTop);
        doc.text('Amount', col4, tableTop);

        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

        // Items
        let y = tableTop + 30;
        let subtotal = 0;

        if (invoiceData.items && invoiceData.items.length > 0) {
          invoiceData.items.forEach(item => {
            const amount = item.quantity * item.rate;
            subtotal += amount;

            doc.fontSize(10).font('Helvetica');
            doc.text(item.description, col1, y, { width: 200 });
            doc.text(item.quantity.toString(), col2, y);
            doc.text(item.rate.toFixed(2), col3, y);
            doc.text(amount.toFixed(2), col4, y);

            y += 25;
          });
        }

        // Totals
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 15;

        const taxAmount = subtotal * (invoiceData.tax_rate / 100);
        const total = subtotal + taxAmount;

        doc.fontSize(10).font('Helvetica');
        doc.text('Subtotal:', col3, y);
        doc.text(subtotal.toFixed(2), col4, y);

        y += 20;
        doc.text(`Tax (${invoiceData.tax_rate}%):`, col3, y);
        doc.text(taxAmount.toFixed(2), col4, y);

        y += 20;
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('Total:', col3, y);
        doc.text(total.toFixed(2), col4, y);

        // Payment Info
        y += 50;
        doc.fontSize(10).font('Helvetica-Bold').text('Payment Terms:', 50, y);
        doc.font('Helvetica').text('Please remit payment by due date.', 50, y + 15);

        // Footer
        doc.fontSize(8).font('Helvetica').text('Thank you for your business!', 50, 750, { align: 'center' });

        doc.end();

        stream.on('finish', () => resolve(outputPath));
        stream.on('error', (err) => reject(err));
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = PDFGenerator;
