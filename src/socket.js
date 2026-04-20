const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Provider = require('./models/Provider');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');

const setupSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: '*'
    }
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Unauthorized'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user || !user.isActive) {
        return next(new Error('Unauthorized'));
      }

      socket.user = user;
      if (user.userType === 'provider') {
        const provider = await Provider.findOne({ userId: user._id });
        if (!provider) {
          return next(new Error('Provider profile not found'));
        }
        socket.provider = provider;
      }

      return next();
    } catch (error) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    socket.join(`user:${user._id.toString()}`);
    if (socket.provider) {
      socket.join(`provider:${socket.provider._id.toString()}`);
    }

    socket.on('conversation:join', ({ conversationId }) => {
      if (conversationId) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const text = (payload?.text || '').trim();
        if (!text) {
          return ack && ack({ success: false, message: 'Message text is required' });
        }

        let conversation = null;

        if (payload.conversationId) {
          conversation = await Conversation.findById(payload.conversationId);
          if (!conversation) {
            return ack && ack({ success: false, message: 'Conversation not found' });
          }
        } else if (user.userType === 'user' && payload.providerId) {
          conversation = await Conversation.findOneAndUpdate(
            { userId: user._id, providerId: payload.providerId },
            { $setOnInsert: { userId: user._id, providerId: payload.providerId } },
            { new: true, upsert: true }
          );
        } else if (user.userType === 'provider' && payload.userId) {
          conversation = await Conversation.findOneAndUpdate(
            { userId: payload.userId, providerId: socket.provider._id },
            { $setOnInsert: { userId: payload.userId, providerId: socket.provider._id } },
            { new: true, upsert: true }
          );
        } else {
          return ack && ack({ success: false, message: 'Missing conversation info' });
        }

        // Authorization check
        if (user.userType === 'provider') {
          if (conversation.providerId.toString() !== socket.provider._id.toString()) {
            return ack && ack({ success: false, message: 'Not authorized' });
          }
        } else if (conversation.userId.toString() !== user._id.toString()) {
          return ack && ack({ success: false, message: 'Not authorized' });
        }

        const senderType = user.userType === 'provider' ? 'provider' : 'user';
        const senderId = senderType === 'provider' ? socket.provider._id : user._id;
        const recipientId = senderType === 'provider' ? conversation.userId : conversation.providerId;

        const message = new Message({
          conversationId: conversation._id,
          senderType,
          senderId,
          recipientId,
          text
        });

        await message.save();

        conversation.lastMessage = text;
        conversation.lastMessageAt = new Date();
        await conversation.save();

        const messagePayload = {
          id: message._id,
          conversationId: conversation._id,
          senderType,
          senderId,
          recipientId,
          text,
          createdAt: message.createdAt
        };

        io.to(`conversation:${conversation._id}`).emit('message:new', messagePayload);
        io.to(`user:${conversation.userId.toString()}`).emit('message:new', messagePayload);
        io.to(`provider:${conversation.providerId.toString()}`).emit('message:new', messagePayload);

        return ack && ack({ success: true, data: messagePayload });
      } catch (error) {
        console.error('Socket message send error:', error);
        return ack && ack({ success: false, message: 'Failed to send message' });
      }
    });
  });

  return io;
};

module.exports = setupSocket;
