const mongoose = require('mongoose');

/**
 * Business Owner Appointment Model - For employee services (appointmentEnabled = true)
 */
const businessOwnerAppointmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  employeeServiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmployeeService',
    required: [true, 'Employee service ID is required']
  },
  businessOwnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BusinessOwner',
    required: [true, 'Business owner ID is required']
  },
  appointmentDate: {
    type: Date,
    required: [true, 'Appointment date is required'],
    validate: {
      validator: function(v) {
        // Enforce only when creating or explicitly changing appointmentDate.
        if (!this.isNew && !this.isModified('appointmentDate')) {
          return true;
        }
        return v >= new Date();
      },
      message: 'Appointment date must be in the future'
    }
  },
  timeSlot: {
    startTime: {
      type: String,
      required: [true, 'Start time is required'],
      validate: {
        validator: function(v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'Start time must be in HH:MM format'
      }
    },
    endTime: {
      type: String,
      required: [true, 'End time is required'],
      validate: {
        validator: function(v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: 'End time must be in HH:MM format'
      }
    }
  },
  selectedSlot: {
    duration: {
      type: Number,
      required: true,
      min: 1
    },
    durationUnit: {
      type: String,
      enum: ['minutes'],
      default: 'minutes'
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
  serviceSnapshot: {
    serviceName: String,
    servicePhoto: String,
    headline: String,
    categories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category'
    }]
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
  businessOwnerPayoutFromPayment: {
    type: Number,
    default: 0,
    min: 0
  },
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
  appointmentStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rejected', 'no_show'],
    default: 'pending'
  },
  userNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  providerNotes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  cancellationReason: {
    type: String,
    trim: true
  },
  cancelledBy: {
    type: String,
    enum: ['user', 'business_owner', 'admin']
  },
  cancelledAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
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
  reminderSent: {
    type: Boolean,
    default: false
  },
  reminderSentAt: {
    type: Date
  },
  moderationStatus: {
    type: String,
    enum: ['active', 'hidden_by_admin'],
    default: 'active'
  },
  moderationReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Moderation reason cannot exceed 500 characters'],
    default: null
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  moderatedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

businessOwnerAppointmentSchema.index({ userId: 1, createdAt: -1 });
businessOwnerAppointmentSchema.index({ businessOwnerId: 1, appointmentDate: 1 });
businessOwnerAppointmentSchema.index({ employeeServiceId: 1 });
businessOwnerAppointmentSchema.index({ appointmentStatus: 1 });
businessOwnerAppointmentSchema.index({ appointmentDate: 1, 'timeSlot.startTime': 1 });
businessOwnerAppointmentSchema.index({ moderationStatus: 1, reviewedAt: -1 });

businessOwnerAppointmentSchema.pre('validate', function(next) {
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

businessOwnerAppointmentSchema.pre('save', function(next) {
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

businessOwnerAppointmentSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

businessOwnerAppointmentSchema.virtual('service', {
  ref: 'EmployeeService',
  localField: 'employeeServiceId',
  foreignField: '_id',
  justOne: true
});

businessOwnerAppointmentSchema.virtual('businessOwner', {
  ref: 'BusinessOwner',
  localField: 'businessOwnerId',
  foreignField: '_id',
  justOne: true
});

businessOwnerAppointmentSchema.set('toJSON', { virtuals: true });
businessOwnerAppointmentSchema.set('toObject', { virtuals: true });

businessOwnerAppointmentSchema.methods.cancel = function(reason, cancelledBy) {
  this.appointmentStatus = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledBy = cancelledBy;
  this.cancelledAt = new Date();
  return this.save();
};

businessOwnerAppointmentSchema.methods.confirm = function() {
  this.appointmentStatus = 'confirmed';
  return this.save();
};

businessOwnerAppointmentSchema.methods.complete = function() {
  this.appointmentStatus = 'completed';
  this.completedAt = new Date();
  return this.save();
};

businessOwnerAppointmentSchema.methods.markNoShow = function() {
  this.appointmentStatus = 'no_show';
  return this.save();
};

businessOwnerAppointmentSchema.methods.hasTimeConflict = async function() {
  const BusinessOwnerAppointment = this.constructor;

  const conflictingAppointments = await BusinessOwnerAppointment.find({
    employeeServiceId: this.employeeServiceId,
    appointmentDate: this.appointmentDate,
    appointmentStatus: { $in: ['pending', 'confirmed'] },
    _id: { $ne: this._id },
    $or: [
      {
        'timeSlot.startTime': { $lte: this.timeSlot.startTime },
        'timeSlot.endTime': { $gt: this.timeSlot.startTime }
      },
      {
        'timeSlot.startTime': { $lt: this.timeSlot.endTime },
        'timeSlot.endTime': { $gte: this.timeSlot.endTime }
      },
      {
        'timeSlot.startTime': { $gte: this.timeSlot.startTime },
        'timeSlot.endTime': { $lte: this.timeSlot.endTime }
      }
    ]
  });

  return conflictingAppointments.length > 0;
};

module.exports = mongoose.model('BusinessOwnerAppointment', businessOwnerAppointmentSchema);
