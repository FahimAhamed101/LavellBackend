const mongoose = require('mongoose');

const paymentRefundLogSchema = new mongoose.Schema({
  paymentIntentId: {
    type: String,
    required: true,
    index: true
  },
  refundId: {
    type: String,
    default: null,
    index: true
  },
  sourceModel: {
    type: String,
    enum: [
      'Booking',
      'BusinessOwnerBooking',
      'Appointment',
      'BusinessOwnerAppointment',
      'EventTicketPurchase'
    ],
    required: true
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  sourcePaymentField: {
    type: String,
    enum: ['paymentIntentId', 'duePaymentIntentId'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'usd'
  },
  status: {
    type: String,
    enum: ['requested', 'pending', 'succeeded', 'failed', 'canceled', 'requires_action'],
    default: 'requested',
    index: true
  },
  reason: {
    type: String,
    default: null
  },
  note: {
    type: String,
    default: null
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true
  },
  stripeError: {
    type: String,
    default: null
  },
  metadata: {
    type: Object,
    default: {}
  },
  refundedByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  }
}, {
  timestamps: true
});

paymentRefundLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PaymentRefundLog', paymentRefundLogSchema);
