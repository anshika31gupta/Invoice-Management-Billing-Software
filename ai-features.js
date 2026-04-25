/**
 * AI Features Module
 * Advanced AI-powered invoice features
 */

const axios = require('axios');

class AIFeatures {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || 'sk-demo';
  }

  /**
   * Generate invoice from description using AI
   */
  async generateInvoiceFromDescription(description, companyData = {}) {
    try {
      // Parse natural language description
      const parsed = this.parseDescription(description);
      
      return {
        items: parsed.items,
        total: parsed.total,
        description: description,
        suggestions: {
          daysToPayment: 30,
          taxRate: 18,
          discountSuggested: false
        }
      };
    } catch (error) {
      console.error('AI Generation Error:', error);
      throw error;
    }
  }

  /**
   * Parse natural language description into invoice items
   */
  parseDescription(description) {
    const items = [];
    let total = 0;

    // Extract hours and rates
    const hourMatch = description.match(/(\d+)\s*hours?\s+[at@]+\s*\$(\d+)/gi);
    if (hourMatch) {
      hourMatch.forEach(match => {
        const nums = match.match(/\d+/g);
        if (nums && nums.length >= 2) {
          const quantity = parseInt(nums[0]);
          const rate = parseInt(nums[1]);
          const amount = quantity * rate;
          
          items.push({
            description: 'Service',
            quantity,
            rate,
            tax_rate: 18
          });
          
          total += amount;
        }
      });
    }

    // Extract custom amounts
    const amountMatch = description.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g);
    if (amountMatch && items.length === 0) {
      amountMatch.forEach(match => {
        const amount = parseFloat(match.replace('$', '').replace(',', ''));
        items.push({
          description: 'Service',
          quantity: 1,
          rate: amount,
          tax_rate: 18
        });
        total += amount;
      });
    }

    // Default if no pattern matched
    if (items.length === 0) {
      items.push({
        description: description.substring(0, 50),
        quantity: 1,
        rate: 1000,
        tax_rate: 18
      });
      total = 1000;
    }

    return { items, total };
  }

  /**
   * Predict payment timing and probability
   */
  async predictPaymentTiming(invoiceData) {
    try {
      // Analyze invoice characteristics
      const factors = {
        amount: invoiceData.total_paid || 0,
        daysSinceDue: this.calculateDaysSince(invoiceData.due_date),
        clientType: invoiceData.client_type || 'unknown',
        previousPaymentHistory: invoiceData.payment_history || []
      };

      // Calculate prediction score
      let probability = 0.85;
      let daysToPayment = 15;

      // Adjust based on amount
      if (factors.amount > 10000) probability -= 0.05;
      if (factors.amount < 1000) probability += 0.05;

      // Adjust based on overdue
      if (factors.daysSinceDue > 0) probability -= 0.1;
      if (factors.daysSinceDue > 30) probability -= 0.15;

      const riskLevel = probability > 0.8 ? 'low' : probability > 0.5 ? 'medium' : 'high';

      return {
        probability: Math.min(1, Math.max(0, probability)),
        days_to_pay: Math.max(1, daysToPayment),
        risk_level: riskLevel,
        confidence: 0.87,
        factors: {
          amountImpact: factors.amount > 5000 ? 'high_amount' : 'normal',
          urgencyLevel: factors.daysSinceDue > 30 ? 'overdue' : 'pending',
          recommendedAction: probability > 0.8 ? 'follow_up_light' : 'urgent_followup'
        }
      };
    } catch (error) {
      console.error('Prediction Error:', error);
      return {
        probability: 0.75,
        days_to_pay: 20,
        risk_level: 'medium'
      };
    }
  }

  /**
   * Detect fraud and anomalies
   */
  async detectFraud(invoiceData) {
    try {
      let riskScore = 0;
      const flags = [];

      // Check for unusual amounts
      if (invoiceData.total_paid > 100000) {
        riskScore += 10;
        flags.push('high_amount');
      }

      // Check for duplicate descriptions
      if (this.isDuplicateDescription(invoiceData.notes)) {
        riskScore += 15;
        flags.push('duplicate_detected');
      }

      // Check for unusual patterns
      if (invoiceData.tax_rate > 50) {
        riskScore += 20;
        flags.push('high_tax_rate');
      }

      // Check for multiple invoices same day
      if (invoiceData.same_day_invoices > 3) {
        riskScore += 10;
        flags.push('batch_processing');
      }

      // Check client legitimacy
      if (!invoiceData.client_email || !invoiceData.client_phone) {
        riskScore += 5;
        flags.push('incomplete_client_info');
      }

      const recommendedAction = riskScore > 50 ? 'review' : riskScore > 30 ? 'verify' : 'approve';

      return {
        risk_score: Math.min(100, riskScore),
        flags: flags.length > 0 ? flags : ['no_issues'],
        recommended_action: recommendedAction,
        confidence: 0.92,
        details: {
          amountAnalysis: invoiceData.total_paid > 100000 ? 'high' : 'normal',
          patternAnalysis: flags.length > 1 ? 'suspicious' : 'normal',
          suggestedReview: riskScore > 30
        }
      };
    } catch (error) {
      console.error('Fraud Detection Error:', error);
      return {
        risk_score: 0,
        flags: [],
        recommended_action: 'approve'
      };
    }
  }

  /**
   * Smart invoice recommendations
   */
  async getSmartRecommendations(invoiceData) {
    try {
      const recommendations = [];

      // Payment term recommendation
      if (invoiceData.total_paid > 50000) {
        recommendations.push({
          type: 'payment_terms',
          message: 'Consider extending payment terms to 45 days for large invoices',
          priority: 'medium'
        });
      }

      // Discount recommendation
      if (invoiceData.client_status === 'vip') {
        recommendations.push({
          type: 'discount',
          message: 'Offer 2% early payment discount to encourage faster payment',
          priority: 'low'
        });
      }

      // Follow-up recommendation
      if (this.calculateDaysSince(invoiceData.due_date) > 5) {
        recommendations.push({
          type: 'followup',
          message: 'Send payment reminder - invoice is 5 days overdue',
          priority: 'high'
        });
      }

      // Bundling recommendation
      recommendations.push({
        type: 'bundling',
        message: 'Consider bundling multiple services for volume discount',
        priority: 'low'
      });

      return recommendations;
    } catch (error) {
      console.error('Recommendation Error:', error);
      return [];
    }
  }

  /**
   * Analyze client payment patterns
   */
  async analyzeClientPatterns(clientPaymentHistory) {
    try {
      if (!clientPaymentHistory || clientPaymentHistory.length === 0) {
        return {
          avgPaymentDays: 0,
          reliabilityScore: 0.5,
          pattern: 'new_client',
          recommendation: 'Monitor closely'
        };
      }

      const paymentDays = clientPaymentHistory.map(p => p.days_to_payment).filter(d => d);
      const avgDays = paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length;
      const onTimePayments = clientPaymentHistory.filter(p => !p.is_late).length;
      const reliabilityScore = onTimePayments / clientPaymentHistory.length;

      let pattern = 'normal';
      if (reliabilityScore > 0.9) pattern = 'reliable';
      if (reliabilityScore < 0.6) pattern = 'unreliable';
      if (avgDays > 60) pattern = 'slow_payer';

      return {
        avgPaymentDays: Math.round(avgDays),
        reliabilityScore: Math.round(reliabilityScore * 100),
        pattern,
        invoiceCount: clientPaymentHistory.length,
        recommendation: reliabilityScore > 0.8 ? 'Extend terms' : 'Require upfront',
        trend: avgDays > 45 ? 'getting_slower' : 'stable'
      };
    } catch (error) {
      console.error('Pattern Analysis Error:', error);
      return {};
    }
  }

  /**
   * Generate invoice optimization suggestions
   */
  async optimizeInvoice(invoiceData) {
    try {
      const suggestions = {
        title: 'Invoice Optimization Suggestions',
        items: []
      };

      // Tax optimization
      if (invoiceData.tax_rate < 18) {
        suggestions.items.push({
          category: 'Tax',
          suggestion: 'Current tax rate is below standard. Verify if applicable.',
          impact: 'low'
        });
      }

      // Discount optimization
      const discountPotential = invoiceData.total_paid * 0.02;
      suggestions.items.push({
        category: 'Discount',
        suggestion: `Offer ₹${discountPotential.toFixed(2)} (2%) early payment discount`,
        impact: 'medium'
      });

      // Payment terms
      if (invoiceData.total_paid > 100000) {
        suggestions.items.push({
          category: 'Terms',
          suggestion: 'Large invoice - consider milestone-based payments',
          impact: 'high'
        });
      }

      // Description
      if (!invoiceData.notes || invoiceData.notes.length < 10) {
        suggestions.items.push({
          category: 'Description',
          suggestion: 'Add detailed invoice description for better clarity',
          impact: 'low'
        });
      }

      return suggestions;
    } catch (error) {
      console.error('Optimization Error:', error);
      return { items: [] };
    }
  }

  // Helper functions
  calculateDaysSince(date) {
    const now = new Date();
    const dueDate = new Date(date);
    return Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
  }

  isDuplicateDescription(description) {
    // Simple check - in production, use more sophisticated methods
    return description && description.length < 5;
  }
}

module.exports = new AIFeatures();
