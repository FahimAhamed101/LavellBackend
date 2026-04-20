const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  // Reference to Event Manager
  eventManagerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EventManager',
    required: true,
    index: true
  },

  // Event Image
  eventImage: {
    type: String, // Cloudinary URL
    required: false,
    default: null
  },

  // Event Name
  eventName: {
    type: String,
    required: [true, 'Event name is required'],
    trim: true,
    minlength: [3, 'Event name must be at least 3 characters'],
    maxlength: [200, 'Event name cannot exceed 200 characters']
  },

  // Event Type
  eventType: {
    type: String,
    required: [true, 'Event type is required'],
    enum: {
      values: ['Concert/Music Show', 'Cultural Program', 'Seminar/Conference', 'Sports Event', 'Festival/Fair'],
      message: '{VALUE} is not a valid event type'
    }
  },

  // Event Manager Name (for display purposes)
  eventManagerName: {
    type: String,
    required: [true, 'Event manager name is required'],
    trim: true,
    maxlength: [100, 'Event manager name cannot exceed 100 characters']
  },

  // Event Location
  eventLocation: {
    type: String,
    required: [true, 'Event location is required'],
    trim: true,
    maxlength: [500, 'Event location cannot exceed 500 characters']
  },

  // Ticket Sales Period
  ticketSalesStartDate: {
    type: Date,
    required: [true, 'Ticket sales start date is required'],
    validate: {
      validator: function(value) {
        // Ticket sales should start before they end
        return !this.ticketSalesEndDate || value < this.ticketSalesEndDate;
      },
      message: 'Ticket sales start date must be before end date'
    }
  },

  ticketSalesEndDate: {
    type: Date,
    required: [true, 'Ticket sales end date is required'],
    validate: {
      validator: function(value) {
        // Ticket sales should end before or at event start
        return !this.eventStartDateTime || value <= this.eventStartDateTime;
      },
      message: 'Ticket sales must end before or at event start time'
    }
  },

  // Event Period
  eventStartDateTime: {
    type: Date,
    required: [true, 'Event start date & time is required'],
    validate: {
      validator: function(value) {
        // Event should start before it ends
        return !this.eventEndDateTime || value < this.eventEndDateTime;
      },
      message: 'Event start date & time must be before end date & time'
    }
  },

  eventEndDateTime: {
    type: Date,
    required: [true, 'Event end date & time is required']
  },

  // Ticket Information
  ticketPrice: {
    type: Number,
    required: [true, 'Ticket price is required'],
    min: [0, 'Ticket price cannot be negative']
  },

  maximumNumberOfTickets: {
    type: Number,
    required: [true, 'Maximum number of tickets is required'],
    min: [1, 'Maximum number of tickets must be at least 1'],
    validate: {
      validator: Number.isInteger,
      message: 'Maximum number of tickets must be an integer'
    }
  },

  // Tickets sold counter
  ticketsSold: {
    type: Number,
    default: 0,
    min: 0
  },

  // Event rating summary (optional, used for sorting)
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },

  totalReviews: {
    type: Number,
    default: 0,
    min: 0
  },

  // Confirmation Code Configuration
  confirmationCodePrefix: {
    type: String,
    required: [true, 'Confirmation code prefix is required'],
    trim: true,
    uppercase: true,
    minlength: [2, 'Confirmation code prefix must be at least 2 characters'],
    maxlength: [10, 'Confirmation code prefix cannot exceed 10 characters'],
    match: [/^[A-Z0-9]+$/, 'Confirmation code prefix must contain only uppercase letters and numbers']
  },

  // Event Description
  eventDescription: {
    type: String,
    required: [true, 'Event description is required'],
    trim: true,
    minlength: [10, 'Event description must be at least 10 characters'],
    maxlength: [5000, 'Event description cannot exceed 5000 characters']
  },

  // Event Status
  status: {
    type: String,
    enum: ['draft', 'published', 'cancelled', 'completed'],
    default: 'draft'
  },

  // Stored ticket sales active flag (kept in sync on save)
  isTicketSalesActiveStored: {
    type: Boolean,
    default: false
  },

  // Publication Date
  publishedAt: {
    type: Date,
    default: null
  },

  // Cancellation Information
  cancellationReason: {
    type: String,
    trim: true,
    default: null
  },

  cancelledAt: {
    type: Date,
    default: null
  }

}, {
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Indexes for better query performance
eventSchema.index({ eventManagerId: 1, status: 1 });
eventSchema.index({ eventType: 1 });
eventSchema.index({ eventStartDateTime: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ confirmationCodePrefix: 1 });

// Compound indexes for homepage event queries
eventSchema.index({
  status: 1,
  ticketSalesStartDate: 1,
  ticketSalesEndDate: 1,
  eventStartDateTime: 1
});

eventSchema.index({
  status: 1,
  ticketsSold: -1
});

eventSchema.index({
  status: 1,
  ticketsSold: -1,
  rating: -1
});

eventSchema.index({
  status: 1,
  eventType: 1,
  ticketsSold: -1
});

// Virtual to check if tickets are available
eventSchema.virtual('ticketsAvailable').get(function() {
  return this.maximumNumberOfTickets - this.ticketsSold;
});

// Virtual to check if event is sold out
eventSchema.virtual('isSoldOut').get(function() {
  return this.ticketsSold >= this.maximumNumberOfTickets;
});

// Virtual to check if ticket sales are active
eventSchema.virtual('isTicketSalesActive').get(function() {
  const now = new Date();
  return this.status === 'published' &&
         now >= this.ticketSalesStartDate &&
         now <= this.ticketSalesEndDate &&
         !this.isSoldOut;
});

// Virtual to check if event has started
eventSchema.virtual('hasStarted').get(function() {
  return new Date() >= this.eventStartDateTime;
});

// Virtual to check if event has ended
eventSchema.virtual('hasEnded').get(function() {
  return new Date() >= this.eventEndDateTime;
});

// Virtual populate to get event manager details
eventSchema.virtual('eventManager', {
  ref: 'EventManager',
  localField: 'eventManagerId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
eventSchema.set('toJSON', { virtuals: true });
eventSchema.set('toObject', { virtuals: true });

function computeTicketSalesActive(eventDoc) {
  const now = new Date();
  if (!eventDoc.ticketSalesStartDate || !eventDoc.ticketSalesEndDate) {
    return false;
  }
  return eventDoc.status === 'published' &&
    now >= eventDoc.ticketSalesStartDate &&
    now <= eventDoc.ticketSalesEndDate &&
    eventDoc.ticketsSold < eventDoc.maximumNumberOfTickets;
}

// Pre-save middleware to validate dates
eventSchema.pre('save', function(next) {
  // Ensure all date validations are met
  if (this.ticketSalesStartDate >= this.ticketSalesEndDate) {
    return next(new Error('Ticket sales start date must be before end date'));
  }

  if (this.ticketSalesEndDate > this.eventStartDateTime) {
    return next(new Error('Ticket sales must end before or at event start time'));
  }

  if (this.eventStartDateTime >= this.eventEndDateTime) {
    return next(new Error('Event start date & time must be before end date & time'));
  }

  this.isTicketSalesActiveStored = computeTicketSalesActive(this);

  next();
});

// Method to publish event
eventSchema.methods.publish = function() {
  this.status = 'published';
  this.publishedAt = new Date();
  return this.save();
};

// Method to cancel event
eventSchema.methods.cancel = function(reason) {
  this.status = 'cancelled';
  this.cancellationReason = reason;
  this.cancelledAt = new Date();
  return this.save();
};

// Method to complete event
eventSchema.methods.complete = function() {
  this.status = 'completed';
  return this.save();
};

// Static method to get upcoming published events
eventSchema.statics.getUpcomingEvents = function(limit = 10) {
  return this.find({
    status: 'published',
    eventStartDateTime: { $gte: new Date() }
  })
  .sort({ eventStartDateTime: 1 })
  .limit(limit);
};

// Static method to get events by event manager
eventSchema.statics.getEventsByManager = function(eventManagerId) {
  return this.find({ eventManagerId })
    .sort({ createdAt: -1 });
};

// Static method to get available events for homepage
eventSchema.statics.getAvailableEvents = function(options = {}) {
  const { eventType, limit = 20, sortBy = 'ticketsSold' } = options;
  const now = new Date();

  const query = {
    status: 'published',
    ticketSalesStartDate: { $lte: now },
    ticketSalesEndDate: { $gte: now },
    eventStartDateTime: { $gt: now }
  };

  if (eventType) {
    query.eventType = eventType;
  }

  const sortOptions = {
    ticketsSold: { ticketsSold: -1 },
    date: { eventStartDateTime: 1 }
  };

  return this.find(query)
    .sort(sortOptions[sortBy] || sortOptions.ticketsSold)
    .limit(limit);
};

module.exports = mongoose.model('Event', eventSchema);
