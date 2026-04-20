const mongoose = require('mongoose');

const ticketOwnerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  identificationType: {
    type: String,
    required: true,
    trim: true
  },
  identificationNumber: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const eventTicketPurchaseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
    index: true
  },
  eventManagerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EventManager',
    required: true,
    index: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  ticketOwners: {
    type: [ticketOwnerSchema],
    validate: {
      validator: function(value) {
        return Array.isArray(value) && value.length === this.quantity;
      },
      message: 'ticketOwners length must match quantity'
    }
  },
  ticketPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    default: 0,
    min: 0
  },
  eventManagerPayout: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentIntentId: {
    type: String,
    default: null
  },
  paymentIntentStatus: {
    type: String,
    default: null
  },
  checkoutSessionId: {
    type: String,
    default: null
  },
  checkoutSessionUrl: {
    type: String,
    default: null
  },
  paidAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

eventTicketPurchaseSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.model('EventTicketPurchase', eventTicketPurchaseSchema);
