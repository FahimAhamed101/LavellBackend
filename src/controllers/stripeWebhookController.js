const { getStripe } = require('../utility/stripe');
const Booking = require('../models/Booking');
const Appointment = require('../models/Appointment');
const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');
const EventTicketPurchase = require('../models/EventTicketPurchase');
const Event = require('../models/Event');
const EventManager = require('../models/EventManager');
const PaymentRefundLog = require('../models/PaymentRefundLog');
const { createAndSend } = require('../utility/notificationService');

const FINAL_PAYMENT_STATUSES = new Set(['completed', 'offline_paid', 'refunded']);

const normalizeRefundStatus = (status) => {
  const allowed = ['requested', 'pending', 'succeeded', 'failed', 'canceled', 'requires_action'];
  if (allowed.includes(status)) return status;
  return 'pending';
};

const normalizeIntentType = (metadata) =>
  (metadata?.type || '').toString().trim().toLowerCase();

const getMetadataId = (metadata, key) => {
  const raw = metadata?.[key];
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value.length ? value : null;
};

const isFinalPaidStatus = (status) =>
  FINAL_PAYMENT_STATUSES.has((status || '').toString().toLowerCase());

const syncRefundLogFromStripe = async (refund) => {
  if (!refund?.id) return;

  let refundLog = await PaymentRefundLog.findOne({ refundId: refund.id });

  // Fallback: if refundId was not set yet, attach this Stripe refund to the newest pending/requested log for the same payment intent.
  if (!refundLog && refund.payment_intent) {
    refundLog = await PaymentRefundLog.findOne({
      paymentIntentId: refund.payment_intent,
      refundId: null,
      status: { $in: ['requested', 'pending', 'requires_action'] }
    }).sort({ createdAt: -1 });
  }

  if (!refundLog) return;

  refundLog.refundId = refund.id;
  refundLog.status = normalizeRefundStatus(refund.status);
  refundLog.stripeError = refund.failure_reason || null;
  refundLog.metadata = {
    ...(refundLog.metadata || {}),
    stripeRefundStatus: refund.status || null,
    chargeId: refund.charge || null,
    receiptNumber: refund.receipt_number || null
  };
  await refundLog.save();
};

const markDownPaymentSucceeded = async (doc, intentId, intentStatus) => {
  if (!doc) return false;
  doc.paymentIntentId = intentId;
  doc.paymentIntentStatus = intentStatus;

  if (!isFinalPaidStatus(doc.paymentStatus) && doc.paymentStatus !== 'due_requested') {
    doc.paymentStatus = intentStatus === 'requires_capture' ? 'authorized' : 'partial';
  }

  await doc.save();
  return true;
};

const markDownPaymentFailedOrCanceled = async (doc, intentId, intentStatus) => {
  if (!doc) return false;
  doc.paymentIntentId = intentId;
  doc.paymentIntentStatus = intentStatus;

  if (!isFinalPaidStatus(doc.paymentStatus) && doc.paymentStatus !== 'due_requested') {
    doc.paymentStatus = 'pending';
  }

  await doc.save();
  return true;
};

const markDuePaymentSucceeded = async (doc, intentStatus) => {
  if (!doc) return false;

  doc.duePaymentIntentStatus = intentStatus;
  doc.paymentStatus = 'completed';
  doc.paidVia = 'online';
  if (!doc.duePaidAt) {
    doc.duePaidAt = new Date();
  }
  doc.remainingAmount = 0;
  await doc.save();
  return true;
};

const markDuePaymentProcessing = async (doc, intentStatus) => {
  if (!doc) return false;
  doc.duePaymentIntentStatus = intentStatus;
  if (!isFinalPaidStatus(doc.paymentStatus)) {
    doc.paymentStatus = 'due_requested';
  }
  await doc.save();
  return true;
};

const markDuePaymentFailedOrCanceled = async (doc, intentStatus) => {
  if (!doc) return false;
  doc.duePaymentIntentStatus = intentStatus;
  if (!isFinalPaidStatus(doc.paymentStatus)) {
    doc.paymentStatus = 'due_requested';
  }
  await doc.save();
  return true;
};

const markAppointmentPaymentSucceeded = async (doc, intentId, intentStatus) => {
  if (!doc) return false;
  doc.paymentIntentId = intentId;
  doc.paymentIntentStatus = intentStatus;
  doc.paymentStatus = 'completed';
  doc.paidVia = 'online';
  if (!doc.paidAt) {
    doc.paidAt = new Date();
  }
  doc.remainingAmount = 0;
  await doc.save();
  return true;
};

const markAppointmentPaymentProcessing = async (doc, intentId, intentStatus) => {
  if (!doc) return false;
  doc.paymentIntentId = intentId;
  doc.paymentIntentStatus = intentStatus;

  if (!['offline_paid', 'refunded'].includes(doc.paymentStatus)) {
    doc.paymentStatus = 'pending';
    doc.paidVia = null;
    doc.paidAt = null;
    doc.remainingAmount = doc.totalAmount || doc.remainingAmount || 0;
  }

  await doc.save();
  return true;
};

const markAppointmentPaymentFailedOrCanceled = async (doc, intentId, intentStatus) => {
  if (!doc) return false;
  doc.paymentIntentId = intentId;
  doc.paymentIntentStatus = intentStatus;

  if (!['offline_paid', 'refunded'].includes(doc.paymentStatus)) {
    doc.paymentStatus = 'pending';
    doc.paidVia = null;
    doc.paidAt = null;
    doc.remainingAmount = doc.totalAmount || doc.remainingAmount || 0;
  }

  await doc.save();
  return true;
};

const findBookingByDownPaymentIntent = async ({ intentId, bookingId, intentType }) => {
  if (intentId) {
    const byIntent = await Booking.findOne({ paymentIntentId: intentId });
    if (byIntent) return byIntent;
  }

  // Do not map due-payment intents into down-payment fields.
  if (intentType && intentType !== 'booking_down_payment') {
    return null;
  }

  if (!bookingId) return null;
  return Booking.findById(bookingId);
};

const findBusinessOwnerBookingByDownPaymentIntent = async ({
  intentId,
  bookingId,
  intentType
}) => {
  if (intentId) {
    const byIntent = await BusinessOwnerBooking.findOne({ paymentIntentId: intentId });
    if (byIntent) return byIntent;
  }

  // Do not map due-payment intents into down-payment fields.
  if (intentType && intentType !== 'business_owner_booking_down_payment') {
    return null;
  }

  if (!bookingId) return null;
  return BusinessOwnerBooking.findById(bookingId);
};

const findBookingByDuePaymentIntent = async ({ intentId, bookingId, intentType }) => {
  if (intentId) {
    const byIntent = await Booking.findOne({ duePaymentIntentId: intentId });
    if (byIntent) return byIntent;
  }

  if (intentType && intentType !== 'booking_due_payment') {
    return null;
  }

  if (!bookingId) return null;
  return Booking.findById(bookingId);
};

const findBusinessOwnerBookingByDuePaymentIntent = async ({
  intentId,
  bookingId,
  intentType
}) => {
  if (intentId) {
    const byIntent = await BusinessOwnerBooking.findOne({ duePaymentIntentId: intentId });
    if (byIntent) return byIntent;
  }

  if (intentType && intentType !== 'business_owner_booking_due_payment') {
    return null;
  }

  if (!bookingId) return null;
  return BusinessOwnerBooking.findById(bookingId);
};

const findAppointmentByPaymentIntent = async ({ intentId, appointmentId, intentType }) => {
  if (intentId) {
    const byIntent = await Appointment.findOne({ paymentIntentId: intentId });
    if (byIntent) return byIntent;
  }

  if (intentType && intentType !== 'appointment_full_payment') {
    return null;
  }

  if (!appointmentId) return null;
  return Appointment.findById(appointmentId);
};

const findBusinessOwnerAppointmentByPaymentIntent = async ({
  intentId,
  appointmentId,
  intentType
}) => {
  if (intentId) {
    const byIntent = await BusinessOwnerAppointment.findOne({ paymentIntentId: intentId });
    if (byIntent) return byIntent;
  }

  if (intentType && intentType !== 'business_owner_appointment_payment') {
    return null;
  }

  if (!appointmentId) return null;
  return BusinessOwnerAppointment.findById(appointmentId);
};

const handleTicketPurchaseSuccess = async ({ paymentIntentId, intentStatus, metadata }) => {
  const purchaseId = getMetadataId(metadata, 'eventTicketPurchaseId');

  const ticketPurchase =
    await EventTicketPurchase.findOne({ paymentIntentId }) ||
    (purchaseId ? await EventTicketPurchase.findById(purchaseId) : null);

  if (!ticketPurchase) return false;

  const wasCompleted = ticketPurchase.paymentStatus === 'completed';

  ticketPurchase.paymentIntentId = paymentIntentId;
  ticketPurchase.paymentIntentStatus = intentStatus;
  ticketPurchase.paymentStatus = 'completed';
  if (!ticketPurchase.paidAt) {
    ticketPurchase.paidAt = new Date();
  }
  await ticketPurchase.save();

  // Idempotent: avoid double increments/notifications on webhook retries.
  if (!wasCompleted) {
    const event = await Event.findById(ticketPurchase.eventId);
    if (event) {
      event.ticketsSold += ticketPurchase.quantity;
      await event.save();
    }

    const eventManagerProfile = await EventManager.findById(
      ticketPurchase.eventManagerId
    ).select('userId');
    if (eventManagerProfile?.userId) {
      await createAndSend({
        userId: eventManagerProfile.userId,
        userType: 'eventManager',
        title: 'New ticket sold',
        body: `${ticketPurchase.quantity} ticket(s) sold for ${event?.eventName || 'your event'}.`,
        type: 'event_ticket_sold',
        entityType: 'event',
        entityId: ticketPurchase.eventId,
        metadata: {
          purchaseId: ticketPurchase._id,
          quantity: ticketPurchase.quantity,
          totalAmount: ticketPurchase.totalAmount
        },
        data: {
          type: 'event_ticket_sold',
          eventId: ticketPurchase.eventId.toString(),
          purchaseId: ticketPurchase._id.toString()
        }
      });
    }
  }

  return true;
};

const handleTicketPurchaseFailureOrCanceled = async ({ paymentIntentId, intentStatus, metadata }) => {
  const purchaseId = getMetadataId(metadata, 'eventTicketPurchaseId');

  const ticketPurchase =
    await EventTicketPurchase.findOne({ paymentIntentId }) ||
    (purchaseId ? await EventTicketPurchase.findById(purchaseId) : null);

  if (!ticketPurchase) return false;

  ticketPurchase.paymentIntentId = paymentIntentId;
  ticketPurchase.paymentIntentStatus = intentStatus;
  if (!['completed', 'refunded'].includes(ticketPurchase.paymentStatus)) {
    ticketPurchase.paymentStatus = 'failed';
  }
  await ticketPurchase.save();
  return true;
};

const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const metadata = paymentIntent?.metadata || {};
  const intentId = paymentIntent?.id;
  const intentStatus = (paymentIntent?.status || 'succeeded').toLowerCase();
  const intentType = normalizeIntentType(metadata);

  const bookingId = getMetadataId(metadata, 'bookingId');
  const boBookingId = getMetadataId(metadata, 'businessOwnerBookingId');
  const appointmentId = getMetadataId(metadata, 'appointmentId');
  const boAppointmentId = getMetadataId(metadata, 'businessOwnerAppointmentId');

  // Event tickets
  if (
    intentType === 'event_ticket_purchase' ||
    getMetadataId(metadata, 'eventTicketPurchaseId')
  ) {
    const handled = await handleTicketPurchaseSuccess({
      paymentIntentId: intentId,
      intentStatus,
      metadata
    });
    if (handled) return;
  }

  // Booking due payment
  const dueBooking = await findBookingByDuePaymentIntent({
    intentId,
    bookingId,
    intentType
  });
  if (await markDuePaymentSucceeded(dueBooking, intentStatus)) return;

  // Business-owner booking due payment
  const dueBoBooking = await findBusinessOwnerBookingByDuePaymentIntent({
    intentId,
    bookingId: boBookingId,
    intentType
  });
  if (await markDuePaymentSucceeded(dueBoBooking, intentStatus)) return;

  // Provider appointment full payment
  const appointment = await findAppointmentByPaymentIntent({
    intentId,
    appointmentId,
    intentType
  });
  if (await markAppointmentPaymentSucceeded(appointment, intentId, intentStatus)) return;

  // Business-owner appointment full payment
  const boAppointment = await findBusinessOwnerAppointmentByPaymentIntent({
    intentId,
    appointmentId: boAppointmentId,
    intentType
  });
  if (await markAppointmentPaymentSucceeded(boAppointment, intentId, intentStatus)) return;

  // Booking down payment
  const booking = await findBookingByDownPaymentIntent({
    intentId,
    bookingId,
    intentType
  });
  if (await markDownPaymentSucceeded(booking, intentId, intentStatus)) return;

  // Business-owner booking down payment
  const boBooking = await findBusinessOwnerBookingByDownPaymentIntent({
    intentId,
    bookingId: boBookingId,
    intentType
  });
  await markDownPaymentSucceeded(boBooking, intentId, intentStatus);
};

const handlePaymentIntentProcessing = async (paymentIntent) => {
  const metadata = paymentIntent?.metadata || {};
  const intentId = paymentIntent?.id;
  const intentStatus = (paymentIntent?.status || 'processing').toLowerCase();
  const intentType = normalizeIntentType(metadata);

  const bookingId = getMetadataId(metadata, 'bookingId');
  const boBookingId = getMetadataId(metadata, 'businessOwnerBookingId');
  const appointmentId = getMetadataId(metadata, 'appointmentId');
  const boAppointmentId = getMetadataId(metadata, 'businessOwnerAppointmentId');

  // Event tickets
  if (
    intentType === 'event_ticket_purchase' ||
    getMetadataId(metadata, 'eventTicketPurchaseId')
  ) {
    const purchaseId = getMetadataId(metadata, 'eventTicketPurchaseId');
    const ticketPurchase =
      await EventTicketPurchase.findOne({ paymentIntentId: intentId }) ||
      (purchaseId ? await EventTicketPurchase.findById(purchaseId) : null);
    if (ticketPurchase) {
      ticketPurchase.paymentIntentId = intentId;
      ticketPurchase.paymentIntentStatus = intentStatus;
      if (ticketPurchase.paymentStatus !== 'completed') {
        ticketPurchase.paymentStatus = 'pending';
      }
      await ticketPurchase.save();
      return;
    }
  }

  const dueBooking = await findBookingByDuePaymentIntent({
    intentId,
    bookingId,
    intentType
  });
  if (await markDuePaymentProcessing(dueBooking, intentStatus)) return;

  const dueBoBooking = await findBusinessOwnerBookingByDuePaymentIntent({
    intentId,
    bookingId: boBookingId,
    intentType
  });
  if (await markDuePaymentProcessing(dueBoBooking, intentStatus)) return;

  const appointment = await findAppointmentByPaymentIntent({
    intentId,
    appointmentId,
    intentType
  });
  if (await markAppointmentPaymentProcessing(appointment, intentId, intentStatus)) return;

  const boAppointment = await findBusinessOwnerAppointmentByPaymentIntent({
    intentId,
    appointmentId: boAppointmentId,
    intentType
  });
  if (await markAppointmentPaymentProcessing(boAppointment, intentId, intentStatus)) return;

  const booking = await findBookingByDownPaymentIntent({
    intentId,
    bookingId,
    intentType
  });
  if (await markDownPaymentSucceeded(booking, intentId, intentStatus)) return;

  const boBooking = await findBusinessOwnerBookingByDownPaymentIntent({
    intentId,
    bookingId: boBookingId,
    intentType
  });
  await markDownPaymentSucceeded(boBooking, intentId, intentStatus);
};

const handlePaymentIntentFailureOrCanceled = async (paymentIntent) => {
  const metadata = paymentIntent?.metadata || {};
  const intentId = paymentIntent?.id;
  const intentStatus = (paymentIntent?.status || '').toLowerCase();
  const intentType = normalizeIntentType(metadata);

  const bookingId = getMetadataId(metadata, 'bookingId');
  const boBookingId = getMetadataId(metadata, 'businessOwnerBookingId');
  const appointmentId = getMetadataId(metadata, 'appointmentId');
  const boAppointmentId = getMetadataId(metadata, 'businessOwnerAppointmentId');

  const dueBooking = await findBookingByDuePaymentIntent({
    intentId,
    bookingId,
    intentType
  });
  if (await markDuePaymentFailedOrCanceled(dueBooking, intentStatus)) return;

  const dueBoBooking = await findBusinessOwnerBookingByDuePaymentIntent({
    intentId,
    bookingId: boBookingId,
    intentType
  });
  if (await markDuePaymentFailedOrCanceled(dueBoBooking, intentStatus)) return;

  const appointment = await findAppointmentByPaymentIntent({
    intentId,
    appointmentId,
    intentType
  });
  if (await markAppointmentPaymentFailedOrCanceled(appointment, intentId, intentStatus)) return;

  const boAppointment = await findBusinessOwnerAppointmentByPaymentIntent({
    intentId,
    appointmentId: boAppointmentId,
    intentType
  });
  if (await markAppointmentPaymentFailedOrCanceled(boAppointment, intentId, intentStatus)) return;

  const booking = await findBookingByDownPaymentIntent({
    intentId,
    bookingId,
    intentType
  });
  if (await markDownPaymentFailedOrCanceled(booking, intentId, intentStatus)) return;

  const boBooking = await findBusinessOwnerBookingByDownPaymentIntent({
    intentId,
    bookingId: boBookingId,
    intentType
  });
  if (await markDownPaymentFailedOrCanceled(boBooking, intentId, intentStatus)) return;

  await handleTicketPurchaseFailureOrCanceled({
    paymentIntentId: intentId,
    intentStatus,
    metadata
  });
};

const handleCheckoutSessionCompleted = async (session) => {
  const paymentIntentId = session.payment_intent;
  const paymentStatus = session.payment_status;
  if (!session?.id) return;

  const booking = await Booking.findOne({ checkoutSessionId: session.id });
  if (booking) {
    if (paymentIntentId) booking.paymentIntentId = paymentIntentId;
    if (paymentStatus === 'paid') {
      booking.paymentIntentStatus = 'succeeded';
      booking.paymentStatus = 'partial';
    }
    await booking.save();
    return;
  }

  const boBooking = await BusinessOwnerBooking.findOne({ checkoutSessionId: session.id });
  if (boBooking) {
    if (paymentIntentId) boBooking.paymentIntentId = paymentIntentId;
    if (paymentStatus === 'paid') {
      boBooking.paymentIntentStatus = 'succeeded';
      boBooking.paymentStatus = 'partial';
    }
    await boBooking.save();
    return;
  }

  const appointment = await Appointment.findOne({ checkoutSessionId: session.id });
  if (appointment) {
    if (paymentIntentId) appointment.paymentIntentId = paymentIntentId;
    if (paymentStatus === 'paid') {
      appointment.paymentIntentStatus = 'succeeded';
      appointment.paymentStatus = 'completed';
      appointment.paidVia = 'online';
      appointment.paidAt = new Date();
      appointment.remainingAmount = 0;
    }
    await appointment.save();
    return;
  }

  const boAppointment = await BusinessOwnerAppointment.findOne({
    checkoutSessionId: session.id
  });
  if (boAppointment) {
    if (paymentIntentId) boAppointment.paymentIntentId = paymentIntentId;
    if (paymentStatus === 'paid') {
      boAppointment.paymentIntentStatus = 'succeeded';
      boAppointment.paymentStatus = 'completed';
      boAppointment.paidVia = 'online';
      boAppointment.paidAt = new Date();
      boAppointment.remainingAmount = 0;
    }
    await boAppointment.save();
  }
};

const handlePaymentIntentAmountCapturableUpdated = async (paymentIntent) => {
  const intentId = paymentIntent?.id;
  const intentStatus = (paymentIntent?.status || '').toLowerCase();
  const metadata = paymentIntent?.metadata || {};
  const bookingId = getMetadataId(metadata, 'bookingId');
  const boBookingId = getMetadataId(metadata, 'businessOwnerBookingId');

  const booking =
    await Booking.findOne({ paymentIntentId: intentId }) ||
    (bookingId ? await Booking.findById(bookingId) : null);
  if (booking) {
    booking.paymentIntentId = intentId;
    booking.paymentIntentStatus = intentStatus;
    booking.paymentStatus = 'authorized';
    await booking.save();
    return;
  }

  const boBooking =
    await BusinessOwnerBooking.findOne({ paymentIntentId: intentId }) ||
    (boBookingId ? await BusinessOwnerBooking.findById(boBookingId) : null);
  if (boBooking) {
    boBooking.paymentIntentId = intentId;
    boBooking.paymentIntentStatus = intentStatus;
    boBooking.paymentStatus = 'authorized';
    await boBooking.save();
  }
};

const handleStripeWebhook = async (req, res) => {
  let event;

  try {
    const stripe = getStripe();
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const data = event.data?.object;

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(data);
        break;

      case 'payment_intent.amount_capturable_updated':
        await handlePaymentIntentAmountCapturableUpdated(data);
        break;

      case 'payment_intent.processing':
        await handlePaymentIntentProcessing(data);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(data);
        break;

      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        await handlePaymentIntentFailureOrCanceled(data);
        break;

      case 'refund.updated':
        await syncRefundLogFromStripe(data);
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    res.status(500).json({ received: false });
  }
};

module.exports = { handleStripeWebhook };
