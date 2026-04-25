/**
 * Multi-Currency Support Module
 * Handles currency conversion and multi-currency invoices
 */

class CurrencyService {
  constructor() {
    this.exchangeRates = {
      'USD': 1,
      'INR': 83.2,
      'EUR': 0.92,
      'GBP': 0.79,
      'JPY': 149.5,
      'AUD': 1.52,
      'CAD': 1.36,
      'CNY': 7.24,
      'SGD': 1.35,
      'AED': 3.67
    };

    this.currencySymbols = {
      'USD': '$',
      'INR': '₹',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥',
      'AUD': 'A$',
      'CAD': 'C$',
      'CNY': '¥',
      'SGD': 'S$',
      'AED': 'د.إ'
    };
  }

  async fetchExchangeRates() {
    // In production, fetch from API like openexchangerates.org
    try {
      // Mock API call - replace with real API
      console.log('📊 Exchange rates updated');
      return this.exchangeRates;
    } catch (error) {
      console.error('Error fetching rates:', error);
      return this.exchangeRates;
    }
  }

  convertCurrency(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amount;

    const fromRate = this.exchangeRates[fromCurrency] || 1;
    const toRate = this.exchangeRates[toCurrency] || 1;

    const converted = (amount / fromRate) * toRate;
    return Math.round(converted * 100) / 100;
  }

  getSymbol(currency) {
    return this.currencySymbols[currency] || currency;
  }

  formatCurrency(amount, currency) {
    const symbol = this.getSymbol(currency);
    return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  getSupportedCurrencies() {
    return Object.keys(this.exchangeRates).map(code => ({
      code,
      symbol: this.currencySymbols[code],
      rate: this.exchangeRates[code]
    }));
  }

  async convertInvoiceCurrency(invoice, targetCurrency) {
    const converted = { ...invoice };
    converted.currency = targetCurrency;
    
    if (invoice.items) {
      converted.items = invoice.items.map(item => ({
        ...item,
        rate: this.convertCurrency(item.rate, invoice.currency, targetCurrency)
      }));
    }

    return converted;
  }

  calculateTotal(items, taxRate, currency) {
    let subtotal = 0;
    items.forEach(item => {
      subtotal += item.quantity * item.rate;
    });

    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    return {
      subtotal: this.formatCurrency(subtotal, currency),
      tax: this.formatCurrency(tax, currency),
      total: this.formatCurrency(total, currency),
      raw: { subtotal, tax, total }
    };
  }
}

module.exports = new CurrencyService();
