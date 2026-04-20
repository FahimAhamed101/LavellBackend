const mongoose = require('mongoose');

/**
 * Appointment Model - For appointment-based service bookings (when appointmentEnabled = true)
 * User can select:
 * - Service name (from provider's service)
 * - Date
 * - Provider available time (from appointmentSlots)
 * - Duration/hours
 * - Notes
 */
const appointmentSchema = new mongoose.Schema({
  // Reference to User who made the appointment
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  // Reference to Service
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: [true, 'Service ID is required']
  },
  // Reference to Provider who owns the service
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Provider',
    required: [true, 'Provider ID is required']
  },
  // Appointment Date
  appointmentDate: {
    type: Date,
    required: [true, 'Appointment date is required'],
    validate: {
      validator: function(v) {
        // Enforce only when creating or explicitly changing appointmentDate.
        if (!this.isNew && !this.isModified('appointmentDate')) {
          return true;
        }
        // Date should be in the future.
        return v >= new Date();
      },
      message: 'Appointment date must be in the future'
    }
  },
  // Appointment Time Slot
  timeSlot: {
    startTime: {
      type: String, // Format: "HH:MM" (24-hour format) e.g., "09:00"
      required: [true, 'Start time is required'],
      validate: {
        validator: function(v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'Start time must be in HH:MM format'
      }
    },
    endTime: {
      type: String, // Format: "HH:MM" (24-hour format) e.g., "17:00"
      required: [true, 'End time is required'],
      validate: {
        validator: function(v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'End time must be in HH:MM format'
      }
    }
  },
  // Selected Duration from appointmentSlots
  selectedSlot: {
    duration: {
      type: Number,
      required: true,
      min: 1
    },
    durationUnit: {
      type: String,
      enum: ['minutes', 'hours'],
      default: 'hours'
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    }
  },
  // Service details snapshot (to preserve info even if service is modified later)
  serviceSnapshot: {
    serviceName: String,
    servicePhoto: String,
    headline: String,
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }
  },
  // Total Amount (from selected slot price)
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  // Platform fee (percentage of total)
  platformFee: {
    type: Number,
    default: 0,
    min: 0
  },
  // Provider payout from payment after fee
  providerPayoutFromPayment: {
    type: Number,
    default: 0,
    min: 0
  },
  // Payment tracking
  downPayment: {
    type: Number,
    default: 0,
    min: 0
  },
  remainingAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Payment Status
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed', 'offline_paid', 'refunded'],
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
  paidVia: {
    type: String,
    enum: ['online', 'offline', null],
    default: null
  },
  paidAt: {
    type: Date,
    default: null
  },
  // Appointment Status
  appointmentStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rejected', 'no_show'],
    default: 'pending'
  },
  // Notes from User
  userNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  // Provider Notes/Response
  providerNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Provider notes cannot exceed 500 characters']
  },
  // Cancellation Details
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledBy: {
    type: String,
    enum: ['user', 'provider', 'admin']
  },
  cancelledAt: {
    type: Date
  },
  // Completion Details
  completedAt: {
    type: Date
  },
  // Review/Rating
  rating: {
    type: Number,
    min: 0,
    max: 5
  },
  review: {
    type: String,
    trim: true,
    maxlength: [500, 'Review cannot exceed 500 characters']
  },
  reviewedAt: {
    type: Date
  },
  // Reminder sent flags
  reminderSent: {
    type: Boolean,
    default: false
  },
  reminderSentAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for faster queries
appointmentSchema.index({ userId: 1, createdAt: -1 });
appointmentSchema.index({ providerId: 1, appointmentDate: 1 });
appointmentSchema.index({ serviceId: 1 });
appointmentSchema.index({ appointmentStatus: 1 });
appointmentSchema.index({ appointmentDate: 1, 'timeSlot.startTime': 1 });

// Validate that end time is after start time
appointmentSchema.pre('validate', function(next) {
  if (this.timeSlot && this.timeSlot.startTime && this.timeSlot.endTime) {
    const [startHour, startMin] = this.timeSlot.startTime.split(':').map(Number);
    const [endHour, endMin] = this.timeSlot.endTime.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (endMinutes <= startMinutes) {
      return next(new Error('End time must be after start time'));
    }
  }
  next();
});

// Calculate remaining amount before saving
appointmentSchema.pre('save', function(next) {
  if (this.totalAmount !== undefined && this.downPayment !== undefined) {
    if (this.paymentStatus === 'completed' || this.paymentStatus === 'offline_paid') {
      this.remainingAmount = 0;
    } else {
      this.remainingAmount = this.totalAmount - this.downPayment;
    }

    if (this.paymentStatus === 'completed' || this.paymentStatus === 'offline_paid') {
      // keep as-is
    } else if (this.remainingAmount <= 0) {
      this.paymentStatus = 'completed';
    } else if (this.downPayment > 0) {
      this.paymentStatus = 'partial';
    } else {
      this.paymentStatus = 'pending';
    }
  }
  next();
});

// Virtual populate
appointmentSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

appointmentSchema.virtual('service', {
  ref: 'Service',
  localField: 'serviceId',
  foreignField: '_id',
  justOne: true
});

appointmentSchema.virtual('provider', {
  ref: 'Provider',
  localField: 'providerId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
appointmentSchema.set('toJSON', { virtuals: true });
appointmentSchema.set('toObject', { virtuals: true });

// Methods
appointmentSchema.methods.cancel = function(reason, cancelledBy) {
  this.appointmentStatus = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;
  this.cancelledAt = new Date();
  return this.save();
};

appointmentSchema.methods.confirm = function() {
  this.appointmentStatus = 'confirmed';
  return this.save();
};

appointmentSchema.methods.complete = function() {
  this.appointmentStatus = 'completed';
  this.completedAt = new Date();
  return this.save();
};

appointmentSchema.methods.markNoShow = function() {
  this.appointmentStatus = 'no_show';
  return this.save();
};

// Helper method to check if appointment time conflicts with another
appointmentSchema.methods.hasTimeConflict = async function() {
  const Appointment = this.constructor;

  const conflictingAppointments = await Appointment.find({
    providerId: this.providerId,
    appointmentDate: this.appointmentDate,
    appointmentStatus: { $in: ['pending', 'confirmed'] },
    _id: { $ne: this._id }, // Exclude current appointment
    $or: [
      // Check if new appointment's start time falls within existing appointment
      {
        'timeSlot.startTime': { $lte: this.timeSlot.startTime },
        'timeSlot.endTime': { $gt: this.timeSlot.startTime }
      },
      // Check if new appointment's end time falls within existing appointment
      {
        'timeSlot.startTime': { $lt: this.timeSlot.endTime },
        'timeSlot.endTime': { $gte: this.timeSlot.endTime }
      },
      // Check if new appointment completely overlaps existing appointment
      {
        'timeSlot.startTime': { $gte: this.timeSlot.startTime },
        'timeSlot.endTime': { $lte: this.timeSlot.endTime }
      }
    ]
  });

  return conflictingAppointments.length > 0;
};

module.exports = mongoose.model('Appointment', appointmentSchema);
