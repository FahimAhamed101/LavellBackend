
const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');
const EmployeeService = require('../models/EmployeeService');
const BusinessOwner = require('../models/BusinessOwner');
const { createAndSend } = require('../utility/notificationService');
const { getStripe } = require('../utility/stripe');

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const notifyBusinessOwner = async ({
  businessOwnerId,
  title,
  body,
  type,
  entityType,
  entityId,
  metadata
}) => {
  const businessOwner = await BusinessOwner.findById(businessOwnerId).select('userId');
  if (!businessOwner?.userId) return null;

  return createAndSend({
    userId: businessOwner.userId,
    userType: 'businessOwner',
    title,
    body,
    type,
    entityType,
    entityId,
    metadata,
    data: {
      type,
      entityType,
      entityId: entityId ? entityId.toString() : ''
    }
  });
};

const updateEmployeeServiceRating = async (employeeServiceId) => {
  const [bookingStats, appointmentStats] = await Promise.all([
    BusinessOwnerBooking.aggregate([
      {
        $match: {
          employeeServiceId: employeeServiceId,
          rating: { $ne: null },
          $or: [
            { moderationStatus: { $exists: false } },
            { moderationStatus: 'active' }
          ]
        }
      },
      {
        $group: {
          _id: '$employeeServiceId',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]),
    BusinessOwnerAppointment.aggregate([
      {
        $match: {
          employeeServiceId: employeeServiceId,
          rating: { $ne: null },
          $or: [
            { moderationStatus: { $exists: false } },
            { moderationStatus: 'active' }
          ]
        }
      },
      {
        $group: {
          _id: '$employeeServiceId',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ])
  ]);

  const bookingCount = bookingStats[0]?.totalReviews || 0;
  const bookingAvg = bookingStats[0]?.avgRating || 0;
  const appointmentCount = appointmentStats[0]?.totalReviews || 0;
  const appointmentAvg = appointmentStats[0]?.avgRating || 0;

  const totalReviews = bookingCount + appointmentCount;
  const weightedSum = (bookingAvg * bookingCount) + (appointmentAvg * appointmentCount);
  const avgRating = totalReviews > 0 ? (weightedSum / totalReviews) : 0;

  await EmployeeService.findByIdAndUpdate(employeeServiceId, {
    rating: Math.round(avgRating * 10) / 10,
    totalReviews: totalReviews
  });
};

const getBusinessOwnerFromUser = async (userId) => {
  const businessOwner = await BusinessOwner.findOne({ userId });
  if (!businessOwner) {
    throw new Error('Business owner profile not found');
  }
  return businessOwner;
};

const toObjectIdString = (value) => {
  if (!value) return '';
  return value.toString();
};

const getBusinessOwnerOwnershipIds = (businessOwner) => {
  const ids = new Set();
  const ownerId = toObjectIdString(businessOwner?._id);
  const ownerUserId = toObjectIdString(businessOwner?.userId);

  if (ownerId) ids.add(ownerId);
  if (ownerUserId) ids.add(ownerUserId);

  return Array.from(ids);
};

const buildBusinessOwnerOwnershipQuery = (businessOwner) => {
  const ownerIds = getBusinessOwnerOwnershipIds(businessOwner);
  if (ownerIds.length <= 1) {
    return ownerIds[0] || toObjectIdString(businessOwner?._id);
  }
  return { $in: ownerIds };
};

const isOwnedByBusinessOwner = (ownerId, businessOwner) => {
  const normalizedOwner = toObjectIdString(ownerId);
  if (!normalizedOwner) return false;
  return getBusinessOwnerOwnershipIds(businessOwner).includes(normalizedOwner);
};

const hasStripeSecretConfigured = () =>
  Boolean(process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim());

const isFinalPaidStatus = (paymentStatus) =>
  ['completed', 'offline_paid', 'refunded'].includes(paymentStatus);

const normalizeBookingStatus = (status = '') =>
  String(status || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();

const isBookingDownPaymentSettled = (booking) => {
  const paymentStatus = normalizeBookingStatus(booking?.paymentStatus);
  return ['authorized', 'partial', 'due_requested', 'completed', 'offline_paid', 'refunded']
    .includes(paymentStatus);
};

const getBookingFlowStatus = (booking) => {
  const bookingStatus = normalizeBookingStatus(booking?.bookingStatus || 'pending');

  if (['pending', 'cancelled', 'rejected', 'completed'].includes(bookingStatus)) {
    return bookingStatus;
  }

  if (bookingStatus === 'in_progress') {
    return 'confirmed';
  }

  if (bookingStatus === 'confirmed') {
    return isBookingDownPaymentSettled(booking) ? 'confirmed' : 'accepted';
  }

  return bookingStatus || 'pending';
};

const withBookingFlowStatus = (bookingDoc) => {
  if (!bookingDoc) return bookingDoc;
  const plain = typeof bookingDoc.toObject === 'function'
    ? bookingDoc.toObject()
    : bookingDoc;
  return {
    ...plain,
    bookingFlowStatus: getBookingFlowStatus(plain)
  };
};

const cancellableIntentStatuses = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
  'processing'
]);

const cancelOpenBusinessOwnerBookingPaymentIntents = async (booking) => {
  if (!booking || !hasStripeSecretConfigured()) return;

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe initialization error while cancelling business owner booking payment intents:', error.message || error);
    return;
  }

  const cancelIfOpen = async (intentId, setStatus) => {
    if (!intentId) return;

    try {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      const currentStatus = (intent?.status || '').toLowerCase();
      if (!cancellableIntentStatuses.has(currentStatus)) {
        return;
      }

      const canceledIntent = await stripe.paymentIntents.cancel(intentId);
      const canceledStatus = (canceledIntent?.status || 'canceled').toLowerCase();
      setStatus(canceledStatus);
    } catch (error) {
      console.error(`Stripe cancel business owner booking intent (${intentId}) error:`, error.message || error);
    }
  };

  await cancelIfOpen(booking.paymentIntentId, (status) => {
    booking.paymentIntentStatus = status;
  });
  await cancelIfOpen(booking.duePaymentIntentId, (status) => {
    booking.duePaymentIntentStatus = status;
  });
};

const syncBusinessOwnerBookingPaymentState = async (booking) => {
  if (!booking || !hasStripeSecretConfigured()) return booking;

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe initialization error while syncing business owner booking payment:', error.message || error);
    return booking;
  }

  let shouldSave = false;

  if (booking.paymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
      const intentStatus = (intent?.status || '').toLowerCase();

      if (intentStatus && booking.paymentIntentStatus !== intentStatus) {
        booking.paymentIntentStatus = intentStatus;
        shouldSave = true;
      }

      if (!isFinalPaidStatus(booking.paymentStatus) && booking.paymentStatus !== 'due_requested') {
        if (intentStatus === 'requires_capture') {
          if (booking.paymentStatus !== 'authorized') {
            booking.paymentStatus = 'authorized';
            shouldSave = true;
          }
        } else if (intentStatus === 'succeeded' || intentStatus === 'processing') {
          if (booking.paymentStatus !== 'partial') {
            booking.paymentStatus = 'partial';
            shouldSave = true;
          }
        } else if (
          intentStatus === 'canceled' ||
          intentStatus === 'requires_payment_method' ||
          intentStatus === 'requires_confirmation'
        ) {
          if (booking.paymentStatus !== 'pending') {
            booking.paymentStatus = 'pending';
            shouldSave = true;
          }
        }
      }
    } catch (error) {
      console.error('Stripe sync business owner booking down payment error:', error.message || error);
    }
  }

  if (booking.duePaymentIntentId) {
    try {
      const dueIntent = await stripe.paymentIntents.retrieve(booking.duePaymentIntentId);
      const dueStatus = (dueIntent?.status || '').toLowerCase();

      if (dueStatus && booking.duePaymentIntentStatus !== dueStatus) {
        booking.duePaymentIntentStatus = dueStatus;
        shouldSave = true;
      }

      if (!isFinalPaidStatus(booking.paymentStatus)) {
        if (dueStatus === 'succeeded') {
          if (booking.paymentStatus !== 'completed') {
            booking.paymentStatus = 'completed';
            shouldSave = true;
          }
          if (booking.paidVia !== 'online') {
            booking.paidVia = 'online';
            shouldSave = true;
          }
          if (!booking.duePaidAt) {
            booking.duePaidAt = new Date();
            shouldSave = true;
          }
          if (booking.remainingAmount !== 0) {
            booking.remainingAmount = 0;
            shouldSave = true;
          }
        } else if (
          dueStatus === 'processing' ||
          dueStatus === 'canceled' ||
          dueStatus === 'requires_payment_method' ||
          dueStatus === 'requires_confirmation'
        ) {
          if (booking.paymentStatus !== 'due_requested') {
            booking.paymentStatus = 'due_requested';
            shouldSave = true;
          }
        }
      }
    } catch (error) {
      console.error('Stripe sync business owner booking due payment error:', error.message || error);
    }
  }

  if (shouldSave) {
    await booking.save();
  }

  return booking;
};

const syncBusinessOwnerAppointmentPaymentState = async (appointment) => {
  if (!appointment || !hasStripeSecretConfigured() || !appointment.paymentIntentId) {
    return appointment;
  }

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe initialization error while syncing business owner appointment payment:', error.message || error);
    return appointment;
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(appointment.paymentIntentId);
    const intentStatus = (intent?.status || '').toLowerCase();
    let shouldSave = false;

    if (intentStatus && appointment.paymentIntentStatus !== intentStatus) {
      appointment.paymentIntentStatus = intentStatus;
      shouldSave = true;
    }

    if (intentStatus === 'succeeded') {
      if (!isFinalPaidStatus(appointment.paymentStatus) || appointment.paymentStatus === 'completed') {
        if (appointment.paymentStatus !== 'completed') {
          appointment.paymentStatus = 'completed';
          shouldSave = true;
        }
        if (appointment.paidVia !== 'online') {
          appointment.paidVia = 'online';
          shouldSave = true;
        }
        if (!appointment.paidAt) {
          appointment.paidAt = new Date();
          shouldSave = true;
        }
        if (appointment.remainingAmount !== 0) {
          appointment.remainingAmount = 0;
          shouldSave = true;
        }
      }
    } else if (
      intentStatus === 'processing' ||
      intentStatus === 'requires_capture' ||
      intentStatus === 'canceled' ||
      intentStatus === 'requires_payment_method' ||
      intentStatus === 'requires_confirmation'
    ) {
      if (!['offline_paid', 'refunded'].includes(appointment.paymentStatus)) {
        if (appointment.paymentStatus !== 'pending') {
          appointment.paymentStatus = 'pending';
          shouldSave = true;
        }
        if (appointment.paidVia !== null) {
          appointment.paidVia = null;
          shouldSave = true;
        }
        if (appointment.paidAt !== null) {
          appointment.paidAt = null;
          shouldSave = true;
        }
        const remaining = Math.max(
          Number(appointment.totalAmount || 0) - Number(appointment.downPayment || 0),
          0
        );
        if (appointment.remainingAmount !== remaining) {
          appointment.remainingAmount = remaining;
          shouldSave = true;
        }
      }
    }

    if (shouldSave) {
      await appointment.save();
    }
  } catch (error) {
    console.error('Stripe sync business owner appointment payment error:', error.message || error);
  }

  return appointment;
};

// ==================== USER BOOKING ====================

/**
 * @desc    Create a regular booking for a business owner service
 * @route   POST /api/business-owner-bookings
 * @access  Private (User)
 */
exports.createBusinessOwnerBooking = async (req, res) => {
  try {
    const { employeeServiceId, bookingDate, userNotes } = req.body;
    const userId = req.user._id;

    if (!employeeServiceId || !bookingDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide employeeServiceId and bookingDate'
      });
    }

    const service = await EmployeeService.findById(employeeServiceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    if (!service.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This service is currently not available'
      });
    }

    if (service.appointmentEnabled) {
      return res.status(400).json({
        success: false,
        message: 'This service requires an appointment. Please use the appointment endpoint instead.'
      });
    }

    const totalAmount = service.basePrice;
    const downPayment = Math.round(totalAmount * 0.3 * 100) / 100;
    const platformFee = Math.round(totalAmount * 0.1 * 100) / 100;
    const businessOwnerPayoutFromDownPayment = Math.max(downPayment - platformFee, 0);
    const dueAmount = Math.round((totalAmount - downPayment) * 100) / 100;

    const booking = new BusinessOwnerBooking({
      userId,
      employeeServiceId: service._id,
      businessOwnerId: service.businessOwnerId,
      bookingDate: new Date(bookingDate),
      serviceSnapshot: {
        serviceName: service.headline,
        servicePhoto: service.servicePhoto,
        basePrice: service.basePrice,
        categories: service.categories
      },
      downPayment,
      platformFee,
      businessOwnerPayoutFromDownPayment,
      dueAmount,
      totalAmount,
      userNotes
    });

    await booking.save();

    await booking.populate([
      { path: 'user', select: 'fullName email phoneNumber profilePicture' },
      { path: 'service' },
      {
        path: 'businessOwner',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      }
    ]);

    service.bookings += 1;
    await service.save();

    try {
      const customerName = req.user?.fullName || 'A customer';
      await notifyBusinessOwner({
        businessOwnerId: booking.businessOwnerId,
        title: 'New booking request',
        body: `${customerName} booked ${service.headline || 'your service'} for ${formatDate(booking.bookingDate)}.`,
        type: 'booking.new',
        entityType: 'businessOwnerBooking',
        entityId: booking._id,
        metadata: {
          bookingId: booking._id,
          userId,
          serviceId: service._id,
          bookingDate: booking.bookingDate
        }
      });
    } catch (notifyError) {
      console.error('Notify business owner (booking created) error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking
    });
  } catch (error) {
    console.error('Create business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating booking'
    });
  }
};

/**
 * @desc    Create an appointment for a business owner service
 * @route   POST /api/business-owner-appointments
 * @access  Private (User)
 */
exports.createBusinessOwnerAppointment = async (req, res) => {
  try {
    const {
      employeeServiceId,
      appointmentDate,
      timeSlot,
      slotId,
      userNotes
    } = req.body;
    const userId = req.user._id;

    if (!employeeServiceId || !appointmentDate || !timeSlot || !slotId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide employeeServiceId, appointmentDate, timeSlot, and slotId'
      });
    }

    if (!timeSlot.startTime || !timeSlot.endTime) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both startTime and endTime in timeSlot'
      });
    }

    const service = await EmployeeService.findById(employeeServiceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    if (!service.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This service is currently not available'
      });
    }

    if (!service.appointmentEnabled) {
      return res.status(400).json({
        success: false,
        message: 'This service does not support appointments. Please use the regular booking endpoint.'
      });
    }

    const selectedSlot = service.appointmentSlots.id(slotId);
    if (!selectedSlot) {
      return res.status(404).json({
        success: false,
        message: 'Selected appointment slot not found'
      });
    }

    const totalAmount = selectedSlot.price;
    const platformFee = Math.round(totalAmount * 0.1 * 100) / 100;
    const businessOwnerPayoutFromPayment = Math.max(totalAmount - platformFee, 0);

    const appointment = new BusinessOwnerAppointment({
      userId,
      employeeServiceId: service._id,
      businessOwnerId: service.businessOwnerId,
      appointmentDate: new Date(appointmentDate),
      timeSlot: {
        startTime: timeSlot.startTime,
        endTime: timeSlot.endTime
      },
      selectedSlot: {
        duration: selectedSlot.duration,
        durationUnit: selectedSlot.durationUnit,
        price: selectedSlot.price,
        slotId: selectedSlot._id
      },
      serviceSnapshot: {
        serviceName: service.headline,
        servicePhoto: service.servicePhoto,
        headline: service.headline,
        categories: service.categories
      },
      totalAmount,
      platformFee,
      businessOwnerPayoutFromPayment,
      downPayment: 0,
      userNotes
    });

    const hasConflict = await appointment.hasTimeConflict();
    if (hasConflict) {
      return res.status(409).json({
        success: false,
        message: 'This time slot is already booked. Please choose a different time.'
      });
    }

    await appointment.save();

    await appointment.populate([
      { path: 'user', select: 'fullName email phoneNumber profilePicture' },
      { path: 'service' },
      {
        path: 'businessOwner',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      }
    ]);

    service.bookings += 1;
    await service.save();

    try {
      const customerName = req.user?.fullName || 'A customer';
      await notifyBusinessOwner({
        businessOwnerId: appointment.businessOwnerId,
        title: 'New appointment request',
        body: `${customerName} requested ${service.headline || 'your service'} on ${formatDate(appointment.appointmentDate)}.`,
        type: 'appointment.new',
        entityType: 'businessOwnerAppointment',
        entityId: appointment._id,
        metadata: {
          appointmentId: appointment._id,
          userId,
          serviceId: service._id,
          appointmentDate: appointment.appointmentDate,
          timeSlot: appointment.timeSlot
        }
      });
    } catch (notifyError) {
      console.error('Notify business owner (appointment created) error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Create business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating appointment'
    });
  }
};
/**
 * @desc    Get user's business owner bookings
 * @route   GET /api/business-owner-bookings/my-bookings
 * @access  Private (User)
 */
exports.getMyBusinessOwnerBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const requestedStatus = normalizeBookingStatus(status);
    const effectiveStatus = requestedStatus;

    const query = { userId };
    if (
      effectiveStatus &&
      !['accepted', 'confirmed'].includes(effectiveStatus)
    ) {
      query.bookingStatus = effectiveStatus;
    } else if (effectiveStatus === 'accepted' || effectiveStatus === 'confirmed') {
      query.bookingStatus = { $in: ['confirmed', 'in_progress'] };
    }

    const bookingsRaw = await BusinessOwnerBooking.find(query)
      .populate('service')
      .populate({
        path: 'businessOwner',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      })
      .sort({ createdAt: -1 });
    await Promise.all(
      bookingsRaw.map((booking) => syncBusinessOwnerBookingPaymentState(booking))
    );

    const bookingsWithFlow = bookingsRaw.map(withBookingFlowStatus);
    const filteredBookings = effectiveStatus
      ? bookingsWithFlow.filter((item) => item.bookingFlowStatus === effectiveStatus)
      : bookingsWithFlow;

    const total = filteredBookings.length;
    const skip = (pageNum - 1) * limitNum;
    const bookings = filteredBookings.slice(skip, skip + limitNum);

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: bookings
    });
  } catch (error) {
    console.error('Get my business owner bookings error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching bookings'
    });
  }
};

/**
 * @desc    Get user's business owner appointments
 * @route   GET /api/business-owner-appointments/my-appointments
 * @access  Private (User)
 */
exports.getMyBusinessOwnerAppointments = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId };
    if (status) {
      query.appointmentStatus = status;
    }

    const skip = (page - 1) * limit;

    const appointments = await BusinessOwnerAppointment.find(query)
      .populate('service')
      .populate({
        path: 'businessOwner',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      })
      .sort({ appointmentDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    await Promise.all(
      appointments.map((appointment) => syncBusinessOwnerAppointmentPaymentState(appointment))
    );

    const total = await BusinessOwnerAppointment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: appointments.length,
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: appointments
    });
  } catch (error) {
    console.error('Get my business owner appointments error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments'
    });
  }
};

/**
 * @desc    Get business owner booking by ID (user)
 * @route   GET /api/business-owner-bookings/:id
 * @access  Private (User)
 */
exports.getBusinessOwnerBookingById = async (req, res) => {
  try {
    const booking = await BusinessOwnerBooking.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')
      .populate({
        path: 'businessOwner',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      })

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: withBookingFlowStatus(booking)
    });
  } catch (error) {
    console.error('Get business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching booking'
    });
  }
};

/**
 * @desc    Get business owner appointment by ID (user)
 * @route   GET /api/business-owner-appointments/:id
 * @access  Private (User)
 */
exports.getBusinessOwnerAppointmentById = async (req, res) => {
  try {
    const appointment = await BusinessOwnerAppointment.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')
      .populate({
        path: 'businessOwner',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      })

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this appointment'
      });
    }

    await syncBusinessOwnerAppointmentPaymentState(appointment);

    res.status(200).json({
      success: true,
      data: appointment
    });
  } catch (error) {
    console.error('Get business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointment'
    });
  }
};

/**
 * @desc    Cancel business owner booking (user)
 * @route   PATCH /api/business-owner-bookings/:id/cancel
 * @access  Private (User)
 */
exports.cancelBusinessOwnerBooking = async (req, res) => {
  try {
    const { cancellationReason } = req.body;
    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    if (['completed', 'cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${booking.bookingStatus} booking`
      });
    }

    await cancelOpenBusinessOwnerBookingPaymentIntents(booking);
    await booking.cancel(cancellationReason, 'user');

    try {
      await notifyBusinessOwner({
        businessOwnerId: booking.businessOwnerId,
        title: 'Booking cancelled',
        body: `A customer cancelled a booking for ${formatDate(booking.bookingDate)}.`,
        type: 'booking.cancelled',
        entityType: 'businessOwnerBooking',
        entityId: booking._id,
        metadata: {
          bookingId: booking._id,
          userId: booking.userId,
          cancellationReason
        }
      });
    } catch (notifyError) {
      console.error('Notify business owner (booking cancelled) error:', notifyError);
    }

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: booking
    });
  } catch (error) {
    console.error('Cancel business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error cancelling booking'
    });
  }
};

/**
 * @desc    Cancel business owner appointment (user)
 * @route   PATCH /api/business-owner-appointments/:id/cancel
 * @access  Private (User)
 */
exports.cancelBusinessOwnerAppointment = async (req, res) => {
  try {
    const { cancellationReason } = req.body;
    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this appointment'
      });
    }

    if (['completed', 'cancelled'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${appointment.appointmentStatus} appointment`
      });
    }

    await appointment.cancel(cancellationReason, 'user');

    try {
      await notifyBusinessOwner({
        businessOwnerId: appointment.businessOwnerId,
        title: 'Appointment cancelled',
        body: `A customer cancelled an appointment for ${formatDate(appointment.appointmentDate)}.`,
        type: 'appointment.cancelled',
        entityType: 'businessOwnerAppointment',
        entityId: appointment._id,
        metadata: {
          appointmentId: appointment._id,
          userId: appointment.userId,
          cancellationReason
        }
      });
    } catch (notifyError) {
      console.error('Notify business owner (appointment cancelled) error:', notifyError);
    }

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Cancel business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error cancelling appointment'
    });
  }
};

/**
 * @desc    Add review for a business owner booking (user)
 * @route   POST /api/business-owner-bookings/:id/review
 * @access  Private (User)
 */
exports.addBusinessOwnerBookingReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Review comment is required'
      });
    }

    const booking = await BusinessOwnerBooking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to review this booking'
      });
    }

    if (booking.bookingStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be completed before submitting a review'
      });
    }

    if (booking.reviewedAt) {
      return res.status(400).json({
        success: false,
        message: 'Booking already reviewed'
      });
    }

    booking.rating = rating;
    booking.review = comment.trim();
    booking.reviewedAt = new Date();
    await booking.save();

    await updateEmployeeServiceRating(booking.employeeServiceId);

    try {
      await notifyBusinessOwner({
        businessOwnerId: booking.businessOwnerId,
        title: 'New review received',
        body: `You received a ${rating}-star review on a booking.`,
        type: 'booking.reviewed',
        entityType: 'businessOwnerBooking',
        entityId: booking._id,
        metadata: {
          bookingId: booking._id,
          userId: booking.userId,
          rating
        }
      });
    } catch (notifyError) {
      console.error('Notify business owner (booking review) error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: { booking }
    });
  } catch (error) {
    console.error('Add business owner booking review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting review',
      error: error.message
    });
  }
};

/**
 * @desc    Add review for a business owner appointment (user)
 * @route   POST /api/business-owner-appointments/:id/review
 * @access  Private (User)
 */
exports.addBusinessOwnerAppointmentReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Review comment is required'
      });
    }

    const appointment = await BusinessOwnerAppointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to review this appointment'
      });
    }

    if (appointment.appointmentStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Appointment must be completed before submitting a review'
      });
    }

    if (appointment.reviewedAt) {
      return res.status(400).json({
        success: false,
        message: 'Appointment already reviewed'
      });
    }

    appointment.rating = rating;
    appointment.review = comment.trim();
    appointment.reviewedAt = new Date();
    await appointment.save();

    await updateEmployeeServiceRating(appointment.employeeServiceId);

    try {
      await notifyBusinessOwner({
        businessOwnerId: appointment.businessOwnerId,
        title: 'New review received',
        body: `You received a ${rating}-star review on an appointment.`,
        type: 'appointment.reviewed',
        entityType: 'businessOwnerAppointment',
        entityId: appointment._id,
        metadata: {
          appointmentId: appointment._id,
          userId: appointment.userId,
          rating
        }
      });
    } catch (notifyError) {
      console.error('Notify business owner (appointment review) error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: { appointment }
    });
  } catch (error) {
    console.error('Add business owner appointment review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting review',
      error: error.message
    });
  }
};

/**
 * @desc    Get available slots for a business owner service on a specific date
 * @route   GET /api/business-owner-appointments/available-slots/:serviceId
 * @access  Public
 */
exports.getAvailableBusinessOwnerSlots = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a date'
      });
    }

    const service = await EmployeeService.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    if (!service.appointmentEnabled) {
      return res.status(400).json({
        success: false,
        message: 'This service does not support appointments'
      });
    }

    const appointmentDate = new Date(date);
    const appointments = await BusinessOwnerAppointment.find({
      employeeServiceId: service._id,
      appointmentDate: {
        $gte: new Date(appointmentDate.setHours(0, 0, 0, 0)),
        $lt: new Date(appointmentDate.setHours(23, 59, 59, 999))
      },
      appointmentStatus: { $in: ['pending', 'confirmed'] }
    }).select('timeSlot');

    const bookedSlots = appointments.map(apt => apt.timeSlot);
    const bookedSlotSet = new Set(bookedSlots);
    const availableSlots = (service.appointmentSlots || []).filter(
      slot => !bookedSlotSet.has(slot)
    );

    res.status(200).json({
      success: true,
      data: {
        service: {
          id: service._id,
          name: service.headline,
          appointmentSlots: service.appointmentSlots
        },
        bookedSlots,
        availableSlots,
        date: date
      }
    });
  } catch (error) {
    console.error('Get business owner available slots error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching available slots'
    });
  }
};
// ==================== BUSINESS OWNER MANAGEMENT ====================

/**
 * @desc    Get all bookings for business owner's services
 * @route   GET /api/business-owners/bookings
 * @access  Private (Business Owner)
 */
exports.getBusinessOwnerBookings = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { status, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const requestedStatus = normalizeBookingStatus(status);
    const effectiveStatus = requestedStatus === 'in_progress'
      ? 'confirmed'
      : requestedStatus;

    const query = {
      businessOwnerId: buildBusinessOwnerOwnershipQuery(businessOwner)
    };
    if (
      effectiveStatus &&
      !['accepted', 'confirmed'].includes(effectiveStatus)
    ) {
      query.bookingStatus = effectiveStatus;
    } else if (effectiveStatus === 'accepted' || effectiveStatus === 'confirmed') {
      query.bookingStatus = { $in: ['confirmed', 'in_progress'] };
    }

    const bookingsRaw = await BusinessOwnerBooking.find(query)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')
      .sort({ createdAt: -1 });

    await Promise.all(
      bookingsRaw.map((booking) => syncBusinessOwnerBookingPaymentState(booking))
    );

    const bookingsWithFlow = bookingsRaw.map(withBookingFlowStatus);
    const filteredBookings = effectiveStatus
      ? bookingsWithFlow.filter((item) => item.bookingFlowStatus === effectiveStatus)
      : bookingsWithFlow;

    const total = filteredBookings.length;
    const skip = (pageNum - 1) * limitNum;
    const bookings = filteredBookings.slice(skip, skip + limitNum);

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      data: bookings
    });
  } catch (error) {
    console.error('Get business owner bookings error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching bookings'
    });
  }
};

/**
 * @desc    Get business owner transaction history (bookings + appointments)
 * @route   GET /api/business-owners/bookings/transactions
 * @access  Private (Business Owner)
 * @query   status, source(all|booking|appointment), page, limit, search, from, to
 */
exports.getBusinessOwnerTransactions = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const {
      status,
      source = 'all',
      page = 1,
      limit = 20,
      search,
      from,
      to
    } = req.query;

    const normalizedSource = String(source || 'all').toLowerCase();
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const searchText = typeof search === 'string' ? search.trim().toLowerCase() : '';

    const createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) createdAt.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) createdAt.$lte = toDate;
    }

    const dateQuery = Object.keys(createdAt).length ? { createdAt } : {};
    const paymentStatusQuery = status ? { paymentStatus: status } : {};

    const includeBookings = normalizedSource === 'all' || normalizedSource === 'booking';
    const includeAppointments =
      normalizedSource === 'all' || normalizedSource === 'appointment';

    const transactions = [];

    if (includeBookings) {
      const bookings = await BusinessOwnerBooking.find({
        businessOwnerId: buildBusinessOwnerOwnershipQuery(businessOwner),
        ...dateQuery,
        ...paymentStatusQuery
      })
        .populate('userId', 'fullName')
        .sort({ createdAt: -1 });

      await Promise.all(
        bookings.map((booking) => syncBusinessOwnerBookingPaymentState(booking))
      );

      for (const booking of bookings) {
        const customerName = booking.userId?.fullName || null;
        const serviceName = booking.serviceSnapshot?.serviceName || null;

        if (searchText) {
          const customer = (customerName || '').toLowerCase();
          const service = (serviceName || '').toLowerCase();
          if (!customer.includes(searchText) && !service.includes(searchText)) {
            continue;
          }
        }

        transactions.push({
          source: 'booking',
          orderId: booking._id,
          transactionId:
            booking.paymentIntentId ||
            booking.duePaymentIntentId ||
            booking.checkoutSessionId ||
            null,
          paymentIntentId: booking.paymentIntentId || null,
          duePaymentIntentId: booking.duePaymentIntentId || null,
          checkoutSessionId: booking.checkoutSessionId || null,
          customerName,
          serviceName,
          bookingDate: booking.bookingDate || null,
          amount: booking.totalAmount,
          downPayment: booking.downPayment,
          dueAmount: booking.dueAmount,
          remainingAmount: booking.remainingAmount,
          paymentStatus: booking.paymentStatus,
          paymentIntentStatus: booking.paymentIntentStatus,
          duePaymentIntentStatus: booking.duePaymentIntentStatus,
          paidVia: booking.paidVia,
          status: booking.bookingStatus,
          paidAt: booking.duePaidAt || booking.offlinePaidAt || null,
          createdAt: booking.createdAt
        });
      }
    }

    if (includeAppointments) {
      const appointments = await BusinessOwnerAppointment.find({
        businessOwnerId: buildBusinessOwnerOwnershipQuery(businessOwner),
        ...dateQuery,
        ...paymentStatusQuery
      })
        .populate('userId', 'fullName')
        .sort({ createdAt: -1 });

      await Promise.all(
        appointments.map((appointment) =>
          syncBusinessOwnerAppointmentPaymentState(appointment)
        )
      );

      for (const appointment of appointments) {
        const customerName = appointment.userId?.fullName || null;
        const serviceName = appointment.serviceSnapshot?.serviceName || null;

        if (searchText) {
          const customer = (customerName || '').toLowerCase();
          const service = (serviceName || '').toLowerCase();
          if (!customer.includes(searchText) && !service.includes(searchText)) {
            continue;
          }
        }

        transactions.push({
          source: 'appointment',
          orderId: appointment._id,
          transactionId: appointment.paymentIntentId || appointment.checkoutSessionId || null,
          paymentIntentId: appointment.paymentIntentId || null,
          duePaymentIntentId: null,
          checkoutSessionId: appointment.checkoutSessionId || null,
          customerName,
          serviceName,
          bookingDate: appointment.appointmentDate || null,
          amount: appointment.totalAmount,
          downPayment: appointment.downPayment,
          dueAmount: 0,
          remainingAmount: appointment.remainingAmount,
          paymentStatus: appointment.paymentStatus,
          paymentIntentStatus: appointment.paymentIntentStatus,
          duePaymentIntentStatus: null,
          paidVia: appointment.paidVia,
          status: appointment.appointmentStatus,
          paidAt: appointment.paidAt || null,
          createdAt: appointment.createdAt
        });
      }
    }

    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = transactions.length;
    const totalPages = Math.ceil(total / limitNum);
    const start = (pageNum - 1) * limitNum;
    const pageData = transactions.slice(start, start + limitNum);

    res.status(200).json({
      success: true,
      data: {
        transactions: pageData,
        total,
        currentPage: pageNum,
        totalPages,
        filters: {
          status: status || null,
          source: normalizedSource,
          search: searchText || null,
          from: from || null,
          to: to || null
        }
      }
    });
  } catch (error) {
    console.error('Get business owner transactions error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching business owner transactions'
    });
  }
};

/**
 * @desc    Get single booking details (business owner)
 * @route   GET /api/business-owners/bookings/:id
 * @access  Private (Business Owner)
 */
exports.getBusinessOwnerBookingDetails = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const booking = await BusinessOwnerBooking.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: withBookingFlowStatus(booking)
    });
  } catch (error) {
    console.error('Get business owner booking details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching booking details'
    });
  }
};

/**
 * @desc    Accept/Confirm a booking request (business owner)
 * @route   PATCH /api/business-owners/bookings/:id/accept
 * @access  Private (Business Owner)
 */
exports.acceptBusinessOwnerBooking = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { providerNotes } = req.body;

    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    if (booking.bookingStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept a ${booking.bookingStatus} booking`
      });
    }

    let clientSecret = null;
    let paymentIntent = null;
    try {
      const stripe = getStripe();
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(booking.downPayment * 100),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          businessOwnerBookingId: booking._id.toString(),
          userId: booking.userId.toString(),
          businessOwnerId: booking.businessOwnerId.toString(),
          type: 'business_owner_booking_down_payment'
        }
      });
    } catch (stripeError) {
      console.error('Stripe checkout session error:', stripeError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment intent',
        error: stripeError.message
      });
    }

    // Confirm booking only after payment intent is ready.
    booking.bookingStatus = 'confirmed';
    if (providerNotes) {
      booking.providerNotes = providerNotes;
    }
    booking.paymentIntentId = paymentIntent.id;
    booking.paymentIntentStatus = paymentIntent.status;
    if (!['completed', 'offline_paid', 'refunded'].includes(booking.paymentStatus)) {
      booking.paymentStatus = 'pending';
    }
    await booking.save();

    clientSecret = paymentIntent.client_secret;

    await booking.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      data: {
        booking,
        checkout: { clientSecret }
      }
    });

    await createAndSend({
      userId: booking.userId,
      userType: 'user',
      title: 'Booking accepted',
      body: 'Your booking was accepted. Please complete the down payment.',
      type: 'business_owner_booking_payment',
      entityType: 'businessOwnerBooking',
      entityId: booking._id,
      data: {
        bookingId: booking._id.toString()
      }
    });
  } catch (error) {
    console.error('Accept business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error accepting booking'
    });
  }
};

/**
 * @desc    Reject/Cancel a booking request (business owner)
 * @route   PATCH /api/business-owners/bookings/:id/reject
 * @access  Private (Business Owner)
 */
exports.rejectBusinessOwnerBooking = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { cancellationReason } = req.body;

    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    if (['completed', 'cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a ${booking.bookingStatus} booking`
      });
    }

    booking.bookingStatus = 'rejected';
    booking.cancellationReason = cancellationReason || 'Rejected by business owner';
    booking.cancelledBy = 'business_owner';
    booking.cancelledAt = new Date();
    await cancelOpenBusinessOwnerBookingPaymentIntents(booking);
    await booking.save();

    await booking.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      data: booking
    });
  } catch (error) {
    console.error('Reject business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rejecting booking'
    });
  }
};

/**
 * @desc    Mark booking as in progress (business owner)
 * @route   PATCH /api/business-owners/bookings/:id/start
 * @access  Private (Business Owner)
 */
exports.startBusinessOwnerBooking = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    if (!isBookingDownPaymentSettled(booking)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start booking before down payment is completed'
      });
    }

    if (booking.bookingStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start a ${booking.bookingStatus} booking. Must be confirmed first.`
      });
    }

    booking.bookingStatus = 'in_progress';
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Booking started',
      data: booking
    });
  } catch (error) {
    console.error('Start business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error starting booking'
    });
  }
};

/**
 * @desc    Mark booking as completed (business owner)
 * @route   PATCH /api/business-owners/bookings/:id/complete
 * @access  Private (Business Owner)
 */
exports.completeBusinessOwnerBooking = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    if (!isBookingDownPaymentSettled(booking)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot complete booking before down payment is completed'
      });
    }

    if (!['confirmed', 'in_progress'].includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete a ${booking.bookingStatus} booking`
      });
    }

    booking.bookingStatus = 'completed';
    booking.completedAt = new Date();
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Booking completed successfully',
      data: booking
    });
  } catch (error) {
    console.error('Complete business owner booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error completing booking'
    });
  }
};
// ==================== BUSINESS OWNER APPOINTMENT MANAGEMENT ====================

/**
 * @desc    Get all appointments for business owner's services
 * @route   GET /api/business-owners/appointments
 * @access  Private (Business Owner)
 */
exports.getBusinessOwnerAppointments = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { status, date, page = 1, limit = 10 } = req.query;

    const query = {
      businessOwnerId: buildBusinessOwnerOwnershipQuery(businessOwner)
    };
    if (status) {
      query.appointmentStatus = status;
    }
    if (date) {
      const appointmentDate = new Date(date);
      query.appointmentDate = {
        $gte: new Date(appointmentDate.setHours(0, 0, 0, 0)),
        $lt: new Date(appointmentDate.setHours(23, 59, 59, 999))
      };
    }

    const skip = (page - 1) * limit;

    const appointments = await BusinessOwnerAppointment.find(query)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')
      .sort({ appointmentDate: 1, 'timeSlot.startTime': 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BusinessOwnerAppointment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: appointments.length,
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: appointments
    });
  } catch (error) {
    console.error('Get business owner appointments error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments'
    });
  }
};

/**
 * @desc    Get single appointment details (business owner)
 * @route   GET /api/business-owners/appointments/:id
 * @access  Private (Business Owner)
 */
exports.getBusinessOwnerAppointmentDetails = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const appointment = await BusinessOwnerAppointment.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this appointment'
      });
    }

    res.status(200).json({
      success: true,
      data: appointment
    });
  } catch (error) {
    console.error('Get business owner appointment details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointment details'
    });
  }
};

/**
 * @desc    Accept/Confirm an appointment request (business owner)
 * @route   PATCH /api/business-owners/appointments/:id/accept
 * @access  Private (Business Owner)
 */
exports.acceptBusinessOwnerAppointment = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { providerNotes } = req.body;

    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    if (appointment.appointmentStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept a ${appointment.appointmentStatus} appointment`
      });
    }

    let paymentIntent = null;
    try {
      const stripe = getStripe();
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(appointment.totalAmount * 100),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          businessOwnerAppointmentId: appointment._id.toString(),
          userId: appointment.userId.toString(),
          businessOwnerId: appointment.businessOwnerId.toString(),
          type: 'business_owner_appointment_payment'
        }
      });
    } catch (stripeError) {
      console.error('Stripe checkout session error:', stripeError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment intent',
        error: stripeError.message
      });
    }

    appointment.appointmentStatus = 'confirmed';
    if (providerNotes) {
      appointment.providerNotes = providerNotes;
    }
    appointment.paymentIntentId = paymentIntent.id;
    appointment.paymentIntentStatus = paymentIntent.status;
    await appointment.save();

    const clientSecret = paymentIntent.client_secret;

    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment accepted successfully',
      data: {
        appointment,
        checkout: { clientSecret }
      }
    });

    await createAndSend({
      userId: appointment.userId,
      userType: 'user',
      title: 'Appointment accepted',
      body: 'Your appointment was accepted. Please complete payment.',
      type: 'business_owner_appointment_payment',
      entityType: 'businessOwnerAppointment',
      entityId: appointment._id,
      data: {
        appointmentId: appointment._id.toString()
      }
    });
  } catch (error) {
    console.error('Accept business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error accepting appointment'
    });
  }
};

/**
 * @desc    Reject/Cancel an appointment request (business owner)
 * @route   PATCH /api/business-owners/appointments/:id/reject
 * @access  Private (Business Owner)
 */
exports.rejectBusinessOwnerAppointment = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { cancellationReason } = req.body;

    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    if (['completed', 'cancelled', 'rejected'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a ${appointment.appointmentStatus} appointment`
      });
    }

    appointment.appointmentStatus = 'rejected';
    appointment.cancellationReason = cancellationReason || 'Rejected by business owner';
    appointment.cancelledBy = 'business_owner';
    appointment.cancelledAt = new Date();
    await appointment.save();

    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment rejected successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Reject business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rejecting appointment'
    });
  }
};

/**
 * @desc    Reschedule an appointment (business owner)
 * @route   PATCH /api/business-owners/appointments/:id/reschedule
 * @access  Private (Business Owner)
 */
exports.rescheduleBusinessOwnerAppointment = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { appointmentDate, timeSlot, providerNotes } = req.body;

    if (!appointmentDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Please provide appointmentDate and timeSlot'
      });
    }

    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    if (['completed', 'cancelled', 'rejected', 'no_show'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reschedule a ${appointment.appointmentStatus} appointment`
      });
    }

    const oldDate = appointment.appointmentDate;
    const oldTimeSlot = { ...appointment.timeSlot };

    appointment.appointmentDate = new Date(appointmentDate);
    appointment.timeSlot = {
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime
    };

    const hasConflict = await appointment.hasTimeConflict();
    if (hasConflict) {
      return res.status(409).json({
        success: false,
        message: 'The new time slot conflicts with another appointment. Please choose a different time.'
      });
    }

    const rescheduleNote = `Rescheduled by business owner from ${oldDate.toLocaleDateString()} (${oldTimeSlot.startTime}-${oldTimeSlot.endTime}) to ${appointment.appointmentDate.toLocaleDateString()} (${timeSlot.startTime}-${timeSlot.endTime})`;
    appointment.providerNotes = providerNotes
      ? `${providerNotes}\n\n${rescheduleNote}`
      : rescheduleNote;

    if (appointment.appointmentStatus === 'pending') {
      appointment.appointmentStatus = 'pending';
    }

    await appointment.save();

    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment rescheduled successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Reschedule business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rescheduling appointment'
    });
  }
};

/**
 * @desc    Mark appointment as in progress (business owner)
 * @route   PATCH /api/business-owners/appointments/:id/start
 * @access  Private (Business Owner)
 */
exports.startBusinessOwnerAppointment = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    if (appointment.appointmentStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start a ${appointment.appointmentStatus} appointment. Must be confirmed first.`
      });
    }

    appointment.appointmentStatus = 'in_progress';
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment started',
      data: appointment
    });
  } catch (error) {
    console.error('Start business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error starting appointment'
    });
  }
};

/**
 * @desc    Mark appointment as completed (business owner)
 * @route   PATCH /api/business-owners/appointments/:id/complete
 * @access  Private (Business Owner)
 */
exports.completeBusinessOwnerAppointment = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    if (!['confirmed', 'in_progress'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete a ${appointment.appointmentStatus} appointment`
      });
    }

    appointment.appointmentStatus = 'completed';
    appointment.completedAt = new Date();
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment completed successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Complete business owner appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error completing appointment'
    });
  }
};

/**
 * @desc    Mark user as no-show for appointment (business owner)
 * @route   PATCH /api/business-owners/appointments/:id/no-show
 * @access  Private (Business Owner)
 */
exports.markBusinessOwnerNoShow = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);

    const appointment = await BusinessOwnerAppointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.businessOwnerId.toString() !== businessOwner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    if (appointment.appointmentStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot mark no-show for a ${appointment.appointmentStatus} appointment`
      });
    }

    appointment.appointmentStatus = 'no_show';
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment marked as no-show',
      data: appointment
    });
  } catch (error) {
    console.error('Mark business owner no-show error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error marking no-show'
    });
  }
};

/**
 * @desc    Get business owner booking down payment client secret (user)
 * @route   GET /api/business-owner-bookings/:id/checkout-session
 * @access  Private (User)
 */
exports.getBusinessOwnerBookingCheckoutSession = async (req, res) => {
  try {
    const booking = await BusinessOwnerBooking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    if (['cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(409).json({
        success: false,
        message: `Payment is not available for a ${booking.bookingStatus} booking`
      });
    }

    if (isFinalPaidStatus(booking.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: 'Booking already fully paid'
      });
    }

    if (booking.paymentStatus === 'due_requested') {
      return res.status(409).json({
        success: false,
        message: 'Down payment already settled. Please complete the due payment.'
      });
    }

    if (['authorized', 'partial'].includes(booking.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: 'Down payment already completed'
      });
    }

    if (!booking.paymentIntentId) {
      return res.status(404).json({
        success: false,
        message: 'Payment intent not available yet'
      });
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);

    res.status(200).json({
      success: true,
      data: {
        clientSecret: intent.client_secret,
        status: intent.status
      }
    });
  } catch (error) {
    console.error('Get business owner booking checkout session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment intent',
      error: error.message
    });
  }
};

/**
 * @desc    Get business owner appointment payment client secret (user)
 * @route   GET /api/business-owner-appointments/:id/checkout-session
 * @access  Private (User)
 */
exports.getBusinessOwnerAppointmentCheckoutSession = async (req, res) => {
  try {
    const appointment = await BusinessOwnerAppointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncBusinessOwnerAppointmentPaymentState(appointment);

    if (isFinalPaidStatus(appointment.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: 'Appointment already paid'
      });
    }

    if (!appointment.paymentIntentId) {
      return res.status(404).json({
        success: false,
        message: 'Payment intent not available yet'
      });
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(appointment.paymentIntentId);

    if ((intent?.status || '').toLowerCase() === 'processing') {
      return res.status(409).json({
        success: false,
        message: 'Payment is processing. Please wait a moment.'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        clientSecret: intent.client_secret,
        status: intent.status
      }
    });
  } catch (error) {
    console.error('Get business owner appointment checkout session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment intent',
      error: error.message
    });
  }
};

/**
 * @desc    Get due payment client secret for business owner booking (user)
 * @route   GET /api/business-owner-bookings/:id/due/intent
 * @access  Private (User)
 */
exports.getBusinessOwnerDuePaymentIntent = async (req, res) => {
  try {
    const booking = await BusinessOwnerBooking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    if (['cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(409).json({
        success: false,
        message: `Cannot pay due for a ${booking.bookingStatus} booking`
      });
    }

    if (isFinalPaidStatus(booking.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: 'Booking already fully paid'
      });
    }

    if (booking.paymentStatus !== 'due_requested' || !booking.duePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Due payment is not requested'
      });
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(booking.duePaymentIntentId);

    res.status(200).json({
      success: true,
      data: {
        clientSecret: intent.client_secret,
        amount: booking.dueAmount,
        status: intent.status
      }
    });
  } catch (error) {
    console.error('Get business owner due payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching due payment intent',
      error: error.message
    });
  }
};

/**
 * @desc    Confirm due payment for business owner booking (user)
 * @route   POST /api/business-owner-bookings/:id/due/confirm
 * @access  Private (User)
 */
exports.confirmBusinessOwnerDuePayment = async (req, res) => {
  try {
    const booking = await BusinessOwnerBooking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (['cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(409).json({
        success: false,
        message: `Cannot confirm payment for a ${booking.bookingStatus} booking`
      });
    }

    if (isFinalPaidStatus(booking.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: 'Booking already fully paid'
      });
    }

    if (!booking.duePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Due payment not initialized'
      });
    }

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(booking.duePaymentIntentId);

    booking.duePaymentIntentStatus = intent.status;

    if (intent.status !== 'succeeded') {
      await booking.save();
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    booking.paymentStatus = 'completed';
    booking.paidVia = 'online';
    booking.duePaidAt = new Date();
    booking.remainingAmount = 0;
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Due payment confirmed',
      data: booking
    });
  } catch (error) {
    console.error('Confirm business owner due payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error confirming due payment',
      error: error.message
    });
  }
};

/**
 * @desc    Get payment status for a business owner booking (user)
 * @route   GET /api/business-owner-bookings/:id/payment-status
 * @access  Private (User)
 */
exports.getBusinessOwnerBookingPaymentStatus = async (req, res) => {
  try {
    const booking = await BusinessOwnerBooking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: {
        bookingId: booking._id,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
        paymentIntentStatus: booking.paymentIntentStatus,
        duePaymentIntentStatus: booking.duePaymentIntentStatus,
        paidVia: booking.paidVia,
        totalAmount: booking.totalAmount,
        downPayment: booking.downPayment,
        dueAmount: booking.dueAmount,
        remainingAmount: booking.remainingAmount,
        dueRequestedAt: booking.dueRequestedAt,
        duePaidAt: booking.duePaidAt,
        offlinePaidAt: booking.offlinePaidAt
      }
    });
  } catch (error) {
    console.error('Get business owner booking payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status',
      error: error.message
    });
  }
};

/**
 * @desc    Get payment status for a business owner booking (business owner)
 * @route   GET /api/business-owners/bookings/:id/payment-status
 * @access  Private (Business Owner)
 */
exports.getBusinessOwnerBookingPaymentStatusForOwner = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!isOwnedByBusinessOwner(booking.businessOwnerId, businessOwner)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: {
        bookingId: booking._id,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
        paymentIntentStatus: booking.paymentIntentStatus,
        duePaymentIntentStatus: booking.duePaymentIntentStatus,
        paidVia: booking.paidVia,
        totalAmount: booking.totalAmount,
        downPayment: booking.downPayment,
        dueAmount: booking.dueAmount,
        remainingAmount: booking.remainingAmount,
        dueRequestedAt: booking.dueRequestedAt,
        duePaidAt: booking.duePaidAt,
        offlinePaidAt: booking.offlinePaidAt
      }
    });
  } catch (error) {
    console.error('Get business owner booking payment status (owner) error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status',
      error: error.message
    });
  }
};

/**
 * @desc    Request due payment for a completed booking (business owner)
 * @route   POST /api/business-owners/bookings/:id/request-due
 * @access  Private (Business Owner)
 */
exports.requestBusinessOwnerDuePayment = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!isOwnedByBusinessOwner(booking.businessOwnerId, businessOwner)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncBusinessOwnerBookingPaymentState(booking);

    if (booking.bookingStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be completed to request due payment'
      });
    }

    if (booking.paymentStatus === 'completed' || booking.paymentStatus === 'offline_paid') {
      return res.status(400).json({
        success: false,
        message: 'Booking already paid'
      });
    }

    if (booking.paymentStatus === 'due_requested' && booking.duePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Due payment already requested'
      });
    }

    const downPaymentSettled =
      booking.paymentStatus === 'authorized' ||
      booking.paymentStatus === 'partial';
    if (!downPaymentSettled) {
      return res.status(400).json({
        success: false,
        message: 'Down payment must be completed before requesting due payment'
      });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(booking.dueAmount * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        businessOwnerBookingId: booking._id.toString(),
        userId: booking.userId.toString(),
        businessOwnerId: booking.businessOwnerId.toString(),
        type: 'business_owner_booking_due_payment'
      }
    });

    booking.duePaymentIntentId = paymentIntent.id;
    booking.duePaymentIntentStatus = paymentIntent.status;
    booking.paymentStatus = 'due_requested';
    booking.dueRequestedAt = new Date();
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Due payment requested',
      data: {
        bookingId: booking._id,
        dueAmount: booking.dueAmount,
        clientSecret: paymentIntent.client_secret
      }
    });
  } catch (error) {
    console.error('Request business owner due payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error requesting due payment',
      error: error.message
    });
  }
};

/**
 * @desc    Mark due payment as paid offline (business owner)
 * @route   POST /api/business-owners/bookings/:id/mark-offline-paid
 * @access  Private (Business Owner)
 */
exports.markBusinessOwnerOfflinePaid = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const booking = await BusinessOwnerBooking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!isOwnedByBusinessOwner(booking.businessOwnerId, businessOwner)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (booking.bookingStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be completed to mark offline payment'
      });
    }

    booking.paymentStatus = 'offline_paid';
    booking.paidVia = 'offline';
    booking.offlinePaidAt = new Date();
    booking.remainingAmount = 0;
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Marked as paid offline',
      data: booking
    });
  } catch (error) {
    console.error('Mark business owner offline paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking offline payment',
      error: error.message
    });
  }
};
