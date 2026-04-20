const Booking = require('../models/Booking');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const User = require('../models/User');
const Provider = require('../models/Provider');
const Review = require('../models/Review');
const { getStripe } = require('../utility/stripe');

const updateServiceRating = async (serviceId) => {
  const stats = await Review.aggregate([
    {
      $match: {
        serviceId: serviceId,
        isActive: true,
        $or: [
          { moderationStatus: { $exists: false } },
          { moderationStatus: 'active' }
        ]
      }
    },
    {
      $group: {
        _id: '$serviceId',
        avgRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (stats.length > 0) {
    await Service.findByIdAndUpdate(serviceId, {
      rating: Math.round(stats[0].avgRating * 10) / 10,
      totalReviews: stats[0].totalReviews
    });
  } else {
    await Service.findByIdAndUpdate(serviceId, { rating: 0, totalReviews: 0 });
  }
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

const cancelOpenBookingPaymentIntents = async (booking) => {
  if (!booking || !hasStripeSecretConfigured()) return;

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe initialization error while cancelling booking payment intents:', error.message || error);
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
      console.error(`Stripe cancel booking intent (${intentId}) error:`, error.message || error);
    }
  };

  await cancelIfOpen(booking.paymentIntentId, (status) => {
    booking.paymentIntentStatus = status;
  });
  await cancelIfOpen(booking.duePaymentIntentId, (status) => {
    booking.duePaymentIntentStatus = status;
  });
};

const syncBookingPaymentState = async (booking) => {
  if (!booking || !hasStripeSecretConfigured()) return booking;

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe initialization error while syncing booking payment:', error.message || error);
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
      console.error('Stripe sync booking down payment error:', error.message || error);
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
      console.error('Stripe sync booking due payment error:', error.message || error);
    }
  }

  if (shouldSave) {
    await booking.save();
  }

  return booking;
};

const syncAppointmentPaymentState = async (appointment) => {
  if (!appointment || !hasStripeSecretConfigured() || !appointment.paymentIntentId) {
    return appointment;
  }

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error('Stripe initialization error while syncing appointment payment:', error.message || error);
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
    console.error('Stripe sync appointment payment error:', error.message || error);
  }

  return appointment;
};

/**
 * @desc    Create a regular booking (for services with appointmentEnabled = false)
 * @route   POST /api/bookings
 * @access  Private (User)
 */
exports.createBooking = async (req, res) => {
  try {
    const { serviceId, bookingDate, userNotes } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!serviceId || !bookingDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide serviceId and bookingDate'
      });
    }

    // Check if service exists and is active
    const service = await Service.findById(serviceId).populate('category');
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

    // Check if service has appointment disabled (booking is for non-appointment services)
    if (service.appointmentEnabled) {
      return res.status(400).json({
        success: false,
        message: 'This service requires an appointment. Please use the appointment endpoint instead.'
      });
    }

    const totalAmount = service.basePrice;
    const downPayment = Math.round(totalAmount * 0.3 * 100) / 100;
    const platformFee = Math.round(totalAmount * 0.1 * 100) / 100;
    const providerPayoutFromDownPayment = Math.max(downPayment - platformFee, 0);
    const dueAmount = Math.round((totalAmount - downPayment) * 100) / 100;

    // Create booking
    const booking = new Booking({
      userId,
      serviceId: service._id,
      providerId: service.providerId,
      bookingDate: new Date(bookingDate),
      serviceSnapshot: {
        serviceName: service.headline,
        servicePhoto: service.servicePhoto,
        basePrice: service.basePrice,
        category: service.category._id
      },
      downPayment,
      totalAmount,
      platformFee,
      providerPayoutFromDownPayment,
      dueAmount,
      userNotes
    });

    await booking.save();

    // Populate booking data for response
    await booking.populate([
      { path: 'user', select: 'fullName email phoneNumber profilePicture' },
      { path: 'service' },
      {
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      }
    ]);

    // Update service booking count
    service.bookings += 1;
    await service.save();

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: {
        booking,
        payment: {
          downPayment,
          platformFee,
          providerPayoutFromDownPayment,
          dueAmount
        }
      }
    });

  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating booking'
    });
  }
};

/**
 * @desc    Create an appointment (for services with appointmentEnabled = true)
 * @route   POST /api/appointments
 * @access  Private (User)
 */
exports.createAppointment = async (req, res) => {
  try {
    const {
      serviceId,
      appointmentDate,
      timeSlot,
      slotId,
      userNotes
    } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!serviceId || !appointmentDate || !timeSlot || !slotId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide serviceId, appointmentDate, timeSlot, and slotId'
      });
    }

    // Validate timeSlot format
    if (!timeSlot.startTime || !timeSlot.endTime) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both startTime and endTime in timeSlot'
      });
    }

    // Check if service exists and is active
    const service = await Service.findById(serviceId).populate('category');
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

    // Check if service has appointment enabled
    if (!service.appointmentEnabled) {
      return res.status(400).json({
        success: false,
        message: 'This service does not support appointments. Please use the regular booking endpoint.'
      });
    }

    // Find the selected appointment slot
    const selectedSlot = service.appointmentSlots.id(slotId);
    if (!selectedSlot) {
      return res.status(404).json({
        success: false,
        message: 'Selected appointment slot not found'
      });
    }

    // Create appointment object for conflict checking
    const appointment = new Appointment({
      userId,
      serviceId: service._id,
      providerId: service.providerId,
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
        category: service.category._id
      },
      totalAmount: selectedSlot.price,
      downPayment: 0,
      userNotes
    });

    // Check for time conflicts
    const hasConflict = await appointment.hasTimeConflict();
    if (hasConflict) {
      return res.status(409).json({
        success: false,
        message: 'This time slot is already booked. Please choose a different time.'
      });
    }

    // Save appointment
    await appointment.save();

    // Populate appointment data for response
    await appointment.populate([
      { path: 'user', select: 'fullName email phoneNumber profilePicture' },
      { path: 'service' },
      {
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      }
    ]);

    // Update service booking count
    service.bookings += 1;
    await service.save();

    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      data: appointment
    });

  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating appointment'
    });
  }
};

/**
 * @desc    Get user's bookings
 * @route   GET /api/bookings/my-bookings
 * @access  Private (User)
 */
exports.getMyBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const requestedStatus = normalizeBookingStatus(status);
    const effectiveStatus = requestedStatus === 'in_progress'
      ? 'confirmed'
      : requestedStatus;

    const query = { userId };
    if (
      effectiveStatus &&
      !['accepted', 'confirmed'].includes(effectiveStatus)
    ) {
      query.bookingStatus = effectiveStatus;
    } else if (effectiveStatus === 'accepted' || effectiveStatus === 'confirmed') {
      query.bookingStatus = { $in: ['confirmed', 'in_progress'] };
    }

    const bookingsRaw = await Booking.find(query)
      .populate('service')
      .populate({
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      })
      .sort({ createdAt: -1 });
    await Promise.all(bookingsRaw.map((booking) => syncBookingPaymentState(booking)));

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
    console.error('Get my bookings error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching bookings'
    });
  }
};

/**
 * @desc    Get user's appointments
 * @route   GET /api/appointments/my-appointments
 * @access  Private (User)
 */
exports.getMyAppointments = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    // Build query
    const query = { userId };
    if (status) {
      query.appointmentStatus = status;
    }

    // Pagination
    const skip = (page - 1) * limit;

    const appointments = await Appointment.find(query)
      .populate('service')
      .populate({
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      })
      .sort({ appointmentDate: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    await Promise.all(
      appointments.map((appointment) => syncAppointmentPaymentState(appointment))
    );

    const total = await Appointment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: appointments.length,
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: appointments
    });

  } catch (error) {
    console.error('Get my appointments error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments'
    });
  }
};

/**
 * @desc    Get single booking by ID
 * @route   GET /api/bookings/:id
 * @access  Private (User/Provider)
 */
exports.getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')
      .populate({
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture location'
        }
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user is authorized to view this booking
    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    await syncBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: withBookingFlowStatus(booking)
    });

  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching booking'
    });
  }
};

/**
 * @desc    Get single appointment by ID
 * @route   GET /api/appointments/:id
 * @access  Private (User/Provider)
 */
exports.getAppointmentById = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service')
      .populate({
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if user is authorized to view this appointment
    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this appointment'
      });
    }

    await syncAppointmentPaymentState(appointment);

    const providerUser = appointment.provider?.userId;

    res.status(200).json({
      success: true,
      data: {
        appointment,
        provider: providerUser ? {
          name: providerUser.fullName,
          image: providerUser.profilePicture,
          location: providerUser.location || null,
          email: providerUser.email,
          phoneNumber: providerUser.phoneNumber
        } : null
      }
    });

  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointment'
    });
  }
};

/**
 * @desc    Cancel booking
 * @route   PATCH /api/bookings/:id/cancel
 * @access  Private (User)
 */
exports.cancelBooking = async (req, res) => {
  try {
    const { cancellationReason } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user owns this booking
    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    if (['completed', 'cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${booking.bookingStatus} booking`
      });
    }

    await cancelOpenBookingPaymentIntents(booking);
    await booking.cancel(cancellationReason, 'user');

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: booking
    });

  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error cancelling booking'
    });
  }
};

/**
 * @desc    Cancel appointment
 * @route   PATCH /api/appointments/:id/cancel
 * @access  Private (User)
 */
exports.cancelAppointment = async (req, res) => {
  try {
    const { cancellationReason } = req.body;
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if user owns this appointment
    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this appointment'
      });
    }

    // Check if appointment can be cancelled
    if (['completed', 'cancelled'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${appointment.appointmentStatus} appointment`
      });
    }

    await appointment.cancel(cancellationReason, 'user');

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully',
      data: appointment
    });

  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error cancelling appointment'
    });
  }
};

/**
 * @desc    Add review for a booking (user)
 * @route   POST /api/bookings/:id/review
 * @access  Private (User)
 */
exports.addBookingReview = async (req, res) => {
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

    const booking = await Booking.findById(id);
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

    const existingBookingReview = await Review.findOne({
      userId: booking.userId,
      bookingId: booking._id
    }).select('_id');

    if (existingBookingReview) {
      return res.status(409).json({
        success: false,
        message: 'Review already given'
      });
    }

    const review = new Review({
      providerId: booking.providerId,
      userId: booking.userId,
      serviceId: booking.serviceId,
      bookingId: booking._id,
      rating,
      comment: comment.trim()
    });

    await review.save();

    booking.rating = rating;
    booking.review = comment.trim();
    booking.reviewedAt = new Date();
    await booking.save();

    await updateServiceRating(booking.serviceId);

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Add booking review error:', error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Review already given'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error submitting review',
      error: error.message
    });
  }
};

/**
 * @desc    Add review for an appointment (user)
 * @route   POST /api/appointments/:id/review
 * @access  Private (User)
 */
exports.addAppointmentReview = async (req, res) => {
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

    const appointment = await Appointment.findById(id);
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

    const existingAppointmentReview = await Review.findOne({
      userId: appointment.userId,
      appointmentId: appointment._id
    }).select('_id');

    if (existingAppointmentReview) {
      return res.status(409).json({
        success: false,
        message: 'Review already given'
      });
    }

    const review = new Review({
      providerId: appointment.providerId,
      userId: appointment.userId,
      serviceId: appointment.serviceId,
      appointmentId: appointment._id,
      rating,
      comment: comment.trim()
    });

    await review.save();

    appointment.rating = rating;
    appointment.review = comment.trim();
    appointment.reviewedAt = new Date();
    await appointment.save();

    await updateServiceRating(appointment.serviceId);

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Add appointment review error:', error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Review already given'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error submitting review',
      error: error.message
    });
  }
};

/**
 * @desc    Get due payment client secret (user)
 * @route   GET /api/bookings/:id/due/intent
 * @access  Private (User)
 */
exports.getDuePaymentIntent = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
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

    await syncBookingPaymentState(booking);

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
    console.error('Get due payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching due payment intent',
      error: error.message
    });
  }
};

/**
 * @desc    Get appointment payment client secret
 * @route   GET /api/appointments/:id/checkout-session
 * @access  Private (User)
 */
exports.getAppointmentCheckoutSession = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
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

    await syncAppointmentPaymentState(appointment);

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
    console.error('Get appointment checkout session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment intent',
      error: error.message
    });
  }
};

/**
 * @desc    Confirm due payment (user)
 * @route   POST /api/bookings/:id/due/confirm
 * @access  Private (User)
 */
exports.confirmDuePayment = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
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
    console.error('Confirm due payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error confirming due payment',
      error: error.message
    });
  }
};

/**
 * @desc    Get down payment client secret
 * @route   GET /api/bookings/:id/checkout-session
 * @access  Private (User)
 */
exports.getCheckoutSession = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
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

    await syncBookingPaymentState(booking);

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
    console.error('Get checkout session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment intent',
      error: error.message
    });
  }
};

/**
 * @desc    Get payment status for a booking (user)
 * @route   GET /api/bookings/:id/payment-status
 * @access  Private (User)
 */
exports.getBookingPaymentStatus = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
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

    await syncBookingPaymentState(booking);

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
    console.error('Get booking payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status',
      error: error.message
    });
  }
};

/**
 * @desc    Reschedule appointment (user)
 * @route   PATCH /api/appointments/:id/reschedule
 * @access  Private (User)
 */
exports.rescheduleAppointment = async (req, res) => {
  try {
    const { appointmentDate, timeSlot, userNotes } = req.body;

    if (!appointmentDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Please provide appointmentDate and timeSlot'
      });
    }

    if (!timeSlot.startTime || !timeSlot.endTime) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both startTime and endTime in timeSlot'
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (appointment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reschedule this appointment'
      });
    }

    if (appointment.appointmentStatus !== 'in_progress') {
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

    const rescheduleNote = `Rescheduled by user from ${oldDate.toLocaleDateString()} (${oldTimeSlot.startTime}-${oldTimeSlot.endTime}) to ${appointment.appointmentDate.toLocaleDateString()} (${timeSlot.startTime}-${timeSlot.endTime})`;
    appointment.userNotes = userNotes
      ? `${userNotes}\n\n${rescheduleNote}`
      : rescheduleNote;

    // Move back to pending for provider confirmation after reschedule
    appointment.appointmentStatus = 'pending';

    await appointment.save();

    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment rescheduled successfully',
      data: appointment
    });
  } catch (error) {
    console.error('Reschedule appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rescheduling appointment'
    });
  }
};

/**
 * @desc    Get available time slots for a service on a specific date
 * @route   GET /api/appointments/available-slots/:serviceId
 * @access  Public
 */
exports.getAvailableSlots = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a date'
      });
    }

    // Get service
    const service = await Service.findById(serviceId);
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

    // Get all appointments for this service on the given date
    const appointmentDate = new Date(date);
    const appointments = await Appointment.find({
      serviceId,
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
    console.error('Get available slots error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching available slots'
    });
  }
};
